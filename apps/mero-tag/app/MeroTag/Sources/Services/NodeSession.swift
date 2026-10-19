import Foundation
import MeroKit

/// A node signed in to directly — a local `merod` — with its admin username
/// and password, instead of a Calimero Cloud account. For development and
/// demos: everything runs on that one node, with its account as the member.
public struct NodeSession: Sendable {
    public let url: String
    public let username: String
    public let mero: Mero
    /// The node's account (64 hex): the member id in the contract.
    public let accountId: String

    /// Authenticate against `url` and read who the node is.
    public static func connect(url rawURL: String, username: String, password: String) async throws -> NodeSession {
        let urlString = rawURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: urlString), url.scheme == "http" || url.scheme == "https", url.host != nil else {
            throw NodeSessionError.badURL
        }
        let mero = Mero(config: MeroConfig(baseURL: url, tokenStore: MemoryTokenStore()))
        _ = try await mero.authenticate(Credentials(username: username, password: password))
        let identity = try await mero.admin.getNodeIdentity()
        return NodeSession(url: urlString, username: username, mero: mero, accountId: identity.accountId)
    }
}

public enum NodeSessionError: LocalizedError, Equatable {
    case badURL

    public var errorDescription: String? {
        switch self {
        case .badURL: return "Enter a full node URL, like http://localhost:4001."
        }
    }
}

/// The contract over a node's JSON-RPC, and its events over the node's SSE.
public struct NodeTransport: ContextTransport {
    public let mero: Mero

    public init(mero: Mero) { self.mero = mero }

    public func query(contextId: String, method: String, args: JSONValue) async throws -> JSONValue? {
        try await call(contextId: contextId, method: method, args: args)
    }

    public func execute(contextId: String, method: String, args: JSONValue) async throws -> JSONValue? {
        try await call(contextId: contextId, method: method, args: args)
    }

    private func call(contextId: String, method: String, args: JSONValue) async throws -> JSONValue? {
        guard case .object(let object) = args else { throw ContractError.unexpectedResponse(method: method) }
        do {
            let value: JSONValue = try await mero.rpc.execute(contextId: contextId, method: method, argsJson: object)
            return value
        } catch MeroError.emptyResponse {
            // A method that returns nothing answers `output: null`.
            return nil
        }
    }

    public func events(contextId: String) -> AsyncThrowingStream<JSONValue, Error>? {
        let upstream = mero.events(contextIds: [contextId])
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    for try await event in upstream where event.contextId == contextId {
                        continuation.yield(event.payload)
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

/// Creating, inviting to and joining spaces on a node signed in to directly.
/// Create installs Mero Tag from the app registry if the node doesn't have it.
public struct NodeSpaces: SpaceDirectory {
    public let mero: Mero
    public var registryURL = ApplicationRegistry.defaultURL

    public init(mero: Mero) { self.mero = mero }

    public func createSpace(named name: String) async throws -> CreatedSpace {
        let applicationId = try await applicationId()
        let namespace = try await mero.admin.createNamespace(
            CreateNamespaceRequest(applicationId: applicationId, name: name))
        let params = try JSONSerialization.data(withJSONObject: ["name": name])
        let context = try await mero.admin.createContext(
            CreateContextRequest(
                applicationId: applicationId, groupId: namespace.namespaceId,
                initializationParams: params.map { Int($0) }, name: name))
        return CreatedSpace(
            namespaceId: namespace.namespaceId, contextId: context.contextId, hosted: true, hostingNote: nil)
    }

    public func invite(contextId: String, spaceName: String) async throws -> SpaceInvite {
        guard let namespaceId = try await mero.admin.getContextGroup(contextId) else {
            throw SpaceDirectoryError.notInASpace
        }
        let signed: SignedGroupOpenInvitation
        switch try await mero.admin.createNamespaceInvitation(namespaceId) {
        case .single(let data):
            signed = data.invitation
        case .recursive(let data):
            guard let first = data.invitations.first else { throw SpaceDirectoryError.notInASpace }
            signed = first.invitation
        }
        return SpaceInvite(namespaceId: namespaceId, contextId: contextId, spaceName: spaceName, invitation: signed)
    }

    public func join(_ invite: SpaceInvite) async throws {
        _ = try await mero.admin.joinNamespace(
            invite.namespaceId, request: JoinNamespaceRequest(invitation: invite.invitation))
        _ = try? await mero.admin.syncGroupContexts(invite.namespaceId)
    }

    /// Mero Tag's application on this node, installing it from the registry
    /// when it isn't there yet.
    private func applicationId() async throws -> String {
        if let installed = try await mero.admin.listApplications().apps.first(where: {
            $0.package == SpaceInvite.appSlug
        }) {
            return installed.id
        }
        let versions = try await mero.admin.getRegistryVersions(
            registryUrl: registryURL, packageName: SpaceInvite.appSlug)
        guard let version = versions.first else { throw NodeSpacesError.notPublished }
        return try await mero.admin.installFromRegistry(packageName: SpaceInvite.appSlug, version: version)
            .applicationId
    }
}

public enum NodeSpacesError: LocalizedError, Equatable {
    case notPublished

    public var errorDescription: String? {
        switch self {
        case .notPublished: return "Mero Tag isn't on the app registry, so this node can't install it."
        }
    }
}
