import Foundation
import MeroKit

/// A team invitation on Calimero 1.0: an org invite token in the SDK's link
/// payload (`MeroKitUI.InvitationLinkPayload`), naming the team to open:
///
/// - payload: JSON `{"invitation": {"orgId": "…", "token": "inv_…"}, "namespaceId": "<org>", "contextId": "<app instance>"}`
/// - token: `base58(deflate(payload))` (``InviteCodec``, byte-compatible with fflate + bs58)
/// - link: `https://links.calimero.network/com.calimero.mero-standup/join?invitation=<token>`
public struct StandupInvitation: Sendable {
    /// The registry package, which is also the links' slug (`APP_SLUG`).
    public static let packageName = "com.calimero.mero-standup"

    /// The org invite token (a bearer secret: whoever holds it may join).
    public let invitation: OrgInvitation
    /// The org it admits to.
    public let namespaceId: String
    /// The team (app instance) to open once joined.
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

    /// Read the decoded payload. A pre-1.0 signed group invitation is
    /// refused: it can't be redeemed on a 1.0 cluster.
    public static func parse(json: String) -> StandupInvitation? {
        guard let root = try? JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)),
            let contextId = root["contextId"]?.stringValue, !contextId.isEmpty,
            let envelope = root["invitation"],
            let token = envelope["token"]?.stringValue, !token.isEmpty
        else { return nil }
        let org = envelope["orgId"]?.stringValue ?? root["namespaceId"]?.stringValue
        guard let org, !org.isEmpty else { return nil }
        let namespaceId = root["namespaceId"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 } ?? org
        return StandupInvitation(
            invitation: OrgInvitation(orgId: org, token: token), namespaceId: namespaceId, contextId: contextId)
    }
}
