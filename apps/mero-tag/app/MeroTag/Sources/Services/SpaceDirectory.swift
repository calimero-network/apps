import Foundation
import MeroKit

/// A space this account just created.
public struct CreatedSpace: Equatable, Sendable {
    public let namespaceId: String
    public let contextId: String
    /// Whether Calimero Cloud hosts the space (HA), which is what lets people
    /// with no node of their own be admitted.
    public let hosted: Bool
    /// Why it isn't hosted, when it isn't.
    public let hostingNote: String?
}

/// Creating, inviting to and joining spaces as the signed-in account. In
/// production that is ``CloudSpaces``; tests substitute a fake.
public protocol SpaceDirectory: Sendable {
    func createSpace(named name: String) async throws -> CreatedSpace
    func invite(contextId: String, spaceName: String) async throws -> SpaceInvite
    func join(_ invite: SpaceInvite) async throws
}

public enum SpaceDirectoryError: LocalizedError, Equatable {
    /// Signed in, but no relay serves the account yet.
    case noRelay
    /// The relay's Bearer session is not established.
    case readsUnavailable
    /// The context is in no namespace, so there is nothing to invite into.
    case notInASpace

    public var errorDescription: String? {
        switch self {
        case .noRelay:
            return "Your account isn't served by a relay yet. Join a space from an invite to get one."
        case .readsUnavailable:
            return "The relay session isn't fully established yet. Try again in a moment."
        case .notInASpace:
            return "This space has no namespace to invite people into."
        }
    }
}

/// The account layer of the Swift SDK, as Mero Tag uses it.
///
/// - **Create** founds a namespace for ``SpaceInvite/appSlug`` through the
///   account's relay (`CloudSignIn.foundNamespace`: the registry's application,
///   default capabilities, the name, and HA in the cloud when the relay attests
///   the founding), then creates the space's context in it through the relay.
/// - **Invite** signs a namespace invitation with this device's key
///   (`CloudSignIn.createNamespaceInvitation`); the relay is only read.
/// - **Join** redeems one as the account (`CloudSignIn.join`); a relayless
///   account adopts the relay that admits it.
public struct CloudSpaces: SpaceDirectory {
    public let cloud: CloudSignIn
    public let connection: CloudConnection?
    public var registryURL = ApplicationRegistry.defaultURL
    public var urlSession: URLSession = .shared

    public init(cloud: CloudSignIn, connection: CloudConnection?) {
        self.cloud = cloud
        self.connection = connection
    }

    public func createSpace(named name: String) async throws -> CreatedSpace {
        guard let connection, let relay = connection.relay else { throw SpaceDirectoryError.noRelay }
        // Resolved here, not inside foundNamespace, because the context is
        // created on the same application right after.
        let resolved = try await ApplicationRegistry.resolve(
            registryURL: registryURL, package: SpaceInvite.appSlug, session: urlSession)
        let application = FoundingApplication(
            applicationId: resolved.applicationId, package: SpaceInvite.appSlug, version: resolved.version)
        let founded = try await cloud.foundNamespace(
            connection, name: name, package: SpaceInvite.appSlug, application: application)
        let context = try await relay.createContext(
            groupId: founded.namespaceId, applicationId: application.applicationId,
            initArgs: .object(["name": .string(name)]), name: name)
        return CreatedSpace(
            namespaceId: founded.namespaceId, contextId: context.contextId, hosted: founded.haEnabled,
            hostingNote: founded.haError)
    }

    public func invite(contextId: String, spaceName: String) async throws -> SpaceInvite {
        guard let connection else { throw SpaceDirectoryError.noRelay }
        guard let mero = connection.mero else { throw SpaceDirectoryError.readsUnavailable }
        guard let namespaceId = try await mero.admin.getContextGroup(contextId) else {
            throw SpaceDirectoryError.notInASpace
        }
        let signed = try await cloud.createNamespaceInvitation(connection, namespaceId: namespaceId)
        return SpaceInvite(namespaceId: namespaceId, contextId: contextId, spaceName: spaceName, invitation: signed)
    }

    public func join(_ invite: SpaceInvite) async throws {
        _ = try await cloud.join(namespaceId: invite.namespaceId, invitation: invite.invitation)
    }
}
