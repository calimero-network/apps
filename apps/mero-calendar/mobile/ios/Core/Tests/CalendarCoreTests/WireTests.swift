import Foundation
import MeroKit
import MeroKitTestSupport
import XCTest

@testable import CalendarCore

final class EventTimeTests: XCTestCase {
    func testReadsTheWebAppsDateString() {
        let date = EventTime.parse("Wed Oct 28 2026 10:00:00 GMT+0100 (Central European Standard Time)")
        XCTAssertEqual(date, Fixture.date(28, 9, 0))
    }

    func testWritesTheWebAppsDateString() {
        let zone = TimeZone(identifier: "Europe/Zagreb")!
        let text = EventTime.format(Fixture.date(28, 9, 0), timeZone: zone)
        XCTAssertEqual(text, "Wed Oct 28 2026 10:00:00 GMT+0100 (Central European Standard Time)")
        XCTAssertEqual(EventTime.parse(text), Fixture.date(28, 9, 0))
    }

    func testSummerTimeNamesTheDaylightZone() {
        let zone = TimeZone(identifier: "Europe/Zagreb")!
        let text = EventTime.format(Fixture.date(1, 8, 30, month: 7), timeZone: zone)
        XCTAssertEqual(text, "Wed Jul 01 2026 10:30:00 GMT+0200 (Central European Summer Time)")
    }

    func testReadsISO8601() {
        XCTAssertEqual(EventTime.parse("2026-10-28T09:00:00Z"), Fixture.date(28, 9, 0))
        XCTAssertEqual(EventTime.parse("2026-10-28T09:00:00.000Z"), Fixture.date(28, 9, 0))
        XCTAssertNil(EventTime.parse("not a date"))
    }
}

final class HexIdsTests: XCTestCase {
    func testEventListsTurnHexIdsIntoBytes() throws {
        let json = """
            [{"id":"e1","title":"T","description":"","owner":"\(Fixture.me)","start":"s","end":"e",\
            "event_type":"event","color":"#fff","peers":["\(Fixture.bob)"],"private":false}]
            """
        let fixed = HexIds.response("get_events", Data(json.utf8))
        let events = try JSONDecoder().decode([CalendarEvent].self, from: fixed)
        XCTAssertEqual(events.first?.owner.hexString, Fixture.me)
        XCTAssertEqual(events.first?.peers.map(\.hexString), [Fixture.bob])
        XCTAssertEqual(events.first?.private, false)
    }

    func testEventWritesSendPeersAsHex() throws {
        let args = try JSONEncoder().encode([
            "event_data": CreateCalendarEvent(
                title: "T", description: "", start: "s", end: "e", eventType: "event", color: "#fff",
                peers: [Fixture.bob.hexBytes])
        ])
        let sent = HexIds.request("create_event", args)
        let object = try JSONSerialization.jsonObject(with: sent) as? [String: Any]
        let event = object?["event_data"] as? [String: Any]
        XCTAssertEqual(event?["peers"] as? [String], [Fixture.bob])
    }

