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

    // MARK: - The invitation must survive the round trip byte for byte

    /// An invitation shaped the way a live node actually mints one: `admitters`
    /// non-empty (core#3714 made that true of every rc.29+ invitation), the
    /// envelope's unsigned hints populated, and a key this app's SDK version
    /// does not name.
    ///
    /// The fixtures above are built by this test file, so they can only ever
    /// prove the model agrees with itself — which is exactly how the fleet
    /// shipped a model that dropped four fields. This one pins the property that
    /// matters instead: what comes out of a share link is what went in.
    private func nodeShapedInvitation() -> SignedGroupOpenInvitation {
        SignedGroupOpenInvitation(
            invitation: GroupInvitationFromAdmin(
                inviterIdentity: Array(0..<32),
                groupId: Array(32..<64),
                expirationTimestamp: 1_787_740_000,
                secretSalt: Array(64..<96),
                invitedRole: 1,
                // Signed. Dropping this re-encodes to different borsh than the
                // inviter signed, and the node refuses the join.
                admitters: [String(repeating: "a", count: 64)],
                // A field a later core release might add: it has to survive too,
                // or the next rc repeats the same bug.
                passthrough: ["someFutureField": JSONValue.string("keep me")]
            ),
            inviterSignature: String(repeating: "5", count: 88),
            inviterAccount: String(repeating: "b", count: 64),
            applicationId: Array(96..<128),
            appKey: Array(128..<160)
        )
    }

    /// The signed body must come back identical. `admitters` is the field that
    /// decides whether an rc.29+ node accepts the join at all.
    func testTheSignedBodySurvivesTheShareLink() throws {
        let sent = nodeShapedInvitation()
        let invite = RoomInvite(
            namespaceId: "ns-abc", contextId: "ctx-123", roomName: "Studio", invitation: sent)

        let back = RoomInvite.decode(pasted: try invite.shareableLink())
        let got = try XCTUnwrap(back?.invitation)

        XCTAssertEqual(got.invitation.admitters, sent.invitation.admitters)
        XCTAssertEqual(got.invitation.invitedRole, sent.invitation.invitedRole)
        XCTAssertEqual(got.invitation.expirationTimestamp, sent.invitation.expirationTimestamp)
        XCTAssertEqual(got.invitation.secretSalt, sent.invitation.secretSalt)
        XCTAssertEqual(got.invitation.groupId, sent.invitation.groupId)
        XCTAssertEqual(got.invitation.inviterIdentity, sent.invitation.inviterIdentity)
        XCTAssertEqual(got.inviterSignature, sent.inviterSignature)
    }

    /// A key the SDK does not name must come back too — that is what stops the
    /// next core release from re-introducing the bug.
    func testAnUnknownSignedFieldSurvivesTheShareLink() throws {
        let sent = nodeShapedInvitation()
        let invite = RoomInvite(
            namespaceId: "ns-abc", contextId: "ctx-123", roomName: "Studio", invitation: sent)

        let back = RoomInvite.decode(pasted: try invite.shareableLink())
        let got = try XCTUnwrap(back?.invitation)

        XCTAssertEqual(
            got.invitation.passthrough["someFutureField"], JSONValue.string("keep me"),
            "an unnamed signed field was dropped — the node will refuse this join")
    }

    /// The unsigned hints do not invalidate the signature, but losing them makes
    /// the joiner record zeros for the group meta, and `compute_group_state_hash`
    /// then diverges from the originator permanently.
    func testTheUnsignedBootstrapHintsSurviveTheShareLink() throws {
        let sent = nodeShapedInvitation()
        let invite = RoomInvite(
            namespaceId: "ns-abc", contextId: "ctx-123", roomName: "Studio", invitation: sent)

        let back = RoomInvite.decode(pasted: try invite.shareableLink())
        let got = try XCTUnwrap(back?.invitation)

        XCTAssertEqual(got.inviterAccount, sent.inviterAccount)
        XCTAssertEqual(got.applicationId, sent.applicationId)
        XCTAssertEqual(got.appKey, sent.appKey)
    }
}
