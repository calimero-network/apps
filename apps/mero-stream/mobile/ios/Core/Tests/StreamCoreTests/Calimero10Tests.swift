import Foundation
import MeroKit
import XCTest
@testable import StreamCore

/// What changed for Calimero 1.0: presence media, the invitation link, errors.
final class Calimero10Tests: XCTestCase {
    func testPresenceEventsBecomeSlices() {
        // `snapshot`: everyone present now, replayed (stale for media).
        let snapshot = CloudEvent(
            id: "1", kind: "snapshot",
            data: [["account": "ana", "device": "d1", "state": "4d53"], ["account": "bo", "device": "d2", "state": .null]])
        XCTAssertEqual(
            CalimeroMediaChannel.slices(snapshot),
            [MediaSlice(author: "ana", bytes: [0x4d, 0x53], ageMs: 0), MediaSlice(author: "bo", bytes: nil, removed: true)])
        // `presence`: one live diff; `state: null` is a leave.
        let live = CloudEvent(id: "2", kind: "presence", data: ["account": "ana", "device": "d1", "state": "0102"])
        XCTAssertEqual(CalimeroMediaChannel.slices(live), [MediaSlice(author: "ana", bytes: [1, 2])])
        let left = CloudEvent(id: "3", kind: "presence", data: ["account": "ana", "device": "d1", "state": .null])
        XCTAssertEqual(CalimeroMediaChannel.slices(left), [MediaSlice(author: "ana", bytes: nil, removed: true)])
        XCTAssertEqual(CalimeroMediaChannel.slices(CloudEvent(id: "4", kind: "presence", data: "x")), [])
    }

    func testTheLinkIsAnOrgInvitationAndPre10LinksAreRefused() throws {
        let invitation = StreamInvitation(
            invitation: OrgInvitation(namespaceId: "org1", token: "inv_abc"), kind: .room, namespaceName: "Studio",
            roomId: "t1", contextId: "app1", roomName: "Daily")
        let link = try invitation.link()
        let token = try XCTUnwrap(InviteLink.token(fromPasted: link))
        // Any 1.0 client reads it as a plain OrgInvitation.
        let plain = try XCTUnwrap(OrgInvitation.decode(token))
        XCTAssertEqual(plain, OrgInvitation(namespaceId: "org1", token: "inv_abc", contextId: "app1", name: "Daily"))
        let parsed = try XCTUnwrap(StreamInvitation.parse(link))
        XCTAssertTrue(parsed.opensRoom)
        XCTAssertEqual(parsed.namespaceName, "Studio")
        let old = #"{"invitation":{"invitation":{"group_id":[1]},"inviter_signature":"s"},"kind":"namespace","groupId":"aa"}"#
        XCTAssertNil(StreamInvitation.parse(json: old))
    }

    func testTheNodesErrorsReadAsWords() {
        XCTAssertEqual(
            ErrorText.describe(ReleaseDeadlineError("deadline", details: ["release": "2.3.110"])),
            "Your cluster takes no new work until node release 2.3.110 is approved. Review it under Needs your approval.")
        XCTAssertEqual(ErrorText.describe(NotFound("no such app")), "This isn't shared with you, or it was deleted.")
        XCTAssertEqual(ErrorText.describe(LoginRequired("expired")), "Your session ended. Sign in again.")
    }

}
