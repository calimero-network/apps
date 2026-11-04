import Foundation
import MeroKit

/// A space this account just created: an organization and the Mero Tag app
/// instance that is its space.
public struct CreatedSpace: Equatable, Sendable {
    public let orgId: String
    public let appId: String
}

/// Creating, inviting to and joining spaces as the signed-in account. In
/// production that is ``CloudSpaces``; tests substitute a fake.
public protocol SpaceDirectory: Sendable {
    func createSpace(named name: String) async throws -> CreatedSpace
    func invite(appId: String, spaceName: String) async throws -> SpaceInvite
    func join(_ invite: SpaceInvite) async throws
}

public enum SpaceDirectoryError: LocalizedError, Equatable {
    /// Not connected to a cluster.
    case notConnected
    /// The app instance belongs to no organization, so there is nobody to invite into.
    case notInAnOrganization

    public var errorDescription: String? {
        switch self {
        case .notConnected:
            return "You're not connected to a Calimero cluster."
        case .notInAnOrganization:
            return "This space doesn't belong to an organization, so there's no one to invite into."
        }
    }
}

/// Spaces on a Calimero 1.0 cluster.
///
/// - **Create** founds an organization for the space (named after it, tagged
///   with Mero Tag's package so other Calimero apps can tell it apart), then
///   creates the Mero Tag app instance in it from the registry package, open
///   to the organization's members, with the space's name as `init`'s argument.
/// - **Invite** mints an organization invite (role member) and packs it with
///   the app instance id and the space's name into a ``SpaceInvite`` link.
/// - **Join** redeems the invite, which makes the account a member of the
///   organization and so lets it reach the app instance.
public struct CloudSpaces: SpaceDirectory {
    public let client: CalimeroClient
    /// The passkey the account signed in with; minting an invite is a
    /// step-up the node asks that passkey to sign.
    public let passkey: (any PasskeyProvider)?
    /// The release new spaces run; the newest when `nil`.
    public var packageVersion: String?

    public init(client: CalimeroClient, passkey: (any PasskeyProvider)?, packageVersion: String? = nil) {
        self.client = client
        self.passkey = passkey
        self.packageVersion = packageVersion
    }

    public func createSpace(named name: String) async throws -> CreatedSpace {
        let org = try await client.createOrg(name)
        try await client.setOrgMetadata(org, ["name": .string(name), "package": .string(SpaceInvite.appSlug)])
        let app = try await client.createApp(
            name, bundle: .package(SpaceInvite.appSlug, version: packageVersion), org: org, access: .org,
            initArgs: ["name": .string(name)])
        return CreatedSpace(orgId: org, appId: app)
    }

    public func invite(appId: String, spaceName: String) async throws -> SpaceInvite {
        guard let org = try await client.getApp(appId)["org"]?.stringValue, !org.isEmpty else {
            throw SpaceDirectoryError.notInAnOrganization
        }
        guard let passkey else { throw SpaceDirectoryError.notConnected }
        let token = try await client.invite(org, role: .member, passkey: passkey)
        return SpaceInvite(orgId: org, appId: appId, spaceName: spaceName, token: token)
    }

    public func join(_ invite: SpaceInvite) async throws {
        _ = try await client.redeemInvite(invite.token)
    }
}