    func testOtherMethodsPassThroughByteForByte() {
        let members = Data(#"[{"id":"x","username":"a","joinedAt":1761650000000000001,"usernameUpdatedAt":2}]"#.utf8)
        XCTAssertEqual(HexIds.response("get_members", members), members)
        let args = Data(#"{"username":"a","timestamp":1761650000000}"#.utf8)
        XCTAssertEqual(HexIds.request("set_username", args), args)
    }

    func testTimestampsKeepTheirDigits() throws {
        let args = Data(#"{"event_data":{"peers":[[1,2]],"title":"t"},"timestamp":1761650000123}"#.utf8)
        let sent = String(decoding: HexIds.request("create_event", args), as: UTF8.self)
        XCTAssertTrue(sent.contains("1761650000123"), sent)
        XCTAssertTrue(sent.contains(#""0102""#), sent)
    }
}

final class TeamInvitationTests: XCTestCase {
    func testLinkRoundTripsWithTheTeamName() throws {
        let signed = MeroKitTestSupportShim.invitation(namespaceId: Fixture.teamId)
        let link = try TeamInvitation(invitation: signed, teamName: "Design").link()
        XCTAssertTrue(link.hasPrefix("https://links.calimero.network/com.calimero.mero-calendar/join?invitation="))
        let parsed = try XCTUnwrap(TeamInvitation.parse(link))
        XCTAssertEqual(parsed.namespaceId, Fixture.teamId)
        XCTAssertEqual(parsed.teamName, "Design")
    }

    func testLinkCarriesTheSDKPayload() throws {
        let invitation = MeroKitTestSupportShim.invitation(namespaceId: Fixture.teamId)
        let link = try TeamInvitation(invitation: invitation, teamName: "Ops").link()
        let token = try XCTUnwrap(InviteLink.token(fromPasted: link))
        let json = try XCTUnwrap(InviteCodec.decode(token: token))
        let root = try JSONDecoder().decode(JSONValue.self, from: Data(json.utf8))
        XCTAssertEqual(root["invitation"]?["orgId"]?.stringValue, Fixture.teamId)
        XCTAssertEqual(root["invitation"]?["token"]?.stringValue, invitation.token)
        XCTAssertEqual(root["namespaceId"]?.stringValue, Fixture.teamId)
        XCTAssertEqual(root["__teamName"]?.stringValue, "Ops")
    }

    func testPayloadWithTheNodeEnvelopeAndTeamName() throws {
        let json = #"{"data":{"invitation":{"orgId":"\#(Fixture.teamId)","token":"inv_abc"},"groupName":null,"__teamName":"Ops"}}"#
        let parsed = try XCTUnwrap(TeamInvitation.parse(json: json))
        XCTAssertEqual(parsed.namespaceId, Fixture.teamId)
        XCTAssertEqual(parsed.invitation.token, "inv_abc")
        XCTAssertEqual(parsed.teamName, "Ops")
    }

    func testPreOneSignedInvitationIsRefused() {
        let json = #"{"invitation":{"invitation":{"group_id":[1,2]},"inviter_signature":"5a5a"},"__teamName":"Old"}"#
        XCTAssertNil(TeamInvitation.parse(json: json))
    }

    func testAnotherAppsLinkIsRefused() throws {
        let signed = MeroKitTestSupportShim.invitation(namespaceId: Fixture.teamId)
        let token = try InviteCodec.encode(["invitation": signed])
        XCTAssertNil(TeamInvitation.parse("https://links.calimero.network/com.calimero.chat/join?invitation=\(token)"))
        XCTAssertNotNil(TeamInvitation.parse("calimero://com.calimero.mero-calendar/join?invitation=\(token)"))
        XCTAssertNotNil(TeamInvitation.parse(token))
        XCTAssertNil(TeamInvitation.parse("hello"))
    }
}

enum MeroKitTestSupportShim {
    static func invitation(namespaceId: String) -> OrgInvitation {
        InMemoryAppBackend.invitation(namespaceId: namespaceId)
    }
}

final class CalendarMathTests: XCTestCase {
    let math = Fixture.math

    func testMonthGridStartsOnMondayAndHasSixWeeks() {
        let grid = math.monthGrid(Fixture.date(15))
        XCTAssertEqual(grid.count, 42)
        XCTAssertEqual(grid.first, Fixture.date(28, month: 9))  // Mon Sep 28
        XCTAssertEqual(math.calendar.component(.weekday, from: grid[0]), 2)
    }

    func testWeekAndTitles() {
        XCTAssertEqual(math.weekDays(Fixture.date(28)).first, Fixture.date(26))
        XCTAssertEqual(math.title(Fixture.date(28), mode: .month), "October 2026")
        XCTAssertEqual(math.title(Fixture.date(28), mode: .agenda), "Upcoming")
        XCTAssertEqual(math.step(Fixture.date(28), mode: .month, by: 1), Fixture.date(1, month: 11))
    }

    func testOverlappingEventsShareTheColumnWidth() {
        let a = CalendarItem(id: "a", title: "A", owner: Fixture.me, start: Fixture.date(28, 9), end: Fixture.date(28, 11))
        let b = CalendarItem(id: "b", title: "B", owner: Fixture.me, start: Fixture.date(28, 10), end: Fixture.date(28, 12))
        let c = CalendarItem(id: "c", title: "C", owner: Fixture.me, start: Fixture.date(28, 13), end: Fixture.date(28, 14))
        let slots = math.layout([c, b, a], on: Fixture.date(28))
        let byId = Dictionary(uniqueKeysWithValues: slots.map { ($0.id, $0) })
        XCTAssertEqual(byId["a"]?.column, 0)
        XCTAssertEqual(byId["b"]?.column, 1)
        XCTAssertEqual(byId["a"]?.columns, 2)
        XCTAssertEqual(byId["c"]?.columns, 1)
        XCTAssertEqual(byId["a"]?.startMinute, 540)
    }

    func testMultiDayAndAllDayEventsShowOnEachDay() {
        let trip = CalendarItem(
            id: "t", title: "Trip", owner: Fixture.me, start: Fixture.date(27), end: Fixture.date(29, 23, 59),
            isAllDay: true)
        XCTAssertEqual(math.events([trip], on: Fixture.date(28)).count, 1)
        XCTAssertEqual(math.events([trip], on: Fixture.date(30)).count, 0)
        XCTAssertEqual(math.agenda([trip], from: Fixture.date(28), days: 5).map(\.day), [Fixture.date(28), Fixture.date(29)])
    }
}

final class EventDraftTests: XCTestCase {
    func testValidation() {
        var draft = EventDraft.new(on: Fixture.date(28), now: Fixture.date(1, month: 1), math: Fixture.math)
        XCTAssertEqual(draft.start, Fixture.date(28, 9))
        XCTAssertEqual(draft.problem(math: Fixture.math), "Add a title")
        draft.title = "Standup"
        XCTAssertNil(draft.problem(math: Fixture.math))
        draft.end = draft.start
        XCTAssertEqual(draft.problem(math: Fixture.math), "The event has to end after it starts")
        draft.isAllDay = true
        XCTAssertNil(draft.problem(math: Fixture.math))
        let item = draft.item(owner: Fixture.me, math: Fixture.math)
        XCTAssertEqual(item.start, Fixture.date(28))
        XCTAssertEqual(item.end, Fixture.date(28, 23, 59))
    }

    func testPrivateClearsPeersAndSharedCannotGoBack() {
        var draft = EventDraft.new(on: Fixture.date(28), math: Fixture.math)
        draft.togglePeer(Fixture.bob)
        draft.setPrivate(true)
        XCTAssertEqual(draft.peers, [])
        let shared = CalendarItem(id: "s1", title: "S", owner: Fixture.me, start: Fixture.date(28, 9), end: Fixture.date(28, 10))
        var edit = EventDraft.editing(shared)
        XCTAssertFalse(edit.canTogglePrivate)
        edit.setPrivate(true)
        XCTAssertFalse(edit.isPrivate)
    }
}
