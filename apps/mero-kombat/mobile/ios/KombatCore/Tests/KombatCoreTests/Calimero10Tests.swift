import Foundation
import MeroKit
import XCTest

@testable import KombatCore

/// What changed for Calimero 1.0: the invitation link, presence events, errors.
final class Calimero10Tests: XCTestCase {
    func testTheLinkIsAnOrgInvitationNamingTheArena() throws {
        let link = try KombatInvitation(invitation: OrgInvitation(namespaceId: "org1", token: "inv_abc"), contextId: "app1").link()
        XCTAssertTrue(link.hasPrefix("https://links.calimero.network/com.calimero.mero-kombat/join?invitation="))
        let parsed = try XCTUnwrap(KombatInvitation.parse(link))
        XCTAssertEqual(parsed.namespaceId, "org1")
        XCTAssertEqual(parsed.contextId, "app1")
        XCTAssertEqual(parsed.invitation.token, "inv_abc")
        // Without an arena it is not a Mero Kombat link; neither is a pre-1.0 signed invitation.
        XCTAssertNil(KombatInvitation.parse(json: #"{"invitation":"inv_abc","namespaceId":"org1"}"#))
        let old = #"{"invitation":{"invitation":{"group_id":[1]},"inviter_signature":"s"},"namespaceId":"aa","contextId":"cc"}"#
        XCTAssertNil(KombatInvitation.parse(json: old))
    }

    func testPresenceEventsBecomeSlices() {
        let slice = Data(#"{"x":1}"#.utf8).map { String(format: "%02x", $0) }.joined()
        let snapshot = CloudEvent(
            id: "1", kind: "snapshot",
            data: [["account": "a", "device": "d", "state": .string(slice)], ["account": "b", "device": "d", "state": .null]])
        XCTAssertEqual(CalimeroPresenceChannel.slices(snapshot), [#"{"x":1}"#])
        let diff = CloudEvent(id: "2", kind: "presence", data: ["account": "a", "device": "d", "state": .string(slice)])
        XCTAssertEqual(CalimeroPresenceChannel.slices(diff), [#"{"x":1}"#])
    }

    func testTheNodesErrorsReadAsWords() {
        XCTAssertEqual(
            KombatText.error(ReleaseDeadlineError("deadline", details: ["release": "2.3.110"])),
            "Your cluster takes no new work until node release 2.3.110 is approved. Review it under Needs your approval.")
        XCTAssertEqual(KombatText.error(NotFound("no such app")), "This isn't shared with you, or it was deleted.")
        XCTAssertEqual(KombatText.error(LoginRequired("expired")), "Your session ended. Sign in again.")
    }

}
