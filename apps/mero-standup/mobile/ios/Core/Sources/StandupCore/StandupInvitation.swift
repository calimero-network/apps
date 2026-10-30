import Foundation
import MeroKit

/// A team invitation on Calimero 1.0: the SDK's ``OrgInvitation`` link
/// payload, naming the team (app instance) to open:
///
/// - payload: JSON `{"invitation": "inv_…", "namespaceId": "<org>", "contextId": "<app instance>", "name": "<team name, optional>"}`
/// - token: `base58(deflate(payload))` (``InviteCodec``, byte-compatible with fflate + bs58)
/// - link: `https://links.calimero.network/com.calimero.mero-standup/join?invitation=<token>`
///
/// The invite token is a bearer secret the org's node minted; joining redeems
/// it (`POST /invites/{token}/redeem`). A pre-1.0 signed group invitation (an
/// object under `invitation`) is refused: it can't be redeemed on a 1.0 cluster.
public struct StandupInvitation: Sendable {
    /// The registry package, which is also the links' slug (`APP_SLUG`).
    public static let packageName = "com.calimero.mero-standup"

    /// The org invitation (its token is a bearer secret: whoever holds it may join).
    public let invitation: OrgInvitation
    /// The org it admits to.
    public var namespaceId: String { invitation.namespaceId }
    /// The team (app instance) to open once joined.
    public let contextId: String
    /// The team's name, for the "Join …?" prompt. Unsigned: a hint only.
    public var name: String? { invitation.name }

    public init(invitation: OrgInvitation, contextId: String? = nil) {
        let context = contextId ?? invitation.contextId ?? ""
        self.invitation = OrgInvitation(
            namespaceId: invitation.namespaceId, token: invitation.token, contextId: context,
            name: invitation.name)
        self.contextId = context
    }

    /// The shareable link.
    public func link() throws -> String {
        try invitation.link(slug: Self.packageName)
    }

    /// Read a link (https or `calimero://`) or a bare token. Nil when it is not
    /// a Mero Standup invitation, including another app's link.
    public static func parse(_ input: String) -> StandupInvitation? {
        guard let token = InviteLink.token(fromPasted: input, expectedSlug: packageName),
            let json = InviteCodec.decode(token: token)
        else { return nil }
        return parse(json: json)
    }

    /// Read the decoded payload: the token from `invitation` (a string), the
    /// org from `namespaceId`, the team from `contextId`, the name from `name`
    /// (then the legacy `teamName`).
    public static func parse(json: String) -> StandupInvitation? {
        guard let root = try? JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)),
            let token = root["invitation"]?.stringValue, !token.isEmpty,
            let org = root["namespaceId"]?.stringValue, !org.isEmpty,
            let contextId = root["contextId"]?.stringValue, !contextId.isEmpty
        else { return nil }
        let name = ["name", "teamName"].lazy
            .compactMap { root[$0]?.stringValue?.trimmingCharacters(in: .whitespaces) }
            .first { !$0.isEmpty }
        return StandupInvitation(
            invitation: OrgInvitation(namespaceId: org, token: token, contextId: contextId, name: name))
    }
}
