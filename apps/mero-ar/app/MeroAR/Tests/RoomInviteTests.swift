import XCTest
import MeroKit
@testable import MeroAR

/// The invite a room hands out, and the paste that redeems it.
///
/// The format is deliberately the fleet's (`base58(deflate(JSON))` via
/// `InviteCodec`), so a link produced here is redeemable by Calimero Desktop and
/// the web apps. These pin the parts this app owns: that a link round-trips, that
/// a pasted link and a bare token both work, and — the one that matters for the
/// login screen — that a plain room id is NOT mistaken for an invitation.
final class RoomInviteTests: XCTestCase {

    private func invite(room: String = "Studio") -> RoomInvite {
        RoomInvite(
            namespaceId: "ns-abc",
            contextId: "ctx-123",
            roomName: room,
            invitation: SignedGroupOpenInvitation(
                invitation: GroupInvitationFromAdmin(
                    inviterIdentity: Array(0..<32),
                    groupId: Array(32..<64),
                    expirationTimestamp: 1_787_740_000_000,
                    secretSalt: Array(64..<96)
                ),
                inviterSignature: String(repeating: "5", count: 88)
            )
        )
    }

    func testRoundTripsThroughItsShareableLink() throws {
        let link = try invite().shareableLink()
        let back = RoomInvite.decode(pasted: link)
        XCTAssertEqual(back?.namespaceId, "ns-abc")
        XCTAssertEqual(back?.contextId, "ctx-123")
        XCTAssertEqual(back?.roomName, "Studio")
    }

    func testTheLinkPointsAtThisAppsRegistryPackage() throws {
        let link = try invite().shareableLink()
        XCTAssertTrue(link.hasPrefix("https://links.calimero.network/com.calimero.mero-ar/join?"))
        XCTAssertEqual(RoomInvite.appSlug, "com.calimero.mero-ar")
    }

    func testABareTokenWorksToo() throws {
        let token = try invite().encoded()
        XCTAssertEqual(RoomInvite.decode(pasted: token)?.contextId, "ctx-123")
    }

    func testRoomNameSurvivesNonASCII() throws {
        let link = try invite(room: "Café — 東京 🎨").shareableLink()
        XCTAssertEqual(RoomInvite.decode(pasted: link)?.roomName, "Café — 東京 🎨")
    }

    /// The login field takes either an invite or a room id, and decides which by
    /// trying to decode. A context id must therefore never decode, or entering a
    /// room by id would be routed through the namespace-join path.
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
}
