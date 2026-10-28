import MeroKit
import XCTest

@testable import IssueTrackerCore

final class InvitationTests: XCTestCase {
    private func signed(group: [Int] = Array(repeating: 7, count: 32)) throws -> SignedGroupOpenInvitation {
        let json = """
            {"invitation":{"inviter_identity":[\(Array(repeating: "1", count: 32).joined(separator: ","))],
            "group_id":[\(group.map(String.init).joined(separator: ","))],"expiration_timestamp":9999999999,
            "secret_salt":[\(Array(repeating: "2", count: 32).joined(separator: ","))]},"inviter_signature":"sig"}
            """
        return try JSONDecoder().decode(SignedGroupOpenInvitation.self, from: Data(json.utf8))
    }

    func testLinkRoundTrip() throws {
        let invite = TrackerInvitation(invitation: try signed(), workspaceName: "Platform team")
        let link = try invite.link()
        let back = try XCTUnwrap(TrackerInvitation.parse(link))
        XCTAssertEqual(back.workspaceName, "Platform team")
        XCTAssertEqual(back.namespaceId, String(repeating: "07", count: 32))
        XCTAssertNotNil(TrackerInvitation.parse("calimero://com.calimero.mero-issue-tracker/join?invitation=\(try invite.token())"))
        XCTAssertNotNil(TrackerInvitation.parse(try invite.token()))
    }

    func testAnotherAppsLinkIsRefused() throws {
        let invite = TrackerInvitation(invitation: try signed(), workspaceName: nil)
        XCTAssertNil(TrackerInvitation.parse("https://links.calimero.network/com.calimero.chat/join?invitation=\(try invite.token())"))
        XCTAssertNil(TrackerInvitation.parse("not an invitation"))
    }

    func testWebShapesAreRead() throws {
        let envelope = String(data: try JSONEncoder().encode(try signed()), encoding: .utf8)!
        let named = try XCTUnwrap(TrackerInvitation.parse(json: #"{"data":{"invitation":\#(envelope),"groupName":"Ops"}}"#))
        XCTAssertEqual(named.workspaceName, "Ops")
        let bare = try XCTUnwrap(TrackerInvitation.parse(json: envelope))
        XCTAssertNil(bare.workspaceName)
    }
}
