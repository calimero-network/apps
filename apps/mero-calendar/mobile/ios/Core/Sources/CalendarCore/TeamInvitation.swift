import Foundation
import MeroKit

/// A team invitation on Calimero 1.0: an org invite token, in the SDK's
/// link payload (`MeroKitUI.InvitationLinkPayload`) plus the team's name.
///
/// - payload: `{"invitation": {"orgId": "…", "token": "inv_…"}, "namespaceId": "<org>", "__teamName": "<name>"}`
/// - token: `base58(deflate(payload))` (``InviteCodec``)
/// - link: `https://links.calimero.network/com.calimero.mero-calendar/join?invitation=<token>`
///
/// The invite token is a bearer secret the org's node minted
/// (`POST /orgs/{org}/invites`); joining redeems it (`POST /invites/{token}/redeem`).
/// Reading accepts the name under `__teamName` (or `teamName` / `groupName` /
/// `groupAlias`), a link, a `calimero://` link or a bare token. A pre-1.0
/// signed group invitation is refused: it can't be redeemed on a 1.0 cluster.
public struct TeamInvitation: Sendable {
    public let invitation: OrgInvitation
    public let teamName: String?

    public init(invitation: OrgInvitation, teamName: String?) {
        self.invitation = invitation
        self.teamName = teamName
    }

    /// The org it admits to.
    public var namespaceId: String { invitation.orgId }

    private struct Payload: Encodable {
        let invitation: OrgInvitation
        let namespaceId: String
        let teamName: String?
        enum CodingKeys: String, CodingKey {
            case invitation, namespaceId
            case teamName = "__teamName"
        }
    }

    /// The shareable link.
    public func link() throws -> String {
        let token = try InviteCodec.encode(
            Payload(invitation: invitation, namespaceId: invitation.orgId, teamName: teamName))
        return InviteLink.invitation(token: token, slug: CalendarConstants.packageName)
    }

    /// Read a pasted link, a deep link or a bare token; `nil` when it is no
    /// Mero Calendar invitation (another app's link is refused).
    public static func parse(_ input: String) -> TeamInvitation? {
        guard let token = InviteLink.token(fromPasted: input, expectedSlug: CalendarConstants.packageName),
            let json = InviteCodec.decode(token: token)
        else { return nil }
        return parse(json: json)
    }

    /// Read the decoded payload JSON.
    public static func parse(json: String) -> TeamInvitation? {
        guard let root = try? JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)) else { return nil }
        let payload = root["data"] ?? root
        let name = ["__teamName", "teamName", "groupName", "groupAlias"].lazy
            .compactMap { payload[$0]?.stringValue?.trimmingCharacters(in: .whitespaces) }
            .first { !$0.isEmpty }
        let wrapped: JSONValue = payload["invitation"] ?? payload
        guard let token = wrapped["token"]?.stringValue, !token.isEmpty
        else { return nil }
        let org = wrapped["orgId"]?.stringValue ?? payload["namespaceId"]?.stringValue
        guard let org, !org.isEmpty else { return nil }
        return TeamInvitation(invitation: OrgInvitation(orgId: org, token: token), teamName: name)
    }
}
