import Foundation
import MeroKit

/// An invitation to one world: swift-sdk's ``OrgInvitation`` (the link payload every Calimero 1.0
/// app shares), plus the world's team:
///
/// - payload: JSON `{"invitation": "inv_…", "namespaceId": "…", "contextId"?: "…", "name"?: "…", "groupId"?: "…"}`
/// - token: `base58(deflate(payload))` (``InviteCodec``)
/// - link: `https://links.calimero.network/com.calimero.merraria/join?invitation=<token>`
///
/// The invite token admits to the world's organization (one per world); `groupId` is the open team
/// the world lives in and `contextId` the world's app instance. Both are optional: an invitation
/// without them opens the organization's first world.
public struct WorldInvitation: Sendable, Identifiable {
    public var id: String { namespaceId + (contextId ?? "") }

    public let invitation: OrgInvitation
    public let groupId: String?

    public init(invitation: OrgInvitation, worldName: String?, contextId: String?, groupId: String?) {
        self.invitation = OrgInvitation(
            namespaceId: invitation.namespaceId, token: invitation.token, contextId: contextId ?? invitation.contextId,
            name: worldName ?? invitation.name)
        self.groupId = groupId
    }

    /// The organization the invitation admits to: the one the node minted the token for.
    public var namespaceId: String { invitation.namespaceId }
    public var worldName: String? { invitation.name }
    public var contextId: String? { invitation.contextId }

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
                invitation: invitation.token, namespaceId: namespaceId, contextId: contextId, name: worldName,
                groupId: groupId))
    }

    /// The shareable link.
    public func link() throws -> String {
        InviteLink.invitation(token: try token(), slug: MerrariaConstants.packageName)
    }

    /// A pasted link, a deep link or a bare token; nil when it is not a Merraria invitation (another
    /// app's link is refused: redeeming it would join that app's organization).
    public static func parse(_ input: String) -> WorldInvitation? {
        guard let token = InviteLink.token(fromPasted: input, expectedSlug: MerrariaConstants.packageName),
            let json = InviteCodec.decode(token: token)
        else { return nil }
        return parse(json: json)
    }

    /// The decoded payload. Only an ``OrgInvitation`` (an `inv_…` token and its organization) is an
    /// invitation; a pre-1.0 signed one is not.
    public static func parse(json: String) -> WorldInvitation? {
        let data = Data(json.utf8)
        guard let invitation = try? JSONDecoder().decode(OrgInvitation.self, from: data) else { return nil }
        let groupId = (try? JSONDecoder().decode(Payload.self, from: data))?.groupId
        func trimmed(_ value: String?) -> String? {
            guard let value = value?.trimmingCharacters(in: .whitespaces), !value.isEmpty else { return nil }
            return value
        }
        return WorldInvitation(
            invitation: invitation, worldName: trimmed(invitation.name), contextId: trimmed(invitation.contextId),
            groupId: trimmed(groupId))
    }
}
