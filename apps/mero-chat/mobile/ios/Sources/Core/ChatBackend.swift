import Foundation
import MeroKit

/// Everything the chat screens need from a signed-in account, and nothing a
/// node would offer: there is no node here.
///
/// ``DelegatedChatBackend`` is the real one. Tests substitute a fake.
protocol ChatBackend: Sendable {
    /// The account, 64 hex.
    var account: String { get }
    /// The contract in a context: relay query for reads, warrants for writes.
    var contract: any ChatContract { get }
    /// Whether a relay serves this account (else only joining works).
    var hasRelay: Bool { get }
    /// Whether ``events(contextId:)`` streams (the relay's Bearer session is up);
    /// when not, the channel screen polls.
    var canSubscribe: Bool { get }

    /// The namespaces this account is in.
    func listWorkspaces() async throws -> [Workspace]
    /// The channel-groups (subgroups) of a namespace and the contexts in each.
    func listChannelGroups(namespaceId: String) async throws -> [ChannelGroupListing]
    /// Whether the account is a member of the context's group (its calls work).
    func isMember(contextId: String) async throws -> Bool
    /// Join an open channel: `MemberJoinedOpen` on its group, through the relay.
    func joinChannel(contextId: String) async throws

    /// Found a namespace through the relay, named `name`.
    func foundWorkspace(name: String) async throws -> FoundedWorkspace
    /// Create a channel's subgroup under the namespace (a root op through the relay).
    func createChannelGroup(namespaceId: String, name: String, isPublic: Bool) async throws -> String
    /// Create the channel's context in `groupId` (a context intent through the relay).
    func createContext(groupId: String, applicationId: String, name: String, initArgs: JSONValue) async throws -> String

    /// Mint an invitation to a namespace, signed with the device key.
    func createInvitation(namespaceId: String) async throws -> SignedGroupOpenInvitation
    /// Redeem an invitation: direct admission through an admitting relay.
    func joinWorkspace(namespaceId: String, invitation: SignedGroupOpenInvitation) async throws -> JoinedWorkspace

    /// Live events for one context.
    func events(contextId: String) -> AsyncThrowingStream<ChatLiveEvent, Error>
}

/// ``ChatBackend`` for a Calimero Cloud account, delegated end to end.
///
/// - Contract calls: ``RelayChatContract`` over the connection's ``RelayClient``
///   (relay query / warrant intents).
/// - Listings: the account's admin (``AccountAdmin``), whose reads are the
///   relay's caller-scoped admin API.
/// - Channels: ``AccountAdmin`` turns `createGroupInNamespace`,
///   `setSubgroupVisibility`, `createContext` and `joinContext` into governance
///   and context intents posted to the namespace's relay.
/// - Workspaces: ``CloudSignIn/foundNamespace(_:name:package:application:defaultCapabilities:registryURL:)``
///   founds through the relay; ``CloudSignIn/createNamespaceInvitation(_:namespaceId:invitedRole:validForSeconds:)``
///   signs invitations with the device key; ``CloudSignIn/join(namespaceId:invitation:nodeURL:)``
///   is direct admission (`POST …/namespaces/{id}/admit`) through the relay the cloud routes to.
/// - Live updates: SSE on the relay through the connection's Bearer ``Mero``.
struct DelegatedChatBackend: ChatBackend {
    let account: String
    let contract: any ChatContract
    let connection: CloudConnection
    let admin: any AdminSurface
    let signIn: CloudSignIn

    init(connection: CloudConnection, admin: any AdminSurface, signIn: CloudSignIn) {
        self.account = connection.session.account
        self.connection = connection
        self.admin = admin
        self.signIn = signIn
        if let relay = connection.relay {
            contract = RelayChatContract(relay: relay)
        } else {
            contract = NoRelayChatContract()
        }
    }

    var hasRelay: Bool { connection.relay != nil }
    var canSubscribe: Bool { connection.mero != nil }

    func listWorkspaces() async throws -> [Workspace] {
        try await admin.listNamespaces().map {
            Workspace(
                id: $0.namespaceId, name: $0.name ?? ChatIdentity.short($0.namespaceId),
                applicationId: $0.targetApplicationId)
        }
    }

    func listChannelGroups(namespaceId: String) async throws -> [ChannelGroupListing] {
        let subgroups = try await admin.listSubgroups(namespaceId)
        var out: [ChannelGroupListing] = []
        for subgroup in subgroups {
            let contexts = (try? await admin.listGroupContexts(subgroup.groupId)) ?? []
            out.append(
                ChannelGroupListing(groupId: subgroup.groupId, name: subgroup.name, contextIds: contexts.map(\.contextId)))
        }
        return out
    }

    func isMember(contextId: String) async throws -> Bool {
        !(try await admin.getContextIdentitiesOwned(contextId).identities.isEmpty)
    }

    func joinChannel(contextId: String) async throws {
        _ = try await admin.joinContext(contextId)
    }

    func foundWorkspace(name: String) async throws -> FoundedWorkspace {
        let founded = try await signIn.foundNamespace(connection, name: name, package: ChatConstants.packageName)
        return FoundedWorkspace(
            namespaceId: founded.namespaceId, haEnabled: founded.haEnabled, haError: founded.haError)
    }

    func createChannelGroup(namespaceId: String, name: String, isPublic: Bool) async throws -> String {
        let visibility = isPublic ? "open" : "restricted"
        let created = try await admin.createGroupInNamespace(
            namespaceId, request: CreateGroupInNamespaceRequest(groupName: name, visibility: visibility))
        // The web app sets it again explicitly; a failure there is not fatal.
        try? await admin.setSubgroupVisibility(
            created.groupId, request: SetSubgroupVisibilityRequest(subgroupVisibility: visibility))
        return created.groupId
    }

    func createContext(groupId: String, applicationId: String, name: String, initArgs: JSONValue) async throws -> String {
        let created = try await admin.createContext(
            CreateContextRequest(
                applicationId: applicationId, groupId: groupId, initializationParams: ChatJSON.bytes(initArgs),
                name: name))
        return created.contextId
    }

    func createInvitation(namespaceId: String) async throws -> SignedGroupOpenInvitation {
        try await signIn.createNamespaceInvitation(connection, namespaceId: namespaceId)
    }

    func joinWorkspace(namespaceId: String, invitation: SignedGroupOpenInvitation) async throws -> JoinedWorkspace {
        let (_, outcome) = try await signIn.join(namespaceId: namespaceId, invitation: invitation)
        return JoinedWorkspace(published: outcome.published, relayURL: outcome.relayUrl)
    }

    func events(contextId: String) -> AsyncThrowingStream<ChatLiveEvent, Error> {
        guard let mero = connection.mero else {
            return AsyncThrowingStream { $0.finish() }
        }
        let upstream = mero.events(contextIds: [contextId])
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    for try await event in upstream {
                        continuation.yield(ChatLiveEvent(contextId: event.contextId, kind: event.kind))
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
