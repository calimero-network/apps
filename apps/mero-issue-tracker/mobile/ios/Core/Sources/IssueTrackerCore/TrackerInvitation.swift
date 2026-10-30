import Foundation
import MeroKit

/// A workspace invitation on Calimero 1.0: an org invite token, in the SDK's
/// link payload (`MeroKitUI.InvitationLinkPayload`) plus the workspace's name.
///
/// - payload: `{"invitation": {"orgId": "…", "token": "inv_…"}, "namespaceId": "<org>", "groupAlias": "<name>", "kind": "namespace"}`
/// - token: `base58(deflate(payload))` (``InviteCodec``)
/// - link: `https://links.calimero.network/com.calimero.mero-issue-tracker/join?invitation=<token>`
///
/// The invite token is a bearer secret the org's node minted
/// (`POST /orgs/{org}/invites`); joining redeems it (`POST /invites/{token}/redeem`).
/// Reading takes an optional `data` envelope, with `groupName` preferred over
/// `groupAlias`. A link naming another app is refused, and so is a pre-1.0
/// signed group invitation (it can't be redeemed on a 1.0 cluster).
public struct TrackerInvitation: Sendable {
    public let invitation: OrgInvitation
    public let workspaceName: String?

    public init(invitation: OrgInvitation, workspaceName: String?) {
        self.invitation = invitation
        self.workspaceName = workspaceName
    }

    /// The org the invitation admits to.
    public var namespaceId: String { invitation.orgId }

    private struct Payload: Encodable {
        let invitation: OrgInvitation
        let namespaceId: String
        let groupAlias: String?
        let kind: String
    }

    /// The shareable token.
    public func token() throws -> String {
        try InviteCodec.encode(
            Payload(invitation: invitation, namespaceId: namespaceId, groupAlias: workspaceName, kind: "namespace"))
    }

    /// The shareable link.
    public func link() throws -> String {
        InviteLink.invitation(token: try token(), slug: Tracker.packageName)
    }

    /// Read a link (https or `calimero://`) or a bare token; `nil` when it holds no tracker invitation.
    public static func parse(_ input: String) -> TrackerInvitation? {
        guard let token = InviteLink.token(fromPasted: input, expectedSlug: Tracker.packageName),
            let json = InviteCodec.decode(token: token)
        else { return nil }
        return parse(json: json)
    }

    /// Read the decoded payload JSON.
    public static func parse(json: String) -> TrackerInvitation? {
        guard let parsed = try? JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)) else { return nil }
        let inner = parsed["data"] ?? parsed
        let name = [inner["groupName"]?.stringValue, inner["groupAlias"]?.stringValue]
            .compactMap { $0?.trimmingCharacters(in: .whitespaces) }
            .first { !$0.isEmpty }
        let wrapped: JSONValue = inner["invitation"] ?? inner
        guard let token = wrapped["token"]?.stringValue, !token.isEmpty else { return nil }
        let org = wrapped["orgId"]?.stringValue ?? inner["namespaceId"]?.stringValue
        guard let org, !org.isEmpty else { return nil }
        return TrackerInvitation(invitation: OrgInvitation(orgId: org, token: token), workspaceName: name)
    }
}
