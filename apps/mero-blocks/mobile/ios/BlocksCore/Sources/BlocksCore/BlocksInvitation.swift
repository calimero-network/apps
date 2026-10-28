import Foundation
import MeroKit

/// An invitation to one world, in the web app's form (`app/src/net/inviteCodec.ts`), so a link
/// made on the phone opens in the browser and the other way round:
///
/// - payload: JSON `{"invitation": <SignedGroupOpenInvitation>, "groupAlias": "…", "contextId": "…", "groupId": "…"}`
/// - token: `base58(deflate(payload))` (``InviteCodec``)
/// - link: `https://links.calimero.network/com.calimero.mero-blocks/join?invitation=<token>`
///
/// A world is its own namespace (one per world), so the namespace invitation admits to exactly
/// that world; `contextId` and `groupId` say which context to enter once in.
public struct BlocksInvitation: Sendable, Identifiable {
    public let invitation: SignedGroupOpenInvitation
    public let name: String?
    public let contextId: String?
    public let groupId: String?

    public init(invitation: SignedGroupOpenInvitation, name: String?, contextId: String?, groupId: String?) {
        self.invitation = invitation
        self.name = name
        self.contextId = contextId
        self.groupId = groupId
    }

    public var namespaceId: String { AppInvitation(invitation: invitation).namespaceId }
    public var id: String { contextId ?? namespaceId }

    private struct Payload: Encodable {
        let invitation: SignedGroupOpenInvitation
        let groupAlias: String?
        let contextId: String?
        let groupId: String?
    }

    /// The shareable token.
    public func token() throws -> String {
        try InviteCodec.encode(Payload(invitation: invitation, groupAlias: name, contextId: contextId, groupId: groupId))
    }

    /// The shareable link.
    public func link() throws -> String {
        InviteLink.invitation(token: try token(), slug: BlocksConstants.packageName)
    }

    /// A pasted link, a deep link or a bare token; nil when it is not a Mero Blocks invitation
    /// (another app's link is refused: redeeming it would join that app's namespace).
    public static func parse(_ input: String) -> BlocksInvitation? {
        guard let token = InviteLink.token(fromPasted: input, expectedSlug: BlocksConstants.packageName),
            let json = InviteCodec.decode(token: token)
        else { return nil }
        return parse(json: json)
    }

    /// The decoded payload: the wrapped form the web app mints, or a bare signed invitation (a
    /// curb-style namespace invite, which then carries no world ids).
    public static func parse(json: String) -> BlocksInvitation? {
        guard let app = AppInvitation.decode(json: json) else { return nil }
        let parsed = try? JSONDecoder().decode(JSONValue.self, from: Data(json.utf8))
        let inner = parsed?["data"] ?? parsed
        func text(_ key: String) -> String? {
            guard let value = inner?[key]?.stringValue?.trimmingCharacters(in: .whitespaces), !value.isEmpty else {
                return nil
            }
            return value
        }
        return BlocksInvitation(
            invitation: app.invitation, name: app.name, contextId: text("contextId"), groupId: text("groupId"))
    }
}
