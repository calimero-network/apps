import Foundation
import MeroKit

/// Everything the chat screens need from a signed-in account on a Calimero
/// 1.0 cluster. In 1.0 words a workspace is an **org**, a channel-group is a
/// **team** in it and a channel is an **app instance** of chat in that team.
///
/// ``CloudChatBackend`` is the real one. Tests substitute a fake.
protocol ChatBackend: Sendable {
    /// The account, 64 hex.
    var account: String { get }
    /// The contract in an app instance: `/views` for reads, `/intents` for writes.
    var contract: any ChatContract { get }
    /// Whether the account is connected to its cluster (always, once signed in on 1.0).
    var hasRelay: Bool { get }
    /// Whether ``events(contextId:)`` streams (sealed SSE); when not, the channel screen polls.
    var canSubscribe: Bool { get }

    /// The orgs this account is in that run chat.
    func listWorkspaces() async throws -> [Workspace]
    /// The channel-groups (teams) of an org and the app instances in each.
    func listChannelGroups(namespaceId: String) async throws -> [ChannelGroupListing]
    /// Whether the account can reach the app instance (its calls work).
    func isMember(contextId: String) async throws -> Bool
    /// Join an open channel: open teams inherit org membership, so this checks it is reachable.
    func joinChannel(contextId: String) async throws

    /// Found an org for chat, named `name`.
    func foundWorkspace(name: String) async throws -> FoundedWorkspace
    /// Create a channel's team in the org (`join: everyone`, or `invite` when private).
    func createChannelGroup(namespaceId: String, name: String, isPublic: Bool) async throws -> String
    /// Create the channel's app instance in team `groupId` (`POST /apps`).
    func createContext(groupId: String, applicationId: String, name: String, initArgs: JSONValue) async throws -> String

    /// Mint an invite token to an org (`POST /orgs/{org}/invites`).
    func createInvitation(namespaceId: String) async throws -> OrgInvitation
    /// Redeem an invitation (`POST /invites/{token}/redeem`).
    func joinWorkspace(namespaceId: String, invitation: OrgInvitation) async throws -> JoinedWorkspace

    /// Live events for one app instance.
    func events(contextId: String) -> AsyncThrowingStream<ChatLiveEvent, Error>

    /// Store `data` as a blob against `contextId` (an attachment or an avatar); its id.
    func uploadBlob(contextId: String, data: Data) async throws -> String
    /// A blob's bytes, fetched through the app instance `contextId`.
    func downloadBlob(blobId: String, contextId: String) async throws -> Data
}

/// ``ChatBackend`` on the swift-sdk's app layer (`MeroAppBackend`; in the app
/// `MeroKitUI.CloudAppBackend` over a `CalimeroClient`, in tests
/// `InMemoryAppBackend`):
///
/// - Contract calls: ``AppChatContract`` over the backend's `ContextContract`
///   (`POST /apps/{app}/views` and `/intents`, sealed).
/// - Workspaces: `listNamespaces` / `foundNamespace` (orgs whose metadata names chat).
/// - Channel-groups: `listSubgroups` (teams and their app instances); a team
///   that only admits by invitation is a private channel (``privateTeams``).
/// - Invitations: org invite tokens, redeemed at `POST /invites/{token}/redeem`.
/// - Live updates: `events(contextId:)` (`GET /apps/{app}/events`, sealed SSE).
/// - Attachments and avatars: `/apps/{app}/blobs`.
struct CloudChatBackend: ChatBackend {
    let app: any MeroAppBackend
    /// The ids of an org's teams that only admit by invitation (private
    /// channels). The app reads them from `GET /orgs/{org}`; `nil` treats
    /// every channel as open.
    let privateTeams: (@Sendable (_ orgId: String) async -> Set<String>)?

    init(app: any MeroAppBackend, privateTeams: (@Sendable (_ orgId: String) async -> Set<String>)? = nil) {
        self.app = app
        self.privateTeams = privateTeams
    }

    var account: String { app.account }
    var contract: any ChatContract { AppChatContract(inner: app.contract) }
    var hasRelay: Bool { app.hasRelay }
    var canSubscribe: Bool { app.canSubscribe }

    func listWorkspaces() async throws -> [Workspace] {
        try await app.listNamespaces().map {
            Workspace(id: $0.id, name: $0.name ?? ChatIdentity.short($0.id), applicationId: $0.applicationId)
        }
    }

    func listChannelGroups(namespaceId: String) async throws -> [ChannelGroupListing] {
        let subgroups = try await app.listSubgroups(namespaceId: namespaceId)
        let restricted = await privateTeams?(namespaceId) ?? []
        return subgroups.map {
            ChannelGroupListing(
                groupId: $0.groupId, name: $0.name, contextIds: $0.contextIds,
                isPrivate: restricted.contains($0.groupId))
        }
    }

    func isMember(contextId: String) async throws -> Bool {
        try await app.isMember(contextId: contextId)
    }

    func joinChannel(contextId: String) async throws {
        try await app.joinContext(contextId: contextId)
    }

    func foundWorkspace(name: String) async throws -> FoundedWorkspace {
        let founded = try await app.foundNamespace(name: name)
        return FoundedWorkspace(namespaceId: founded.namespaceId, haEnabled: founded.haEnabled, haError: founded.haError)
    }

    func createChannelGroup(namespaceId: String, name: String, isPublic: Bool) async throws -> String {
        try await app.createSubgroup(namespaceId: namespaceId, name: name, isPublic: isPublic)
    }

    func createContext(groupId: String, applicationId: String, name: String, initArgs: JSONValue) async throws -> String {
        try await app.createContext(groupId: groupId, applicationId: applicationId, name: name, initArgs: initArgs)
    }

    func createInvitation(namespaceId: String) async throws -> OrgInvitation {
        try await app.createInvitation(namespaceId: namespaceId)
    }

    func joinWorkspace(namespaceId: String, invitation: OrgInvitation) async throws -> JoinedWorkspace {
        let joined = try await app.joinNamespace(namespaceId: namespaceId, invitation: invitation)
        return JoinedWorkspace(published: joined.published, nodeURL: joined.nodeURL)
    }

    func uploadBlob(contextId: String, data: Data) async throws -> String {
        try await app.uploadBlob(contextId: contextId, data: data).blobId
    }

    func downloadBlob(blobId: String, contextId: String) async throws -> Data {
        try await app.getBlob(blobId: blobId, contextId: contextId)
    }

    func events(contextId: String) -> AsyncThrowingStream<ChatLiveEvent, Error> {
        let upstream = app.events(contextId: contextId)
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
