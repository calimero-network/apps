import XCTest
import MeroKit
@testable import MeroAR

/// The invite a room hands out, and the paste that redeems it.
///
/// The format is the fleet's (`base58(deflate(JSON))` via `InviteCodec`) on
/// the SDK's link host. These pin the parts this app owns: that a link round-trips, that
/// a pasted link and a bare token both work, and — the one that matters for the
/// login screen — that a plain room id is NOT mistaken for an invitation.
final class RoomInviteTests: XCTestCase {

    private func invite(room: String = "Studio", app: String = "app-123", home: String? = nil) -> RoomInvite {
        RoomInvite(orgId: "org-abc", token: "inv_4f9c2e", appId: app, roomName: room, homeName: home)
    }

    func testRoundTripsThroughItsShareableLink() throws {
        let link = try invite().shareableLink()
        let back = RoomInvite.decode(pasted: link)
        XCTAssertEqual(back, invite())
        XCTAssertEqual(back?.orgId, "org-abc")
        XCTAssertEqual(back?.token, "inv_4f9c2e")
        XCTAssertEqual(back?.appId, "app-123")
    }

    /// An invitation to a whole home carries no room: the joiner lands in the
    /// lobby with the home listed, rather than entering a room.
    func testAHomeInviteRoundTripsAndIsRecognisedAsOne() throws {
        let link = try invite(room: "", app: "", home: "Our flat").shareableLink()
        let back = try XCTUnwrap(RoomInvite.decode(pasted: link))
        XCTAssertTrue(back.isHomeInvite)
        XCTAssertEqual(back.homeName, "Our flat")
        XCTAssertEqual(back.title, "Our flat")
        XCTAssertFalse(invite().isHomeInvite)
        XCTAssertEqual(invite(home: "Our flat").title, "Studio", "a room invite is titled by its room")
    }

    /// An invite minted without a home name still decodes.
    func testAnInviteWithoutAHomeNameStillDecodes() throws {
        let back = try XCTUnwrap(RoomInvite.decode(pasted: try invite().shareableLink()))
        XCTAssertNil(back.homeName)
        XCTAssertEqual(back.title, "Studio")
    }

    func testTheLinkPointsAtThisAppsRegistryPackage() throws {
        let link = try invite().shareableLink()
        XCTAssertTrue(link.hasPrefix("https://links.calimero.network/com.calimero.mero-ar/join?"))
        XCTAssertEqual(RoomInvite.appSlug, "com.calimero.mero-ar")
    }

    func testABareTokenWorksToo() throws {
        let token = try invite().encoded()
        XCTAssertEqual(RoomInvite.decode(pasted: token)?.appId, "app-123")
    }

    func testRoomNameSurvivesNonASCII() throws {
        let link = try invite(room: "Café — 東京 🎨").shareableLink()
        XCTAssertEqual(RoomInvite.decode(pasted: link)?.roomName, "Café — 東京 🎨")
    }

    /// The login field takes either an invite or a room id, and decides which by
    /// trying to decode. An app id must therefore never decode, or entering a
    /// room by id would be routed through the invite path.
    func testAPlainRoomIdIsNotMistakenForAnInvite() {
        XCTAssertFalse(RoomInvite.looksLikeInvite("ctx-123"))
        XCTAssertFalse(RoomInvite.looksLikeInvite("6Uu8Kd3kQXcS2yQ9pTkYyLmR7NqW1vZaB4cD5eF6gH7j"))
        XCTAssertFalse(RoomInvite.looksLikeInvite(""))
        XCTAssertFalse(RoomInvite.looksLikeInvite("   "))
    }

    func testAnInviteIsRecognisedAsOne() throws {
        XCTAssertTrue(RoomInvite.looksLikeInvite(try invite().shareableLink()))
        XCTAssertTrue(RoomInvite.looksLikeInvite(try invite().encoded()))
    }

    /// Another app's link must not be redeemed here — the slug is checked by the
    /// SDK's parser, so this is a guard against that wiring being lost.
    func testAnotherAppsLinkIsRejected() throws {
        let token = try invite().encoded()
        let foreign = "https://links.calimero.network/com.calimero.merostream/join?invitation=\(token)"
        XCTAssertNil(RoomInvite.decode(pasted: foreign))
    }

    /// An invite without the org or its token is useless, and is refused.
    func testAnInviteMissingItsTokenIsRefused() throws {
        let broken = try RoomInvite(orgId: "org-abc", token: "", appId: "app-123", roomName: "Studio").encoded()
        XCTAssertNil(RoomInvite.decode(pasted: broken))
    }
}
