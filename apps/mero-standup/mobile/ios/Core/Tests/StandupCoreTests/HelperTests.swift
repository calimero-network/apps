import Foundation
import MeroKit
import MeroKitTestSupport
import XCTest

@testable import StandupCore

final class DaysTests: XCTestCase {
    func testDayOfAndToday() {
        XCTAssertEqual(Days.today(fixedNow, calendar: utc), "2026-10-28")
    }

    func testParseRejectsNonDates() {
        XCTAssertNil(Days.parse("2026-02-30", calendar: utc))
        XCTAssertNil(Days.parse("2026-2-3", calendar: utc))
        XCTAssertNil(Days.parse("junk", calendar: utc))
        XCTAssertNotNil(Days.parse("2024-02-29", calendar: utc))
    }

    func testShiftCrossesMonthsAndYears() {
        XCTAssertEqual(Days.shift("2026-10-31", by: 1, calendar: utc), "2026-11-01")
        XCTAssertEqual(Days.shift("2026-01-01", by: -1, calendar: utc), "2025-12-31")
        XCTAssertEqual(Days.shift("bad", by: 1, calendar: utc), "bad")
    }

    func testDescribe() {
        XCTAssertEqual(Days.describe("2026-10-28", now: fixedNow, calendar: utc), "Today")
        XCTAssertEqual(Days.describe("2026-10-27", now: fixedNow, calendar: utc), "Yesterday")
        XCTAssertEqual(Days.describe("2026-10-29", now: fixedNow, calendar: utc), "Tomorrow")
        XCTAssertEqual(Days.describe("2026-10-21", now: fixedNow, calendar: utc), "Wed, Oct 21")
    }

    func testWeekStartIsMonday() {
        XCTAssertEqual(Days.weekStart("2026-10-28", calendar: utc), "2026-10-26")
        XCTAssertEqual(Days.weekStart("2026-11-01", calendar: utc), "2026-10-26")  // Sunday
        XCTAssertEqual(Days.weekStart("2026-10-26", calendar: utc), "2026-10-26")
        XCTAssertEqual(Days.weekDays("2026-10-26", calendar: utc).last, "2026-11-01")
    }

    func testDescribeWeek() {
        XCTAssertEqual(Days.describeWeek("2026-10-12", calendar: utc), "Oct 12 – 18")
        XCTAssertEqual(Days.describeWeek("2026-10-26", calendar: utc), "Oct 26 – Nov 1")
    }

    func testRelative() {
        let nanos = { (date: Date) in UInt64(date.timeIntervalSince1970 * 1000) * 1_000_000 }
        XCTAssertEqual(Days.relative(nanos: nanos(fixedNow.addingTimeInterval(-10)), now: fixedNow, calendar: utc), "just now")
        XCTAssertEqual(Days.relative(nanos: nanos(fixedNow.addingTimeInterval(-300)), now: fixedNow, calendar: utc), "5m ago")
        XCTAssertEqual(Days.relative(nanos: nanos(fixedNow.addingTimeInterval(-3 * 3600)), now: fixedNow, calendar: utc), "3h ago")
        XCTAssertEqual(Days.relative(nanos: nanos(fixedNow.addingTimeInterval(-24 * 3600)), now: fixedNow, calendar: utc), "yesterday")
        XCTAssertEqual(Days.relative(nanos: 0, now: fixedNow, calendar: utc), "")
    }
}

final class PeopleTests: XCTestCase {
    func testDisplayNameFallsBackToShortId() {
        XCTAssertEqual(People.displayName("abcdef0123456789", " "), "abcdef…6789")
        XCTAssertEqual(People.displayName("abcdef0123456789", "Ana"), "Ana")
    }

    func testInitials() {
        XCTAssertEqual(People.initials("ff00", "Ana Lee"), "AL")
        XCTAssertEqual(People.initials("ff00", "bo"), "BO")
        XCTAssertEqual(People.initials("ff00", ""), "FF")
    }

    func testHueIsStablePerAccount() {
        XCTAssertEqual(People.avatarHue(ana), People.avatarHue(ana))
        XCTAssert((0..<360).contains(People.avatarHue(bo)))
    }
}

final class DraftTests: XCTestCase {
    func testCarryForwardMovesNextToDoneAndKeepsBlocker() throws {
        let last = try decode(UpdateView.self, update(me, day: "2026-10-27", done: "a", next: "b", blockers: "c"))
        XCTAssertEqual(UpdateDraft.carryForward(last), UpdateDraft(done: "b", next: "", blockers: "c"))
        XCTAssertEqual(UpdateDraft.carryForward(nil), UpdateDraft())
    }

    func testEmptyDraft() {
        XCTAssertTrue(UpdateDraft(done: " ", next: "\n", blockers: "").isEmpty)
        XCTAssertFalse(UpdateDraft(blockers: "x").isEmpty)
    }

    func testTagsNormalizeLikeTheContract() {
        XCTAssertEqual(Tags.parse("Infra, release process, infra,, "), ["infra", "release-process"])
    }

