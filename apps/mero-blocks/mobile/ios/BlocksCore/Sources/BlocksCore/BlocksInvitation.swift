import Foundation
import MeroKit

/// An invitation to one world: swift-sdk's ``OrgInvitation`` (the link payload every Calimero 1.0
/// app shares), plus the world's team:
///
/// - payload: JSON `{"invitation": "inv_…", "namespaceId": "…", "contextId": "…", "name": "…", "groupId": "…"}`
/// - token: `base58(deflate(payload))` (``InviteCodec``)
/// - link: `https://links.calimero.network/com.calimero.mero-blocks/join?invitation=<token>`
///
/// A world is its own organization (one per world), so the invite token admits to exactly that
/// world; `contextId` (its app instance) says what to enter once in. `groupId` is only set by
/// links from the earlier 1.0 build (a world's team).
///
/// The web app's own link (`<frontend>/?invite=inv_…`) is read too: it names no world, so the
/// organization's first world opens once the token is redeemed.
public struct BlocksInvitation: Sendable, Identifiable {
    public let invitation: OrgInvitation
    public let groupId: String?

    public init(invitation: OrgInvitation, name: String?, contextId: String?, groupId: String?) {
        self.invitation = OrgInvitation(
            namespaceId: invitation.namespaceId, token: invitation.token, contextId: contextId ?? invitation.contextId,
            name: name ?? invitation.name)
        self.groupId = groupId
    }

    /// The world's organization: the one the node minted the token for.
    public var namespaceId: String { invitation.namespaceId }
    public var name: String? { invitation.name }
    public var contextId: String? { invitation.contextId }
    public var id: String { contextId ?? namespaceId }

    private struct Payload: Codable {
        let invitation: String
        let namespaceId: String
        let contextId: String?
        let name: String?
        let groupId: String?
    }

    /// The shareable token.
    public func token() throws -> String {
        try InviteCodec.encode(
            Payload(
                invitation: invitation.token, namespaceId: namespaceId, contextId: contextId, name: name, groupId: groupId))
    }

    /// The shareable link.
    public func link() throws -> String {
        InviteLink.invitation(token: try token(), slug: BlocksConstants.packageName)
    }

    /// A pasted link, a deep link or a bare token; nil when it is not a Mero Blocks invitation
    /// (another app's link is refused: redeeming it would join that app's organization).
    public static func parse(_ input: String) -> BlocksInvitation? {
        if let web = parseWebLink(input) { return web }
        guard let token = InviteLink.token(fromPasted: input, expectedSlug: BlocksConstants.packageName),
            let json = InviteCodec.decode(token: token)
        else { return nil }
        return parse(json: json)
    }

    /// The web frontend's link, `?invite=inv_…`: a token with no organization named, which
    /// ``WorldsModel/join(_:didJoin:)`` learns by redeeming it.
    static func parseWebLink(_ input: String) -> BlocksInvitation? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let components = URLComponents(string: trimmed), components.scheme?.hasPrefix("http") == true,
            let token = components.queryItems?.first(where: { $0.name == "invite" })?.value, token.hasPrefix("inv_")
        else { return nil }
        return BlocksInvitation(invitation: OrgInvitation(namespaceId: "", token: token), name: nil, contextId: nil, groupId: nil)
    }

    /// The decoded payload. Only an ``OrgInvitation`` (an `inv_…` token and its organization) is
    /// an invitation; a pre-1.0 signed one is not. A link without `contextId` opens the world's
    /// first app instance.
    public static func parse(json: String) -> BlocksInvitation? {
        let data = Data(json.utf8)
        guard let invitation = try? JSONDecoder().decode(OrgInvitation.self, from: data) else { return nil }
        let groupId = (try? JSONDecoder().decode(Payload.self, from: data))?.groupId
        func trimmed(_ value: String?) -> String? {
            guard let value = value?.trimmingCharacters(in: .whitespaces), !value.isEmpty else { return nil }
            return value
        }
        return BlocksInvitation(
            invitation: invitation, name: trimmed(invitation.name), contextId: trimmed(invitation.contextId),
            groupId: trimmed(groupId))
    }
}
