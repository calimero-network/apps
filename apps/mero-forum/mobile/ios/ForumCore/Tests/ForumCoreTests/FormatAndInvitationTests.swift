import Foundation
import MeroKit
import MeroKitTestSupport
import XCTest

@testable import ForumCore

final class ForumFormatTests: XCTestCase {
    private var utc: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }

    func testNanosecondStampsAreScaled() {
        let nanos: UInt64 = 1_761_000_000_000_000_000
        let millis: UInt64 = 1_761_000_000_000
        XCTAssertEqual(ForumFormat.date(nanos), ForumFormat.date(millis))
        XCTAssertEqual(ForumFormat.date(nanos).timeIntervalSince1970, 1_761_000_000, accuracy: 0.001)
    }

    func testAgeReadsLikeATimeline() {
        let now = Date(timeIntervalSince1970: 1_761_000_000)
        func stamp(_ secondsAgo: Double) -> UInt64 { UInt64((now.timeIntervalSince1970 - secondsAgo) * 1_000_000_000) }
        XCTAssertEqual(ForumFormat.age(stamp(5), now: now, calendar: utc), "now")
        XCTAssertEqual(ForumFormat.age(stamp(5 * 60), now: now, calendar: utc), "5m")
        XCTAssertEqual(ForumFormat.age(stamp(3 * 3600), now: now, calendar: utc), "3h")
        XCTAssertEqual(ForumFormat.age(stamp(2 * 86400), now: now, calendar: utc), "2d")
        XCTAssertEqual(ForumFormat.age(stamp(20 * 86400), now: now, calendar: utc), "Sep 30")
        XCTAssertEqual(ForumFormat.age(stamp(400 * 86400), now: now, calendar: utc), "Sep 15, 2024")
        XCTAssertEqual(ForumFormat.fullStamp(stamp(0), calendar: utc), "10:40 PM · Oct 20, 2025")
    }

    func testPeople() {
        XCTAssertEqual(ForumFormat.shortAccount(me), "ababab…abab")
        XCTAssertEqual(ForumFormat.handle(me), "@ababab…abab")
        XCTAssertEqual(ForumFormat.displayName("  ", account: me), "ababab…abab")
        XCTAssertEqual(ForumFormat.displayName(" Ana ", account: me), "Ana")
        XCTAssertEqual(ForumFormat.initials("ana maria lopez"), "AM")
        XCTAssertEqual(ForumFormat.initials(""), "?")
        // Same numbers as the Kotlin ForumFormatTest: one colour per person on both.
        XCTAssertEqual(ForumFormat.tone("Ana"), 2)
        XCTAssertEqual(ForumFormat.tone(me), 4)
        XCTAssertTrue(ForumFormat.isAccountId(me.uppercased()))
        XCTAssertFalse(ForumFormat.isAccountId("abc"))
    }

    func testCompactCounts() {
        XCTAssertEqual(ForumFormat.compact(999), "999")
        XCTAssertEqual(ForumFormat.compact(1_000), "1K")
        XCTAssertEqual(ForumFormat.compact(1_250), "1.2K")
        XCTAssertEqual(ForumFormat.compact(12_900), "12K")
        XCTAssertEqual(ForumFormat.compact(1_300_000), "1.3M")
        XCTAssertEqual(ForumFormat.compact(-3), "-3")
    }
}

final class ForumInvitationTests: XCTestCase {
    private let signed = InMemoryAppBackend.invitation(namespaceId: ns)

    func testSpaceInviteRoundTrips() throws {
        let link = try ForumInvitation(invitation: signed, kind: .space, spaceName: "Design").link()
        XCTAssertTrue(link.hasPrefix("https://links.calimero.network/com.calimero.mero-forum/join?invitation="))
        let parsed = try XCTUnwrap(ForumInvitation.parse(link))
        XCTAssertEqual(parsed.namespaceId, ns)
        XCTAssertEqual(parsed.kind, .space)
        XCTAssertEqual(parsed.title, "Design")
        XCTAssertNil(parsed.contextId)
    }

