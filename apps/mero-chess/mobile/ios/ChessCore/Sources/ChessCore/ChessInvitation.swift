import Foundation
import MeroKit

/// An invitation to one table, as the swift-sdk's `OrgInvitation` link payload, so a link made on
/// the phone opens in the browser and the other way round:
///
/// - payload: JSON `{"invitation": "inv_…", "namespaceId": "<org>", "contextId": "<table>", "name": "<club, optional>"}`
/// - token: `base58(deflate(payload))` (``InviteCodec``)
/// - link: `https://links.calimero.network/com.calimero.mero-chess/join?invitation=<token>`
///
/// On Calimero 1.0 the invitation is an org invite token (`POST /orgs/{org}/invites`), redeemed
/// with `POST /invites/{token}/redeem`. It admits to the ORG (one link lets someone into every
/// table in it); the context id says which app instance (table) to open once in. A bearer secret:
/// anyone holding the link can join until it expires. Pre-1.0 signed group invitations are refused.
public struct ChessInvitation: Sendable, Identifiable {
    public var id: String { contextId }

    /// The invite, with ``contextId`` set.
    public let invitation: OrgInvitation
    public let namespaceId: String
    public let contextId: String

    public init(invitation: OrgInvitation, namespaceId: String, contextId: String) {
        self.invitation = OrgInvitation(
            namespaceId: namespaceId, token: invitation.token, contextId: contextId, name: invitation.name)
        self.namespaceId = namespaceId
        self.contextId = contextId
    }

    /// The shareable link.
    public func link() throws -> String {
        try invitation.link(slug: ChessConstants.packageName)
    }

    /// A pasted link, a deep link or a bare token; nil when it is not a Mero Chess invitation
    /// (another app's link is refused: redeeming it would join that app's org).
    public static func parse(_ input: String) -> ChessInvitation? {
        guard let token = InviteLink.token(fromPasted: input, expectedSlug: ChessConstants.packageName),
            let json = InviteCodec.decode(token: token)
        else { return nil }
        return parse(json: json)
    }

    /// The decoded payload: the token from the string `invitation`, the org from `namespaceId`,
    /// the table from `contextId`.
    public static func parse(json: String) -> ChessInvitation? {
        guard let value = try? JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)),
            case .object(let fields) = value,
            let namespaceId = fields["namespaceId"]?.stringValue, !namespaceId.isEmpty,
            let contextId = fields["contextId"]?.stringValue, !contextId.isEmpty,
            let token = fields["invitation"]?.stringValue, !token.isEmpty
        else { return nil }
        let name = fields["name"]?.stringValue
        return ChessInvitation(
            invitation: OrgInvitation(namespaceId: namespaceId, token: token, name: name), namespaceId: namespaceId,
            contextId: contextId)
    }
}
