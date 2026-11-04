import Foundation
import MeroKit

/// A shareable invitation to a space.
///
/// A space is an app instance in an organization. The invitation is an
/// organization invite token (role member); the app instance id and the
/// space's name ride along so the joiner opens the space straight after
/// redeeming it, and sees a name rather than an id.
///
/// The token is the fleet's (`InviteCodec`: `base58(deflate(JSON))`) and the
/// link is the SDK's ``InviteLink`` (`https://links.calimero.network/<package>/join?invitation=…`),
/// so the same link works pasted into Mero Tag or handed to it as a deep link.
public struct SpaceInvite: Codable, Equatable, Sendable {
    /// The organization the space belongs to.
    public let orgId: String
    /// The space's app instance.
    public let appId: String
    /// The space's display name.
    public let spaceName: String
    /// The organization invite token, redeemed at `/invites/{token}/redeem`.
    public let token: String

    public init(orgId: String, appId: String, spaceName: String, token: String) {
        self.orgId = orgId
        self.appId = appId
        self.spaceName = spaceName
        self.token = token
    }

    /// This app's registry package: the link's slug, and what a space runs.
    public static let appSlug = "com.calimero.mero-tag"

    /// The app's own URL scheme.
    public static let deepLinkScheme = "merotag"

    /// The compact token.
    public func encoded() throws -> String { try InviteCodec.encode(self) }

    /// The link to send someone.
    public func shareableLink() throws -> String {
        InviteLink.invitation(token: try encoded(), slug: Self.appSlug)
    }

    /// Decode what someone pasted: the shareable link, a `calimero://` link, a
    /// `merotag://join?invitation=…` deep link, or the bare token. Another
    /// app's link is rejected. Nil when it isn't an invitation.
    public static func decode(pasted: String) -> SpaceInvite? {
        let text = pasted.trimmingCharacters(in: .whitespacesAndNewlines)
        if let url = URL(string: text), url.scheme?.lowercased() == deepLinkScheme {
            return decode(deepLink: url)
        }
        guard let token = InviteLink.token(fromPasted: text, expectedSlug: appSlug) else { return nil }
        return decodeToken(token)
    }

    /// `merotag://join?invitation=…`.
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
            !invite.orgId.isEmpty, !invite.appId.isEmpty, !invite.token.isEmpty
        else { return nil }
        return invite
    }
}
