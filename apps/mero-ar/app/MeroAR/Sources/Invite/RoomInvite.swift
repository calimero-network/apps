import Foundation
import MeroKit

/// A shareable invitation to an AR room, or to a whole home.
///
/// On Calimero 1.0 a home is an organization and a room is one of its app
/// instances. The invitation is an org invite token (`POST /orgs/{org}/invites`,
/// role member), which the joiner redeems as their own account
/// (`POST /invites/{token}/redeem`). The room's app id and the names ride
/// along, so the joiner enters the room straight away and sees names, not ids.
///
/// The token is the fleet's (`InviteCodec`: `base58(deflate(JSON))`) and the
/// link is the SDK's ``InviteLink``
/// (`https://links.calimero.network/com.calimero.mero-ar/join?invitation=…`).
public struct RoomInvite: Codable, Equatable {
    /// The home (organization) the invite admits to.
    public let orgId: String
    /// The org invite token.
    public let token: String
    /// The room to enter after redeeming. Empty on an invitation to a whole
    /// home (``isHomeInvite``).
    public let appId: String
    /// The room's display name.
    public let roomName: String
    /// The home's display name.
    public let homeName: String?

    public init(orgId: String, token: String, appId: String, roomName: String, homeName: String? = nil) {
        self.orgId = orgId
        self.token = token
        self.appId = appId
        self.roomName = roomName
        self.homeName = homeName
    }

    /// An invitation to a home rather than to one room in it: the joiner
    /// lands in the lobby with the home's rooms listed.
    public var isHomeInvite: Bool { appId.isEmpty }

    /// What the invitation is to, in words: the room, else the home.
    public var title: String {
        if !roomName.isEmpty { return roomName }
        return homeName ?? ""
    }

    /// This app's link slug: its registry package.
    public static let appSlug = "com.calimero.mero-ar"

    /// The compact token, in the format the rest of the fleet uses.
    public func encoded() throws -> String {
        try InviteCodec.encode(self)
    }

    /// The link to actually send someone.
    public func shareableLink() throws -> String {
        InviteLink.invitation(token: try encoded(), slug: Self.appSlug)
    }

    /// Decode a pasted invite: a shareable link, a `calimero://` link, or the
    /// bare token. Another app's link is rejected by its slug. Nil when the
    /// input is not a Mero AR invitation.
    public static func decode(pasted: String) -> RoomInvite? {
        guard let token = InviteLink.token(fromPasted: pasted, expectedSlug: appSlug) else {
            return nil
        }
        guard let invite = try? InviteCodec.decode(RoomInvite.self, from: token),
            !invite.orgId.isEmpty, !invite.token.isEmpty
        else { return nil }
        return invite
    }

    /// True when the text looks like an invitation rather than a bare room id.
    ///
    /// Used by the lobby to decide what was pasted: a room id is a plain app
    /// id, an invitation decodes to this type.
    public static func looksLikeInvite(_ text: String) -> Bool {
        decode(pasted: text) != nil
    }
}
