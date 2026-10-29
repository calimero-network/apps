import MeroKit
import XCTest

@testable import SheetsCore

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
        let invite = SheetsInvitation(invitation: try signed(), workspaceName: "Platform team")
        let link = try invite.link()
        let back = try XCTUnwrap(SheetsInvitation.parse(link))
        XCTAssertEqual(back.workspaceName, "Platform team")
        XCTAssertEqual(back.namespaceId, String(repeating: "07", count: 32))
        XCTAssertNotNil(SheetsInvitation.parse("calimero://com.calimero.mero-sheets/join?invitation=\(try invite.token())"))
        XCTAssertNotNil(SheetsInvitation.parse(try invite.token()))
    }

    func testSpreadsheetHintRoundTrips() throws {
        let invite = SheetsInvitation(
            invitation: try signed(), workspaceName: "Finance", contextId: "ctx-1", spreadsheetName: "Q3 Budget")
        let link = try invite.link()
        XCTAssertTrue(link.hasPrefix("https://links.calimero.network/com.calimero.mero-sheets/join?invitation="))
        let back = try XCTUnwrap(SheetsInvitation.parse(link))
        XCTAssertEqual(back.contextId, "ctx-1")
        XCTAssertEqual(back.spreadsheetName, "Q3 Budget")
        // mero-stream's spelling of the name is read too.
        let envelope = String(data: try JSONEncoder().encode(try signed()), encoding: .utf8)!
        let stream = try XCTUnwrap(SheetsInvitation.parse(json: #"{"invitation":\#(envelope),"roomName":"Standup"}"#))
        XCTAssertEqual(stream.spreadsheetName, "Standup")
    }

    func testAnotherAppsLinkIsRefused() throws {
        let invite = SheetsInvitation(invitation: try signed(), workspaceName: nil)
        XCTAssertNil(SheetsInvitation.parse("https://links.calimero.network/com.calimero.chat/join?invitation=\(try invite.token())"))
        XCTAssertNil(SheetsInvitation.parse("not an invitation"))
    }

    func testWebShapesAreRead() throws {
        let envelope = String(data: try JSONEncoder().encode(try signed()), encoding: .utf8)!
        let named = try XCTUnwrap(SheetsInvitation.parse(json: #"{"data":{"invitation":\#(envelope),"groupName":"Ops"}}"#))
        XCTAssertEqual(named.workspaceName, "Ops")
        let bare = try XCTUnwrap(SheetsInvitation.parse(json: envelope))
        XCTAssertNil(bare.workspaceName)
    }
}
