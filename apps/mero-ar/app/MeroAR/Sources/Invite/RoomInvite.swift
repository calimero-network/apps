import Foundation
import MeroKit

/// A shareable invitation to an AR room.
///
/// The room's namespace id travels with the signed invitation so the joiner does
/// not have to decode the raw group-id bytes to know what to join, and the
/// context id travels too so it can enter the room straight after joining rather
/// than polling for which context appeared.
///
/// ## How this is meant to be used
///
/// MeroAR is a client of a node that runs on a computer, so the *link* is not
/// something this app opens. It is something you send someone, who opens it on
/// the machine with Calimero Desktop: the launcher resolves the slug, installs
/// the app if it is missing, and joins the namespace there. The phone's part is
/// to produce that link, and to accept one pasted back in — which is what
/// ``token(fromPasted:)`` is for.
public struct RoomInvite: Codable {
    /// The namespace (root group) the room lives in.
    public let namespaceId: String
    /// The room context, so the joiner can enter without guessing.
    public let contextId: String
    /// The room's display name, so the joiner sees a name and not an id.
    public let roomName: String
    /// The node's signed invitation.
    public let invitation: SignedGroupOpenInvitation

    public init(
        namespaceId: String,
        contextId: String,
        roomName: String,
        invitation: SignedGroupOpenInvitation
    ) {
        self.namespaceId = namespaceId
        self.contextId = contextId
        self.roomName = roomName
        self.invitation = invitation
    }

    /// This app's deep-link slug — its registry package, which is what the
    /// desktop launcher matches against `Application.package`.
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
    /// bare token. Returns nil when the input is not an invitation at all, so
    /// the caller can tell "not an invite" from "a broken invite".
    ///
    /// Rejects another app's invitation before trying to read it: a link for a
    /// different app decodes perfectly well — the payload shape is shared across
    /// the fleet — and redeeming it would join a namespace belonging to some
    /// other app's context.
    ///
    /// `expectedSlug:` is swift-sdk#25, which this app's pin now carries; the
    /// hand-rolled segment check that stood here until then is gone. The SDK
    /// compares whole path segments (so `com.calimero.mero` cannot match
    /// `com.calimero.mero-ar`), case-insensitively, and still accepts a *bare
    /// token*, which carries no slug — the same latitude the web apps give a
    /// pasted code.
    public static func decode(pasted: String) -> RoomInvite? {
        guard let token = InviteLink.token(fromPasted: pasted, expectedSlug: appSlug) else {
            return nil
        }
        return try? InviteCodec.decode(RoomInvite.self, from: token)
    }

    /// True when the text looks like an invitation rather than a bare room id.
    ///
    /// Used by the login screen to decide which field the user filled in: a room
    /// id is a plain context id, an invitation decodes to this type.
    public static func looksLikeInvite(_ text: String) -> Bool {
        decode(pasted: text) != nil
    }
}
