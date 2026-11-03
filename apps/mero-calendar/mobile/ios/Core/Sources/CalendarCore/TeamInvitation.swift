import Foundation
import MeroKit

/// A team invitation on Calimero 1.0: an org invite token in the swift-sdk's
/// link payload (`OrgInvitation`, shared with kotlin-sdk), the team's name in
/// its `name`:
///
/// - payload: `{"invitation": "inv_…", "namespaceId": "<org>", "contextId"?: "…", "name"?: "<team>"}`
/// - token: `base58(deflate(payload))` (``InviteCodec``)
/// - link: `https://links.calimero.network/com.calimero.mero-calendar/join?invitation=<token>`
///
/// The invite token is a bearer secret the org's node minted
/// (`POST /orgs/{org}/invites`); joining redeems it (`POST /invites/{token}/redeem`).
/// Reading takes an optional `data` envelope, the name under `name` (or the
/// web app's `__teamName` / `teamName` / `groupName` / `groupAlias`), a link,
/// a `calimero://` link or a bare token. A pre-1.0 signed group invitation is
/// refused: it can't be redeemed on a 1.0 cluster.
public struct TeamInvitation: Sendable {
    public let invitation: OrgInvitation

    public init(invitation: OrgInvitation, teamName: String?) {
        self.invitation = OrgInvitation(
            namespaceId: invitation.namespaceId, token: invitation.token, contextId: invitation.contextId,
            name: teamName ?? invitation.name)
    }

    /// The org it admits to.
    public var namespaceId: String { invitation.namespaceId }
    /// The team's name, for the "Join …?" prompt (unsigned: a hint only).
    public var teamName: String? { invitation.name }

    /// The shareable link.
    public func link() throws -> String {
        try invitation.link(slug: CalendarConstants.packageName)
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
        guard let token = payload["invitation"]?.stringValue, !token.isEmpty,
            let org = payload["namespaceId"]?.stringValue, !org.isEmpty
        else { return nil }
        let name = ["name", "__teamName", "teamName", "groupName", "groupAlias"].lazy
            .compactMap { payload[$0]?.stringValue?.trimmingCharacters(in: .whitespaces) }
            .first { !$0.isEmpty }
        return TeamInvitation(
            invitation: OrgInvitation(namespaceId: org, token: token, contextId: payload["contextId"]?.stringValue),
            teamName: name)
    }
}
