import Foundation
import MeroKit

/// An invitation to one table, in the web app's form (`app/src/utils/invitation.ts`), so a link
/// made on the phone opens in the browser and the other way round:
///
/// - payload: JSON `{"invitation": {"orgId": "…", "token": "inv_…"}, "namespaceId": "…", "contextId": "…"}`
///   (the swift-sdk's `InvitationLinkPayload`)
/// - token: `base58(deflate(payload))` (``InviteCodec``)
/// - link: `https://links.calimero.network/com.calimero.mero-chess/join?invitation=<token>`
///
/// On Calimero 1.0 the invitation is an org invite token (`POST /orgs/{org}/invites`), redeemed
/// with `POST /invites/{token}/redeem`. It admits to the ORG (one link lets someone into every
/// table in it); the context id says which app instance (table) to open once in. A bearer secret:
/// anyone holding the link can join until it expires. Pre-1.0 signed group invitations are refused.
public struct ChessInvitation: Sendable, Identifiable {
    public var id: String { contextId }

    public let invitation: OrgInvitation
    public let namespaceId: String
    public let contextId: String

    public init(invitation: OrgInvitation, namespaceId: String, contextId: String) {
        self.invitation = invitation
        self.namespaceId = namespaceId
        self.contextId = contextId
    }

    private struct Payload: Encodable {
        let invitation: OrgInvitation
        let namespaceId: String
        let contextId: String
    }

    /// The shareable link.
    public func link() throws -> String {
        let token = try InviteCodec.encode(Payload(invitation: invitation, namespaceId: namespaceId, contextId: contextId))
        return InviteLink.invitation(token: token, slug: ChessConstants.packageName)
    }

    /// A pasted link, a deep link or a bare token; nil when it is not a Mero Chess invitation
    /// (another app's link is refused: redeeming it would join that app's org).
    public static func parse(_ input: String) -> ChessInvitation? {
        guard let token = InviteLink.token(fromPasted: input, expectedSlug: ChessConstants.packageName),
            let json = InviteCodec.decode(token: token)
        else { return nil }
        return parse(json: json)
    }

    /// The decoded payload, checked as the web app's `parseInvitationPayload` checks it.
    public static func parse(json: String) -> ChessInvitation? {
        guard let value = try? JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)),
            case .object(let fields) = value,
            let namespaceId = fields["namespaceId"]?.stringValue, !namespaceId.isEmpty,
            let contextId = fields["contextId"]?.stringValue, !contextId.isEmpty,
            let inner = fields["invitation"],
            let token = inner["token"]?.stringValue, !token.isEmpty
        else { return nil }
        let invitation = OrgInvitation(orgId: inner["orgId"]?.stringValue ?? namespaceId, token: token)
        return ChessInvitation(invitation: invitation, namespaceId: namespaceId, contextId: contextId)
    }
}