    func testSupersedingDraftKeepsTagsAndPeople() throws {
        var old = decision("d1", title: "Old", tags: ["infra"])
        if case .object(var fields) = old {
            fields["with"] = [["account": .string(bo), "name": "Bo"]]
            old = .object(fields)
        }
        let draft = DecisionDraft(supersedes: try decode(DecisionView.self, old))
        XCTAssertEqual(draft.tagsInput, "infra")
        XCTAssertEqual(draft.with, [bo])
        XCTAssertFalse(draft.isReady)
    }
}

final class RichTextTests: XCTestCase {
    func testBulletsBecomeOneList() {
        XCTAssertEqual(
            RichText.parse("- one\n* two\n1. three\nplain"),
            [.list([[.text("one")], [.text("two")], [.text("three")]]), .paragraph([.text("plain")])])
    }

    func testCodeAndLinks() {
        XCTAssertEqual(
            RichText.inlines("see `make` at https://x.dev/a, ok"),
            [.text("see "), .code("make"), .text(" at "), .link("https://x.dev/a"), .text(", ok")])
    }

    func testLoneBacktickIsText() {
        XCTAssertEqual(RichText.inlines("a ` b"), [.text("a ` b")])
    }
}

final class DigestTests: XCTestCase {
    func testMarkdownGroupsByPerson() throws {
        let week = try decode(
            [DayView].self,
            [
                ["day": "2026-10-26", "updates": [update(bo, day: "2026-10-26", name: "Bo", done: "x\ny")]],
                [
                    "day": "2026-10-27",
                    "updates": [
                        update(ana, day: "2026-10-27", name: "Ana", next: "n", blockers: "b"),
                        update(bo, day: "2026-10-27", name: "Bo", done: "z"),
                    ],
                ],
            ] as JSONValue)
        XCTAssertEqual(Digest.byPerson(week).map(\.name), ["Ana", "Bo"])
        let md = Digest.markdown(teamName: "Platform", start: "2026-10-26", week: week, calendar: utc)
        XCTAssertEqual(
            md,
            """
            # Platform — week of Oct 26 – Nov 1

            ## Ana

            **Tue**
            - Next: n
            - Blocked: b

            ## Bo

            **Mon**
            - Done: x; y

            **Tue**
            - Done: z

            """)
    }

    func testEmptyWeek() {
        XCTAssertTrue(Digest.markdown(teamName: "", start: "2026-10-26", week: [], calendar: utc).contains("_No updates this week._"))
    }
}

final class InvitationTests: XCTestCase {
    func testRoundTripsThroughTheLinkPayload() throws {
        let signed = InMemoryAppBackend.invitation(namespaceId: String(repeating: "ab", count: 32))
        let link = try StandupInvitation(invitation: signed, namespaceId: "ns-1", contextId: "ctx-1").link()
        XCTAssertTrue(link.hasPrefix("https://links.calimero.network/com.calimero.mero-standup/join?invitation="))
        let parsed = try XCTUnwrap(StandupInvitation.parse(link))
        XCTAssertEqual(parsed.namespaceId, "ns-1")
        XCTAssertEqual(parsed.contextId, "ctx-1")
        XCTAssertEqual(parsed.invitation, signed)
        // The desktop launcher's form opens too.
        let token = try XCTUnwrap(InviteLink.token(fromPasted: link))
        XCTAssertNotNil(StandupInvitation.parse("calimero://com.calimero.mero-standup/join?invitation=\(token)"))
    }

    func testRefusesAnotherAppsLinkAndJunk() throws {
        let signed = InMemoryAppBackend.invitation(namespaceId: String(repeating: "ab", count: 32))
        let link = try StandupInvitation(invitation: signed, namespaceId: "ns", contextId: "ctx").link()
        XCTAssertNil(StandupInvitation.parse(link.replacingOccurrences(of: "com.calimero.mero-standup", with: "com.calimero.chat")))
        XCTAssertNil(StandupInvitation.parse("hello"))
        XCTAssertNil(StandupInvitation.parse(json: #"{"namespaceId":"n","contextId":"c","invitation":{}}"#))
    }

    func testReadsTheSDKPayloadAndRefusesPreOneLinks() throws {
        let parsed = try XCTUnwrap(
            StandupInvitation.parse(json: #"{"invitation":{"orgId":"org-1","token":"inv_x"},"namespaceId":"org-1","contextId":"c"}"#))
        XCTAssertEqual(parsed.invitation, OrgInvitation(orgId: "org-1", token: "inv_x"))
        XCTAssertEqual(parsed.namespaceId, "org-1")
        // A pre-1.0 signed group invitation can't be redeemed on a 1.0 cluster.
        XCTAssertNil(
            StandupInvitation.parse(
                json: #"{"namespaceId":"n","contextId":"c","invitation":{"invitation":{},"inviter_signature":"5a"}}"#))
    }
}

func decode<T: Decodable>(_ type: T.Type, _ value: JSONValue) throws -> T {
    try JSONDecoder().decode(T.self, from: JSONEncoder().encode(value))
}
