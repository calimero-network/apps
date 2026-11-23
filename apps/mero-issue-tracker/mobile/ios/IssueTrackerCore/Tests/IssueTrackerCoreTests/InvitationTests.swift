import MeroKit
import XCTest

@testable import IssueTrackerCore

final class InvitationTests: XCTestCase {
    private let org = String(repeating: "07", count: 32)
    private var invitation: OrgInvitation { OrgInvitation(namespaceId: org, token: "inv_abc123") }

    func testLinkRoundTrip() throws {
        let invite = TrackerInvitation(invitation: invitation, workspaceName: "Platform team")
        let link = try invite.link()
        let back = try XCTUnwrap(TrackerInvitation.parse(link))
        XCTAssertEqual(back.workspaceName, "Platform team")
        XCTAssertEqual(back.namespaceId, org)
        XCTAssertEqual(back.invitation.token, "inv_abc123")
        XCTAssertNotNil(TrackerInvitation.parse("calimero://com.calimero.mero-issue-tracker/join?invitation=\(try invite.token())"))
        XCTAssertNotNil(TrackerInvitation.parse(try invite.token()))
    }

    func testLinkCarriesTheSDKPayload() throws {
        let token = try TrackerInvitation(invitation: invitation, workspaceName: "Ops").token()
        let json = try XCTUnwrap(InviteCodec.decode(token: token))
        let root = try JSONDecoder().decode(JSONValue.self, from: Data(json.utf8))
        XCTAssertEqual(root["invitation"]?.stringValue, "inv_abc123")
        XCTAssertEqual(root["namespaceId"]?.stringValue, org)
        XCTAssertEqual(root["name"]?.stringValue, "Ops")
        XCTAssertEqual(root["groupAlias"]?.stringValue, "Ops")
        // The SDK reads the same link, ignoring the tracker's extra fields.
        let sdk = try XCTUnwrap(OrgInvitation.decode(token))
        XCTAssertEqual(sdk, OrgInvitation(namespaceId: org, token: "inv_abc123", name: "Ops"))
    }

    func testAnSDKLinkIsRead() throws {
        let link = try OrgInvitation(namespaceId: org, token: "inv_z", contextId: "app1", name: "Core")
            .link(slug: Tracker.packageName)
        let back = try XCTUnwrap(TrackerInvitation.parse(link))
        XCTAssertEqual(back.workspaceName, "Core")
        XCTAssertEqual(back.invitation.contextId, "app1")
    }

    func testAnotherAppsLinkIsRefused() throws {
        let invite = TrackerInvitation(invitation: invitation, workspaceName: nil)
        XCTAssertNil(TrackerInvitation.parse("https://links.calimero.network/com.calimero.chat/join?invitation=\(try invite.token())"))
        XCTAssertNil(TrackerInvitation.parse("not an invitation"))
    }

    func testEnvelopeAndLegacyNamesAreRead() throws {
        let named = try XCTUnwrap(
            TrackerInvitation.parse(
                json: #"{"data":{"invitation":"inv_x","namespaceId":"\#(org)","groupName":"Ops","groupAlias":"x"}}"#))
        XCTAssertEqual(named.workspaceName, "Ops")
        XCTAssertEqual(named.invitation.token, "inv_x")
        let preferred = try XCTUnwrap(
            TrackerInvitation.parse(json: #"{"invitation":"inv_y","namespaceId":"\#(org)","name":"New","groupAlias":"Old"}"#))
        XCTAssertEqual(preferred.workspaceName, "New")
        let bare = try XCTUnwrap(TrackerInvitation.parse(json: #"{"invitation":"inv_y","namespaceId":"\#(org)"}"#))
        XCTAssertNil(bare.workspaceName)
    }

    func testPreOneSignedInvitationIsRefused() {
        let json = #"{"invitation":{"invitation":{"group_id":[1,2]},"inviter_signature":"sig"},"groupAlias":"Old"}"#
        XCTAssertNil(TrackerInvitation.parse(json: json))
    }
}
