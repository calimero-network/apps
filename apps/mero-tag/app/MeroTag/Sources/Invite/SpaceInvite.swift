import Foundation
import MeroKit

/// A shareable invitation to a space.
///
/// A space is a context inside a namespace. The invitation is to the
/// namespace, signed by the inviting account on its device; the context id and
/// the space's name ride along so the joiner can open the space straight after
/// joining and sees a name rather than an id.
///
/// The token is the fleet's (`InviteCodec`: `base58(deflate(JSON))`) and the
/// link is the SDK's ``InviteLink`` (`https://links.calimero.network/<package>/join?invitation=…`),
/// so the same link works pasted into Mero Tag on a phone, opened on a computer
/// with Calimero Desktop, or handed to the app as a deep link.
public struct SpaceInvite: Codable {
    /// The namespace (root group) the space lives in.
    public let namespaceId: String
    /// The space's context.
    public let contextId: String
    /// The space's display name.
    public let spaceName: String
    /// The account-signed invitation.
    public let invitation: SignedGroupOpenInvitation

    public init(namespaceId: String, contextId: String, spaceName: String, invitation: SignedGroupOpenInvitation) {
        self.namespaceId = namespaceId
        self.contextId = contextId
        self.spaceName = spaceName
        self.invitation = invitation
    }

    /// This app's registry package: the link's slug, and what a space is
    /// founded for.
    public static let appSlug = "com.calimero.mero-tag"

    /// The app's own URL scheme (`AppState.callbackScheme`, which the wallet
    /// also returns to).
    public static let deepLinkScheme = "merotag"

    /// The compact token.
    public func encoded() throws -> String { try InviteCodec.encode(self) }

    /// The link to send someone.
    public func shareableLink() throws -> String {
        InviteLink.invitation(token: try encoded(), slug: Self.appSlug)
    }

    /// Decode what someone pasted: the shareable link, a `calimero://` link, a
    /// `merotag://join?invitation=…` deep link, or the bare token. Another
    /// app's link is rejected (its payload would decode, and join a namespace
    /// that isn't a Mero Tag space). Nil when it isn't an invitation.
    public static func decode(pasted: String) -> SpaceInvite? {
        let text = pasted.trimmingCharacters(in: .whitespacesAndNewlines)
        if let url = URL(string: text), url.scheme?.lowercased() == deepLinkScheme {
            return decode(deepLink: url)
        }
        guard let token = InviteLink.token(fromPasted: text, expectedSlug: appSlug) else { return nil }
        return decodeToken(token)
    }

    /// `merotag://join?invitation=…` — the app's own scheme, which the wallet
    /// also uses (`merotag://enrol`), so only the `join` host is an invite.
    public static func decode(deepLink url: URL) -> SpaceInvite? {
        if url.scheme?.lowercased() != deepLinkScheme { return decode(pasted: url.absoluteString) }
        guard url.host?.lowercased() == InviteLink.joinAction,
            let token = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?
                .first(where: { $0.name == InviteLink.invitationParam })?.value
        else { return nil }
        return decodeToken(token)
    }

    private static func decodeToken(_ token: String) -> SpaceInvite? {
        guard let invite = try? InviteCodec.decode(SpaceInvite.self, from: token),
            !invite.namespaceId.isEmpty, !invite.contextId.isEmpty
        else { return nil }
        return invite
    }
}
