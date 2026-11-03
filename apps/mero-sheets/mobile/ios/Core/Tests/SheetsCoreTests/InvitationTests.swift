import MeroKit
import XCTest

@testable import SheetsCore

final class InvitationTests: XCTestCase {
    private let org = String(repeating: "07", count: 32)

    private func invitation() -> OrgInvitation {
        OrgInvitation(namespaceId: org, token: "inv_abcdef")
    }

    func testLinkRoundTrip() throws {
        let invite = SheetsInvitation(invitation: invitation(), workspaceName: "Platform team")
        let link = try invite.link()
        let back = try XCTUnwrap(SheetsInvitation.parse(link))
        XCTAssertEqual(back.workspaceName, "Platform team")
        XCTAssertEqual(back.namespaceId, org)
        XCTAssertEqual(back.invitation.token, "inv_abcdef")
        XCTAssertNotNil(SheetsInvitation.parse("calimero://com.calimero.mero-sheets/join?invitation=\(try invite.token())"))
        XCTAssertNotNil(SheetsInvitation.parse(try invite.token()))
    }

    func testTheSDKReadsTheSameLink() throws {
        let invite = SheetsInvitation(invitation: invitation(), workspaceName: "Finance", contextId: "ctx-1")
        let sdk = try XCTUnwrap(OrgInvitation.parse(try invite.link(), expectedSlug: MeroSheets.packageName))
        XCTAssertEqual(sdk.namespaceId, org)
        XCTAssertEqual(sdk.contextId, "ctx-1")
        XCTAssertEqual(sdk.name, "Finance")
    }

    func testSpreadsheetHintRoundTrips() throws {
        let invite = SheetsInvitation(
            invitation: invitation(), workspaceName: "Finance", contextId: "ctx-1", spreadsheetName: "Q3 Budget")
        let link = try invite.link()
        XCTAssertTrue(link.hasPrefix("https://links.calimero.network/com.calimero.mero-sheets/join?invitation="))
        let back = try XCTUnwrap(SheetsInvitation.parse(link))
        XCTAssertEqual(back.contextId, "ctx-1")
        XCTAssertEqual(back.spreadsheetName, "Q3 Budget")
        // mero-stream's spelling of the name is read too.
        let stream = try XCTUnwrap(
            SheetsInvitation.parse(json: #"{"invitation":"inv_x","namespaceId":"\#(org)","roomName":"Standup"}"#))
        XCTAssertEqual(stream.spreadsheetName, "Standup")
    }

    func testAnotherAppsLinkAndPre10InvitationsAreRefused() throws {
        let invite = SheetsInvitation(invitation: invitation(), workspaceName: nil)
        XCTAssertNil(SheetsInvitation.parse("https://links.calimero.network/com.calimero.chat/join?invitation=\(try invite.token())"))
        XCTAssertNil(SheetsInvitation.parse("not an invitation"))
        let pre10 = #"{"invitation":{"invitation":{"group_id":[7]},"inviter_signature":"sig"},"groupAlias":"Ops"}"#
        XCTAssertNil(SheetsInvitation.parse(json: pre10))
    }

    func testEnvelopeAndNameSpellingsAreRead() throws {
        let named = try XCTUnwrap(
            SheetsInvitation.parse(json: #"{"data":{"invitation":"inv_x","namespaceId":"\#(org)","groupName":"Ops"}}"#))
        XCTAssertEqual(named.workspaceName, "Ops")
        let bare = try XCTUnwrap(SheetsInvitation.parse(json: #"{"invitation":"inv_x","namespaceId":"\#(org)"}"#))
        XCTAssertNil(bare.workspaceName)
    }
}
