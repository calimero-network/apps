import MeroKit
import XCTest
@testable import MeroTag

/// The invite a space hands out, and every way it can come back: the
/// shareable link, a bare token, the app's own deep link.
final class SpaceInviteTests: XCTestCase {
    func testRoundTripsThroughItsShareableLink() throws {
        let back = try XCTUnwrap(SpaceInvite.decode(pasted: try Fixtures.invite().shareableLink()))
        XCTAssertEqual(back.namespaceId, Fixtures.namespace)
        XCTAssertEqual(back.contextId, Fixtures.context)
        XCTAssertEqual(back.spaceName, "Family")
    }

    func testTheLinkIsTheSDKFormatForThisAppsPackage() throws {
        let link = try Fixtures.invite().shareableLink()
        XCTAssertTrue(link.hasPrefix("https://links.calimero.network/com.calimero.mero-tag/join?invitation="), link)
        XCTAssertEqual(SpaceInvite.appSlug, "com.calimero.mero-tag")
    }

    func testABareTokenWorks() throws {
        XCTAssertEqual(SpaceInvite.decode(pasted: try Fixtures.invite().encoded())?.contextId, Fixtures.context)
    }

    func testTheAppsDeepLinkWorks() throws {
        let url = try XCTUnwrap(URL(string: "merotag://join?invitation=\(try Fixtures.invite().encoded())"))
        XCTAssertEqual(SpaceInvite.decode(deepLink: url)?.namespaceId, Fixtures.namespace)
        XCTAssertEqual(SpaceInvite.decode(pasted: url.absoluteString)?.namespaceId, Fixtures.namespace)
    }

    func testTheHttpsLinkArrivingAsADeepLinkWorks() throws {
        let url = try XCTUnwrap(URL(string: try Fixtures.invite().shareableLink()))
        XCTAssertEqual(SpaceInvite.decode(deepLink: url)?.spaceName, "Family")
    }

    /// The wallet returns to the same scheme; that is not an invite.
    func testTheWalletCallbackIsNotAnInvite() throws {
        XCTAssertNil(SpaceInvite.decode(deepLink: try XCTUnwrap(URL(string: "merotag://enrol#credential=x"))))
    }

    func testAnotherAppsLinkIsRejected() throws {
        let token = try Fixtures.invite().encoded()
        XCTAssertNil(SpaceInvite.decode(pasted: "https://links.calimero.network/com.calimero.mero-ar/join?invitation=\(token)"))
    }

    func testASpaceIdIsNotAnInvite() {
        XCTAssertNil(SpaceInvite.decode(pasted: Fixtures.context))
        XCTAssertNil(SpaceInvite.decode(pasted: "6Uu8Kd3kQXcS2yQ9pTkYyLmR7NqW1vZaB4cD5eF6gH7j"))
        XCTAssertNil(SpaceInvite.decode(pasted: "  "))
    }

    /// What the account signed must come back byte for byte, or the join is refused.
    func testTheSignedInvitationSurvives() throws {
        let back = try XCTUnwrap(SpaceInvite.decode(pasted: try Fixtures.invite().shareableLink()))
        XCTAssertEqual(back.invitation.invitation.admitters, [Fixtures.account])
        XCTAssertEqual(back.invitation.inviterSignature, Fixtures.invite().invitation.inviterSignature)
        XCTAssertEqual(back.invitation.inviterAccount, Fixtures.account)
    }
}