    func testForumInviteCarriesWhereToLand() throws {
        let invite = ForumInvitation(
            invitation: signed, kind: .forum, spaceName: "Design", forumId: "f1", forumName: "General", contextId: ctx)
        let parsed = try XCTUnwrap(ForumInvitation.parse(try invite.token()))
        XCTAssertEqual(parsed.kind, .forum)
        XCTAssertEqual(parsed.forumId, "f1")
        XCTAssertEqual(parsed.contextId, ctx)
        XCTAssertEqual(parsed.title, "General")
    }

    func testDeepLinkAndLegacyLinks() throws {
        let token = try ForumInvitation(invitation: signed, spaceName: "Design").token()
        XCTAssertNotNil(ForumInvitation.parse("calimero://com.calimero.mero-forum/join?invitation=\(token)"))
        XCTAssertNotNil(ForumInvitation.parse("https://forum.example/spaces?invite=\(token)"))
        XCTAssertNotNil(ForumInvitation.parse("  \(token)\n"))
    }

    func testPayloadShapes() throws {
        let parsed = try XCTUnwrap(
            ForumInvitation.parse(json: #"{"data":{"invitation":"inv_abc","namespaceId":"\#(ns)","groupName":"Ops"}}"#))
        XCTAssertEqual(parsed.spaceName, "Ops")
        XCTAssertEqual(parsed.namespaceId, ns)
        XCTAssertEqual(parsed.invitation.token, "inv_abc")
        let named = try XCTUnwrap(
            ForumInvitation.parse(json: #"{"invitation":"inv_abc","namespaceId":"\#(ns)","name":"Design","groupAlias":"Old"}"#))
        XCTAssertEqual(named.spaceName, "Design")
        XCTAssertNil(ForumInvitation.parse(json: #"{"invitation":{"orgId":"\#(ns)","token":"inv_abc"}}"#))
    }

    func testLinkCarriesTheSDKPayload() throws {
        let invite = ForumInvitation(
            invitation: signed, kind: .forum, spaceName: "Design", forumId: "f1", forumName: "General", contextId: ctx)
        let token = try invite.token()
        let sdk = try XCTUnwrap(OrgInvitation.decode(token))
        XCTAssertEqual(sdk.namespaceId, ns)
        XCTAssertEqual(sdk.token, signed.token)
        XCTAssertEqual(sdk.contextId, ctx)
        XCTAssertEqual(sdk.name, "Design")
        let json = try XCTUnwrap(InviteCodec.decode(token: token))
        let root = try JSONDecoder().decode(JSONValue.self, from: Data(json.utf8))
        XCTAssertEqual(root["invitation"]?.stringValue, signed.token)
        XCTAssertEqual(root["kind"]?.stringValue, "forum")
        XCTAssertEqual(root["forumId"]?.stringValue, "f1")
        let sdkLink = try OrgInvitation(namespaceId: ns, token: "inv_x", name: "Ops").link(slug: ForumConstants.packageName)
        XCTAssertEqual(ForumInvitation.parse(sdkLink)?.spaceName, "Ops")
    }

    func testPreOneSignedInvitationIsRefused() {
        let json = #"{"invitation":{"invitation":{"group_id":[1,2]},"inviter_signature":"5a5a"},"groupAlias":"Old"}"#
        XCTAssertNil(ForumInvitation.parse(json: json))
    }

    func testRefusesOtherAppsAndGarbage() throws {
        let token = try ForumInvitation(invitation: signed).token()
        XCTAssertNil(ForumInvitation.parse("https://links.calimero.network/com.calimero.chat/join?invitation=\(token)"))
        XCTAssertNil(ForumInvitation.parse("hello there"))
        XCTAssertNil(ForumInvitation.parse(""))
    }
}
