import Foundation
import MeroKit

/// An invitation to one arena: swift-sdk's ``OrgInvitation`` (the link payload every Calimero 1.0
/// app shares):
///
/// - payload: JSON `{"invitation": "inv_…", "namespaceId": "…", "contextId": "…"}`
/// - token: `base58(deflate(payload))` (``InviteCodec``)
/// - link: `https://links.calimero.network/com.calimero.mero-kombat/join?invitation=<token>`
///
/// The invite token admits to the ORGANIZATION (one link lets someone into every arena in it); the
/// app instance id says which arena to open once in.
public struct KombatInvitation: Sendable, Identifiable {
    public var id: String { contextId }

    public let invitation: OrgInvitation
    public let contextId: String

    public init(invitation: OrgInvitation, contextId: String) {
        self.invitation = OrgInvitation(
            namespaceId: invitation.namespaceId, token: invitation.token, contextId: contextId, name: invitation.name)
        self.contextId = contextId
    }

    /// The organization it admits to: the one the node minted the token for.
    public var namespaceId: String { invitation.namespaceId }

    /// The shareable link.
    public func link() throws -> String {
        try invitation.link(slug: KombatConstants.packageName)
    }

    /// A pasted link, a deep link or a bare token; nil when it is not a Mero Kombat invitation
    /// (another app's link is refused: redeeming it would join that app's organization).
    public static func parse(_ input: String) -> KombatInvitation? {
        guard let token = InviteLink.token(fromPasted: input, expectedSlug: KombatConstants.packageName),
            let json = InviteCodec.decode(token: token)
        else { return nil }
        return parse(json: json)
    }

    /// The decoded payload: an ``OrgInvitation`` that names the arena. A pre-1.0 signed invitation
    /// is refused.
    public static func parse(json: String) -> KombatInvitation? {
        guard let invitation = try? JSONDecoder().decode(OrgInvitation.self, from: Data(json.utf8)),
            let contextId = invitation.contextId, !contextId.isEmpty
        else { return nil }
        return KombatInvitation(invitation: invitation, contextId: contextId)
    }
}
