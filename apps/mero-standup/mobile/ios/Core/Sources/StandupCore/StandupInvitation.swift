import Foundation
import MeroKit

/// A team invitation in the web app's format (`app/src/utils/invitation.ts`),
/// so a link minted on a phone opens in the browser and the other way round:
///
/// - payload: JSON `{"invitation": <SignedGroupOpenInvitation>, "namespaceId": "…", "contextId": "…"}`
/// - token: `base58(deflate(payload))` (``InviteCodec``, byte-compatible with fflate + bs58)
/// - link: `https://links.calimero.network/com.calimero.mero-standup/join?invitation=<token>`
public struct StandupInvitation: Sendable {
    /// The registry package, which is also the links' slug (`APP_SLUG`).
    public static let packageName = "com.calimero.mero-standup"

    /// The signed envelope, carried through untouched.
    public let invitation: SignedGroupOpenInvitation
    /// The namespace it admits to.
    public let namespaceId: String
    /// The team (context) to open once joined.
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
        return InviteLink.invitation(token: token, slug: Self.packageName)
    }

    /// Read a link (https or `calimero://`) or a bare token. Nil when it is not
    /// a Mero Standup invitation, including another app's link.
    public static func parse(_ input: String) -> StandupInvitation? {
        guard let token = InviteLink.token(fromPasted: input, expectedSlug: packageName),
            let json = InviteCodec.decode(token: token)
        else { return nil }
        return parse(json: json)
    }

    /// Read the decoded payload. Like the web's `parseInvitationPayload`, it
    /// checks the envelope is signed and leaves its fields to the node.
    public static func parse(json: String) -> StandupInvitation? {
        guard let root = try? JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)),
            let namespaceId = root["namespaceId"]?.stringValue, !namespaceId.isEmpty,
            let contextId = root["contextId"]?.stringValue, !contextId.isEmpty,
            let envelope = root["invitation"], case .object(let fields) = envelope,
            fields["inviter_signature"] != nil,
            let data = try? JSONEncoder().encode(envelope),
            let signed = try? JSONDecoder().decode(SignedGroupOpenInvitation.self, from: data)
        else { return nil }
        return StandupInvitation(invitation: signed, namespaceId: namespaceId, contextId: contextId)
    }
}
