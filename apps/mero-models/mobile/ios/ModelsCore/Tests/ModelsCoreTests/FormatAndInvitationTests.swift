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

    func testALinkRoundTripsInTheWebFormat() async throws {
        let backend = Fixtures.backend()
        let link = try await ModelsInvitation.mint(backend: backend, namespaceId: Fixtures.studio, contextId: Fixtures.scene)
        XCTAssertTrue(link.hasPrefix("https://links.calimero.network/com.calimero.mero-models/join?invitation="))
        let parsed = try XCTUnwrap(ModelsInvitation.parse(link))
        XCTAssertEqual(parsed.namespaceId, Fixtures.studio)
        XCTAssertEqual(parsed.contextId, Fixtures.scene)
        // The payload keys are the web's.
        let token = try XCTUnwrap(InviteLink.token(fromPasted: link))
        let json = try XCTUnwrap(InviteCodec.decode(token: token))
        XCTAssertTrue(json.contains("\"namespaceId\""))
        XCTAssertTrue(json.contains("\"inviter_signature\""))
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

    func testABadLinkFails() {
        let model = InvitationModel()
        XCTAssertFalse(model.open("https://example.com"))
        XCTAssertEqual(model.stage, .failed("This isn't a Mero Models invitation. Check the link and try again."))
    }
}
