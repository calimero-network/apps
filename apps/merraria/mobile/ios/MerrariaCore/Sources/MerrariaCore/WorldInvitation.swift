import Foundation
import MeroKit

/// An invitation to one world, in the web app's form (`app/src/net/inviteCodec.ts`), so a link made
/// on the phone opens in the browser and the other way round:
///
/// - payload: JSON `{"invitation": <SignedGroupOpenInvitation>, "groupAlias": "…", "contextId": "…", "groupId": "…"}`
/// - token: `base58(deflate(payload))` (``InviteCodec``)
/// - link: `https://links.calimero.network/com.calimero.merraria/join?invitation=<token>`
///
/// The invitation admits to the world's namespace (one namespace per world); `groupId` is the open
/// subgroup the world lives in and `contextId` the world itself. Both are optional on the wire, as
/// on the web: an invitation without them opens the namespace's first world.
public struct WorldInvitation: Sendable, Identifiable {
    public var id: String { namespaceId + (contextId ?? "") }

    public let invitation: SignedGroupOpenInvitation
    public let worldName: String?
    public let contextId: String?
    public let groupId: String?

    public init(invitation: SignedGroupOpenInvitation, worldName: String?, contextId: String?, groupId: String?) {
        self.invitation = invitation
        self.worldName = worldName
        self.contextId = contextId
        self.groupId = groupId
    }

    /// The namespace the invitation admits to.
    public var namespaceId: String { AppInvitation(invitation: invitation).namespaceId }

    private struct Payload: Encodable {
        let invitation: SignedGroupOpenInvitation
        let groupAlias: String?
        let contextId: String?
        let groupId: String?
    }

    /// The shareable token.
    public func token() throws -> String {
        try InviteCodec.encode(
            Payload(invitation: invitation, groupAlias: worldName, contextId: contextId, groupId: groupId))
    }

    /// The shareable link.
    public func link() throws -> String {
        InviteLink.invitation(token: try token(), slug: MerrariaConstants.packageName)
    }

    /// A pasted link, a deep link or a bare token; nil when it is not a Merraria invitation (another
    /// app's link is refused: redeeming it would join that app's namespace).
    public static func parse(_ input: String) -> WorldInvitation? {
        guard let token = InviteLink.token(fromPasted: input, expectedSlug: MerrariaConstants.packageName),
            let json = InviteCodec.decode(token: token)
        else { return nil }
        return parse(json: json)
    }

    /// The decoded payload: the wrapped form or a bare signed invitation, as the web's `decodeInvite`.
    public static func parse(json: String) -> WorldInvitation? {
        guard let app = AppInvitation.decode(json: json) else { return nil }
        let value = try? JSONDecoder().decode(JSONValue.self, from: Data(json.utf8))
        let inner = value?["data"] ?? value
        func text(_ key: String) -> String? {
            guard let raw = inner?[key]?.stringValue?.trimmingCharacters(in: .whitespaces), !raw.isEmpty else {
                return nil
            }
            return raw
        }
        return WorldInvitation(
            invitation: app.invitation, worldName: app.name, contextId: text("contextId"), groupId: text("groupId"))
    }
}
