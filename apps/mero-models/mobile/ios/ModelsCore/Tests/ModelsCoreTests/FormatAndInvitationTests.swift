import Foundation
import MeroKit
import MeroKitTestSupport
import XCTest
@testable import ModelsCore

@MainActor
final class FormatAndInvitationTests: XCTestCase {
    func testFormatting() {
        XCTAssertEqual(ModelsFormat.shortId(String(repeating: "ab", count: 32)), "ababab…abab")
        XCTAssertEqual(ModelsFormat.initials("Ana Lopez"), "AL")
        XCTAssertEqual(ModelsFormat.kindLabel("directional_light"), "Sun")
        XCTAssertEqual(ModelsFormat.compact(1234), "1.2k")
        XCTAssertEqual(ModelsFormat.compact(2_000_000), "2M")
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        XCTAssertEqual(ModelsFormat.relativeTime(1_800_000_000_000 - 7_200_000, now: now), "2h ago")
        let utc = TimeZone(identifier: "UTC")!
        XCTAssertEqual(ModelsFormat.until(1_800_000_000_000 + 3_600_000, now: now, timeZone: utc), "09:00")
        XCTAssertEqual(ModelsFormat.until(1_800_000_000_000 + 86_400_000, now: now, timeZone: utc), "16 Jan, 08:00")
    }

    func testTheNodesErrorsReadAsWords() {
        XCTAssertEqual(
            ModelsFormat.errorText(ReleaseDeadlineError("deadline", details: ["release": "2.3.110"])),
            "Your cluster takes no new work until node release 2.3.110 is approved. Review it under Needs your approval.")
        XCTAssertEqual(ModelsFormat.errorText(NotFound("no such app")), "This isn't shared with you, or it was deleted.")
        XCTAssertEqual(ModelsFormat.errorText(LoginRequired("expired")), "Your session ended. Sign in again.")
    }

    func testALinkRoundTripsInTheWebFormat() async throws {
        let backend = Fixtures.backend()
        let link = try await ModelsInvitation.mint(backend: backend, namespaceId: Fixtures.studio, contextId: Fixtures.scene)
        XCTAssertTrue(link.hasPrefix("https://links.calimero.network/com.calimero.mero-models/join?invitation="))
        let parsed = try XCTUnwrap(ModelsInvitation.parse(link))
        XCTAssertEqual(parsed.namespaceId, Fixtures.studio)
        XCTAssertEqual(parsed.contextId, Fixtures.scene)
        XCTAssertEqual(parsed.invitation.token, InMemoryAppBackend.invitation(namespaceId: Fixtures.studio).token)
        // The payload is the 1.0 link shape: an org invite token, the org and the scene.
        let token = try XCTUnwrap(InviteLink.token(fromPasted: link))
        let json = try XCTUnwrap(InviteCodec.decode(token: token))
        XCTAssertTrue(json.contains("\"namespaceId\""))
        XCTAssertTrue(json.contains("\"invitation\":\"inv_"))
        XCTAssertEqual(OrgInvitation.decode(token)?.contextId, Fixtures.scene)
    }

    func testAnotherAppsLinkIsRefused() async throws {
        let backend = Fixtures.backend()
        let link = try await ModelsInvitation.mint(backend: backend, namespaceId: Fixtures.studio, contextId: Fixtures.scene)
        let foreign = link.replacingOccurrences(of: "com.calimero.mero-models", with: "com.calimero.mero-chat")
        XCTAssertNil(ModelsInvitation.parse(foreign))
        XCTAssertNil(ModelsInvitation.parse("not an invitation"))
    }

    func testAcceptingJoinsTheStudioThenTheScene() async throws {
        let backend = Fixtures.backend(memberOfScene: false)
        backend.namespaces = []
        let link = try await ModelsInvitation.mint(backend: backend, namespaceId: Fixtures.studio, contextId: Fixtures.scene)
        let model = InvitationModel(attempts: 2, retryDelayMs: 1)
        XCTAssertTrue(model.open(link))
        XCTAssertEqual(model.stage, .confirm)
        var joined = false
        await model.accept(backend: { backend }, didJoin: { joined = true })
        XCTAssertTrue(joined)
        XCTAssertEqual(model.stage, .joined(namespaceId: Fixtures.studio, contextId: Fixtures.scene))
        XCTAssertTrue(backend.log.contains("joinNamespace \(Fixtures.studio)"))
        XCTAssertTrue(backend.log.contains("joinContext \(Fixtures.scene)"))
    }

    func testRawJSONParsesAndALinkWithoutASceneIsRefused() throws {
        let json = #"{"invitation":"inv_x","namespaceId":"org1","contextId":"app1","extra":1}"#
        let parsed = try XCTUnwrap(ModelsInvitation.parse(json))
        XCTAssertEqual(parsed.namespaceId, "org1")
        XCTAssertEqual(parsed.contextId, "app1")
        XCTAssertNil(ModelsInvitation.parse(#"{"invitation":"inv_x","namespaceId":"org1"}"#))
        let old = #"{"invitation":{"invitation":{"group_id":[1]},"inviter_signature":"s"},"namespaceId":"aa","contextId":"cc"}"#
        XCTAssertNil(ModelsInvitation.parse(old))
    }

    func testABadLinkFails() {
        let model = InvitationModel()
        XCTAssertFalse(model.open("https://example.com"))
        XCTAssertEqual(model.stage, .failed("This isn't a Mero Models invitation. Check the link and try again."))
    }
}
