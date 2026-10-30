import MeroKit
import XCTest

@testable import IssueTrackerCore

final class InvitationTests: XCTestCase {
    private let org = String(repeating: "07", count: 32)
    private var invitation: OrgInvitation { OrgInvitation(orgId: org, token: "inv_abc123") }

    func testLinkRoundTrip() throws {
        let invite = TrackerInvitation(invitation: invitation, workspaceName: "Platform team")
        let link = try invite.link()
        let back = try XCTUnwrap(TrackerInvitation.parse(link))
        XCTAssertEqual(back.workspaceName, "Platform team")
        XCTAssertEqual(back.namespaceId, org)
        XCTAssertEqual(back.invitation, invitation)
        XCTAssertNotNil(TrackerInvitation.parse("calimero://com.calimero.mero-issue-tracker/join?invitation=\(try invite.token())"))
        XCTAssertNotNil(TrackerInvitation.parse(try invite.token()))
    }

    func testLinkCarriesTheSDKPayload() throws {
        let token = try TrackerInvitation(invitation: invitation, workspaceName: "Ops").token()
        let json = try XCTUnwrap(InviteCodec.decode(token: token))
        let root = try JSONDecoder().decode(JSONValue.self, from: Data(json.utf8))
        XCTAssertEqual(root["invitation"]?["orgId"]?.stringValue, org)
        XCTAssertEqual(root["invitation"]?["token"]?.stringValue, "inv_abc123")
        XCTAssertEqual(root["namespaceId"]?.stringValue, org)
        XCTAssertEqual(root["groupAlias"]?.stringValue, "Ops")
    }

    func testAnotherAppsLinkIsRefused() throws {
        let invite = TrackerInvitation(invitation: invitation, workspaceName: nil)
        XCTAssertNil(TrackerInvitation.parse("https://links.calimero.network/com.calimero.chat/join?invitation=\(try invite.token())"))
        XCTAssertNil(TrackerInvitation.parse("not an invitation"))
    }

    func testEnvelopeAndNamesAreRead() throws {
        let named = try XCTUnwrap(
            TrackerInvitation.parse(
                json: #"{"data":{"invitation":{"orgId":"\#(org)","token":"inv_x"},"groupName":"Ops","groupAlias":"x"}}"#))
        XCTAssertEqual(named.workspaceName, "Ops")
        XCTAssertEqual(named.invitation.token, "inv_x")
        let bare = try XCTUnwrap(TrackerInvitation.parse(json: #"{"orgId":"\#(org)","token":"inv_y"}"#))
        XCTAssertNil(bare.workspaceName)
    }

    func testPreOneSignedInvitationIsRefused() {
        let json = #"{"invitation":{"invitation":{"group_id":[1,2]},"inviter_signature":"sig"},"groupAlias":"Old"}"#
        XCTAssertNil(TrackerInvitation.parse(json: json))
    }
}
