import MeroKit
import XCTest
@testable import MeroTag

/// The invite a space hands out, and every way it can come back: the
/// shareable link, a bare token, the app's own deep link.
final class SpaceInviteTests: XCTestCase {
    func testRoundTripsThroughItsShareableLink() throws {
        let back = try XCTUnwrap(SpaceInvite.decode(pasted: try Fixtures.invite().shareableLink()))
        XCTAssertEqual(back, Fixtures.invite())
    }

    func testTheLinkIsTheSDKFormatForThisAppsPackage() throws {
        let link = try Fixtures.invite().shareableLink()
        XCTAssertTrue(link.hasPrefix("https://links.calimero.network/com.calimero.mero-tag/join?invitation="), link)
        XCTAssertEqual(SpaceInvite.appSlug, "com.calimero.mero-tag")
    }

    func testABareTokenWorks() throws {
        XCTAssertEqual(SpaceInvite.decode(pasted: try Fixtures.invite().encoded())?.appId, Fixtures.app)
    }

    func testTheAppsDeepLinkWorks() throws {
        let url = try XCTUnwrap(URL(string: "merotag://join?invitation=\(try Fixtures.invite().encoded())"))
        XCTAssertEqual(SpaceInvite.decode(deepLink: url)?.orgId, Fixtures.org)
        XCTAssertEqual(SpaceInvite.decode(pasted: url.absoluteString)?.token, Fixtures.invite().token)
    }

    func testTheHttpsLinkArrivingAsADeepLinkWorks() throws {
        let url = try XCTUnwrap(URL(string: try Fixtures.invite().shareableLink()))
        XCTAssertEqual(SpaceInvite.decode(deepLink: url)?.spaceName, "Family")
    }

    func testAnotherHostOnTheAppsSchemeIsNotAnInvite() throws {
        XCTAssertNil(SpaceInvite.decode(deepLink: try XCTUnwrap(URL(string: "merotag://open?x=1"))))
    }

    func testAnotherAppsLinkIsRejected() throws {
        let token = try Fixtures.invite().encoded()
        XCTAssertNil(SpaceInvite.decode(pasted: "https://links.calimero.network/com.calimero.mero-ar/join?invitation=\(token)"))
    }

    func testASpaceIdIsNotAnInvite() {
        XCTAssertNil(SpaceInvite.decode(pasted: Fixtures.app))
        XCTAssertNil(SpaceInvite.decode(pasted: "6Uu8Kd3kQXcS2yQ9pTkYyLmR7NqW1vZaB4cD5eF6gH7j"))
        XCTAssertNil(SpaceInvite.decode(pasted: "  "))
    }

    func testAnInviteWithoutATokenIsRejected() throws {
        let empty = SpaceInvite(orgId: Fixtures.org, appId: Fixtures.app, spaceName: "Family", token: "")
        XCTAssertNil(SpaceInvite.decode(pasted: try empty.encoded()))
    }
}
