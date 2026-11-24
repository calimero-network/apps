import Foundation
import MeroKit
import OpenAPIRuntime
import TagCore

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
    /// The person declined the change on the consent page, or left it undecided.
    case notApproved(declined: Bool)
    /// The consent page could not be opened (the reason in words).
    case consentUnavailable(String)

    public var errorDescription: String? {
        switch self {
        case .notConnected:
            return "You're not connected to a Calimero cluster."
        case .notInAnOrganization:
            return "This space doesn't belong to an organization, so there's no one to invite into."
        case .notApproved(let declined):
            return declined ? "Declined. Nothing was changed." : "Not approved. Nothing was changed."
        case .consentUnavailable(let reason):
            return reason
        }
    }
}

/// Asks the person to approve an organization action on the node's consent
/// page, and answers the node's decision. `request` builds the request for
/// the `returnTo` the page sends the person back to.
public typealias OrgConsent =
    @Sendable (_ request: @escaping @Sendable (_ returnTo: String) -> ConsentRequest) async throws -> ConsentResult

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
///
/// On Calimero Cloud the session is bound to Mero Tag's package (it was
/// opened on Mero Tag's served page), and the node refuses it organization
/// routes: founding the organization, minting and redeeming the invite are
/// approved on the node's consent page instead (`consent`). On a development
/// cluster (`consent` is `nil`) they are called directly.
public struct CloudSpaces: SpaceDirectory {
    public let client: CalimeroClient
    /// Step-ups the node asks of a direct call (a development cluster's
    /// invite): the account's passkey.
    public let passkey: (any PasskeyProvider)?
    /// Where organization actions are approved; `nil`: call the node directly.
    public let consent: OrgConsent?
    /// The release new spaces run; the newest when `nil`.
    public var packageVersion: String?

    public init(
        client: CalimeroClient, passkey: (any PasskeyProvider)?, consent: OrgConsent? = nil,
        packageVersion: String? = nil
    ) {
        self.client = client
        self.passkey = passkey
        self.consent = consent
        self.packageVersion = packageVersion
    }

    public func createSpace(named name: String) async throws -> CreatedSpace {
        let org: String
        if let consent {
            org = try Self.approved(try await consent { .createOrg(name: name, returnTo: $0) }).orgId ?? ""
            guard !org.isEmpty else { throw AccountError.protocolViolation("the node made no organization") }
        } else {
            org = try await client.orgs.create(name: name).orgId
        }
        let metadata: JSONValue = ["name": .string(name), "package": .string(SpaceInvite.appSlug)]
        _ = try await client.orgs.metadata(org: org, metadata: try OpenAPIValueContainer(metadata))
        let app = try await client.apps.create(
            name: name, package: SpaceInvite.appSlug, version: packageVersion, org: org,
            initArgs: try OpenAPIValueContainer(["name": .string(name)])
        ).appId
        return CreatedSpace(orgId: org, appId: app)
    }

    public func invite(appId: String, spaceName: String) async throws -> SpaceInvite {
        let record = try JSONValue(encoding: try await client.apps.get(app: appId))
        guard let org = record["org"]?.stringValue, !org.isEmpty else {
            throw SpaceDirectoryError.notInAnOrganization
        }
        let token: String
        if let consent {
            token = try Self.approved(try await consent { .createInvite(org: org, role: .member, returnTo: $0) })
                .inviteToken ?? ""
            guard !token.isEmpty else { throw AccountError.protocolViolation("the node made no invite") }
        } else {
            guard let passkey else { throw SpaceDirectoryError.notConnected }
            token = try await client.orgs.inviteCreate(org: org, role: .member, passkey: passkey).token
        }
        return SpaceInvite(orgId: org, appId: appId, spaceName: spaceName, token: token)
    }

    public func join(_ invite: SpaceInvite) async throws {
        if let consent {
            _ = try Self.approved(try await consent { .acceptInvite(token: invite.token, returnTo: $0) })
        } else {
            _ = try await client.orgs.inviteRedeem(token: invite.token)
        }
    }

    /// `result` when the person approved it; otherwise why not.
    static func approved(_ result: ConsentResult) throws -> ConsentResult {
        guard result.isApproved else { throw SpaceDirectoryError.notApproved(declined: result.status == .declined) }
        return result
    }
}
