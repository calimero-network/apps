import Foundation
import MeroKit

/// An invitation to one arena, in the web app's form (`app/src/utils/invitation.ts`), so a link
/// made on the phone opens in the browser and the other way round:
///
/// - payload: JSON `{"invitation": <SignedGroupOpenInvitation>, "namespaceId": "…", "contextId": "…"}`
/// - token: `base58(deflate(payload))` (``InviteCodec``)
/// - link: `https://links.calimero.network/com.calimero.mero-kombat/join?invitation=<token>`
///
/// The invitation admits to the NAMESPACE (one link lets someone into every arena in it); the
/// context id says which arena to open once in.
public struct KombatInvitation: Sendable, Identifiable {
    public var id: String { contextId }

    public let invitation: SignedGroupOpenInvitation
    public let namespaceId: String
    public let contextId: String

    public init(invitation: SignedGroupOpenInvitation, namespaceId: String, contextId: String) {
        self.invitation = invitation
        self.namespaceId = namespaceId
        self.contextId = contextId
    }

    private struct Payload: Encodable {
        let invitation: SignedGroupOpenInvitation
        let namespaceId: String
        let contextId: String
    }

    /// The shareable link.
    public func link() throws -> String {
        let token = try InviteCodec.encode(Payload(invitation: invitation, namespaceId: namespaceId, contextId: contextId))
        return InviteLink.invitation(token: token, slug: KombatConstants.packageName)
    }

    /// A pasted link, a deep link or a bare token; nil when it is not a Mero Kombat invitation
    /// (another app's link is refused: redeeming it would join that app's namespace).
    public static func parse(_ input: String) -> KombatInvitation? {
        guard let token = InviteLink.token(fromPasted: input, expectedSlug: KombatConstants.packageName),
            let json = InviteCodec.decode(token: token)
        else { return nil }
        return parse(json: json)
    }

    /// The decoded payload, checked as the web app's `parseInvitationPayload` checks it.
    public static func parse(json: String) -> KombatInvitation? {
        guard let value = try? JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)),
            case .object(let fields) = value,
            let namespaceId = fields["namespaceId"]?.stringValue, !namespaceId.isEmpty,
            let contextId = fields["contextId"]?.stringValue, !contextId.isEmpty,
            let signed = fields["invitation"], case .object(let inner) = signed,
            inner["inviter_signature"] != nil,
            let data = try? JSONEncoder().encode(signed),
            let invitation = try? JSONDecoder().decode(SignedGroupOpenInvitation.self, from: data)
        else { return nil }
        return KombatInvitation(invitation: invitation, namespaceId: namespaceId, contextId: contextId)
    }
}
