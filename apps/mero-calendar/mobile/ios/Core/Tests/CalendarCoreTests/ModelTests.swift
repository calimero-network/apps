import Foundation
import MeroKit
import MeroKitTestSupport
import XCTest

@testable import CalendarCore

@MainActor
final class TeamsModelTests: XCTestCase {
    func testLoadsTeamsWithNames() async {
        let backend = Fixture.backend()
        backend.namespaces.append(AppNamespace(id: "dd" + String(repeating: "0", count: 62), name: nil, applicationId: "x"))
        let names = NameBook(store: MemoryStore())
        names.setTeamName("Cached", for: "dd" + String(repeating: "0", count: 62))
        let model = TeamsModel(backend: backend, names: names)
        await model.load()
        XCTAssertEqual(model.teams.map(\.name), ["Cached", "Design"])
        XCTAssertTrue(model.hasLoaded)
    }

    func testCreateFoundsTheTeamAndWarnsWhenNotHosted() async throws {
        let backend = Fixture.backend()
        backend.haEnabled = false
        let model = TeamsModel(backend: backend, names: NameBook(store: MemoryStore()))
        let result = try await model.create(name: "  Ops ")
        XCTAssertEqual(result.team.name, "Ops")
        XCTAssertEqual(result.warning, "Team created, but invitations will not work yet: not hosted (fake).")
        XCTAssertTrue(backend.log.contains("foundNamespace Ops"))
    }

    func testInviteThenJoinFromTheLink() async throws {
        let backend = Fixture.backend()
        let model = TeamsModel(backend: backend, names: NameBook(store: MemoryStore()))
        await model.load()
        let link = try await model.inviteLink(for: model.teams[0])
        XCTAssertEqual(TeamsModel.teamName(inLink: link), "Design")

        let joiner = InMemoryAppBackend(account: Fixture.bob)
        joiner.hasRelay = false
        var reconnected = false
        let names = NameBook(store: MemoryStore())
        let other = TeamsModel(backend: joiner, names: names, didJoin: { reconnected = true })
        let id = try await other.join(link: link)
        XCTAssertEqual(id, Fixture.teamId)
        XCTAssertTrue(reconnected)
        XCTAssertEqual(other.justJoined, [Fixture.teamId])
        XCTAssertEqual(other.teams.map(\.name), ["Design"])
        XCTAssertEqual(joiner.log.first, "joinNamespace \(Fixture.teamId)")
    }

    func testABadLinkSaysSo() async {
        let model = TeamsModel(backend: Fixture.backend(), names: NameBook(store: MemoryStore()))
        do {
            try await model.join(link: "https://example.com/nope")
            XCTFail("joined")
        } catch {
            XCTAssertEqual(error as? CalendarError, .invalidInvitation)
        }
    }

    func testDisconnectedAccountListsNothing() async {
        let backend = Fixture.backend()
        backend.hasRelay = false
        let model = TeamsModel(backend: backend, names: NameBook(store: MemoryStore()))
        await model.load()
        XCTAssertFalse(model.hasRelay)
        XCTAssertEqual(model.teams, [])
        XCTAssertFalse(backend.log.contains("listNamespaces"))
    }
}

@MainActor
final class CalendarsModelTests: XCTestCase {
    func testListsSubgroupAndRootCalendars() async {
        let backend = Fixture.backend()
        let root = String(repeating: "c1", count: 32)
        backend.rootContexts = [Fixture.teamId: [root]]
        let model = CalendarsModel(backend: backend, team: Fixture.team, names: NameBook(store: MemoryStore()))
        await model.load()
        XCTAssertEqual(model.calendars.map(\.name), ["Launches", "Calendar c1c1c1"])
        XCTAssertEqual(model.calendars.map(\.groupId), [Fixture.groupId, Fixture.teamId])
    }

    func testCreateMakesAnOpenSubgroupWithTheCalendarInIt() async throws {
        let backend = Fixture.backend()
        let names = NameBook(store: MemoryStore())
        let model = CalendarsModel(backend: backend, team: Fixture.team, names: names)
        let calendar = try await model.create(name: "Roadmap")
        XCTAssertEqual(calendar.name, "Roadmap")
        XCTAssertTrue(backend.publicSubgroups.contains(calendar.groupId))
        XCTAssertEqual(backend.initArgs[calendar.id], .object([:]))
        XCTAssertTrue(backend.members.contains(calendar.id))
        XCTAssertEqual(names.calendarName(calendar.id), "Roadmap")
        XCTAssertTrue(backend.log.contains("createSubgroup \(Fixture.teamId) Roadmap open"))
    }

    func testOpenJoinsACalendarNotJoinedYet() async throws {
        let backend = Fixture.backend()
        backend.members = []
        let model = CalendarsModel(backend: backend, team: Fixture.team, names: NameBook(store: MemoryStore()))
        try await model.open(Fixture.calendar)
        XCTAssertTrue(backend.members.contains(Fixture.contextId))
        XCTAssertNil(model.opening)
    }

    func testOpenGivesUpAfterTheWindow() async {
        let backend = Fixture.backend()
        backend.members = []
        backend.failure = URLError(.badServerResponse)
        let model = CalendarsModel(backend: backend, team: Fixture.team, names: NameBook(store: MemoryStore()))
        model.joinWindow = .milliseconds(60)
        model.joinRetry = .milliseconds(20)
        do {
            try await model.open(Fixture.calendar)
            XCTFail("opened")
        } catch {
            XCTAssertGreaterThan(backend.log.filter { $0.hasPrefix("joinContext") }.count, 1)
        }
    }
}

@MainActor
final class CalendarModelTests: XCTestCase {
    func makeModel(
        _ backend: InMemoryAppBackend, names: NameBook = NameBook(store: MemoryStore())
    ) -> CalendarModel {
        CalendarModel(
            backend: backend, team: Fixture.team, calendar: Fixture.calendar, names: names,
            math: Fixture.math, today: Fixture.date(28))
    }

    func testLoadMergesSharedAndPrivateEvents() async {
        let utc = "GMT+0000 (Coordinated Universal Time)"
        let shared = Fixture.eventJSON(
            id: "s1", title: "Review", owner: Fixture.bob, start: "Wed Oct 28 2026 10:00:00 \(utc)",
            end: "Wed Oct 28 2026 11:00:00 \(utc)", peers: [Fixture.me])
        let mine = Fixture.eventJSON(
            id: "p1", title: "Dentist", owner: Fixture.me, start: "Wed Oct 28 2026 08:00:00 \(utc)",
            end: "Wed Oct 28 2026 09:00:00 \(utc)", isPrivate: true)
        let backend = Fixture.backend { call in
            switch call.method {
            case "getEvents": return .array([shared])
            case "getPrivateEvents": return .array([mine])
            case "getMembers": return .array([Fixture.member(Fixture.bob, "Bob")])
            default: return nil
            }
        }
        let model = makeModel(backend)
        await model.reload()
        XCTAssertEqual(model.events.map(\.title), ["Dentist", "Review"])
        XCTAssertEqual(model.events.map(\.isPrivate), [true, false])
        XCTAssertEqual(model.events[1].owner, Fixture.bob)
        XCTAssertEqual(model.events[1].peers, [Fixture.me])
        XCTAssertEqual(model.displayName(Fixture.bob), "Bob")
        XCTAssertFalse(model.canEdit(model.events[1]))
        XCTAssertTrue(model.canEdit(model.events[0]))
        XCTAssertEqual(backend.recording.calls("getEvents").first?.path, .query)
        XCTAssertEqual(backend.recording.calls("getPrivateEvents").first?.path, .query)
    }

    func testAPrivateEventGoesToCreatePrivateEventAndAPeerlessOneToCreateEvent() async throws {
        let backend = Fixture.backend()
        let model = makeModel(backend)
        var draft = EventDraft.new(on: Fixture.date(28), now: Fixture.date(1, month: 1), math: Fixture.math)
        draft.title = "Focus"
        try await model.save(draft)
        draft.title = "Dentist"
        draft.setPrivate(true)
        try await model.save(draft)
        // The contract keeps a peerless `createEvent` private itself.
        XCTAssertEqual(backend.recording.calls("createEvent").count, 1)
        let call = try XCTUnwrap(backend.recording.calls("createPrivateEvent").first)
        XCTAssertEqual((call.sent["eventData"] as? [String: Any])?["title"] as? String, "Dentist")
    }

    func testASharedEventGoesToCreateEventWithAccountPeersAndTheWebDateString() async throws {
        let backend = Fixture.backend()
        let model = makeModel(backend)
        var draft = EventDraft.new(on: Fixture.date(28), now: Fixture.date(1, month: 1), math: Fixture.math)
        draft.title = "Planning"
        draft.togglePeer(Fixture.bob)
        try await model.save(draft)
        let call = try XCTUnwrap(backend.recording.calls("createEvent").first)
        XCTAssertEqual(call.path, .execute)
        let event = try XCTUnwrap(call.sent["eventData"] as? [String: Any])
        XCTAssertEqual(event["peers"] as? [String], [Fixture.bob])
        XCTAssertEqual(event["event_type"] as? String, "event")
        XCTAssertEqual(EventTime.parse(event["start"] as? String ?? ""), Fixture.date(28, 9))
        XCTAssertTrue((event["start"] as? String ?? "").contains(" GMT"))
        // The log is the clock: no client timestamp.
        XCTAssertNil(call.sent["timestamp"])
        XCTAssertEqual(Set(call.sent.keys), ["eventData"])
    }

    func testEditingAndDeletingSharedAndPrivateEvents() async throws {
        let backend = Fixture.backend()
        let model = makeModel(backend)

        let shared = CalendarItem(
            id: "s1", title: "Sync", owner: Fixture.me, start: Fixture.date(28, 9), end: Fixture.date(28, 10),
            peers: [Fixture.bob])
        var edit = EventDraft.editing(shared)
        edit.title = "Sync (moved)"
        try await model.save(edit)
        let update = try XCTUnwrap(backend.recording.calls("updateEvent").first)
        XCTAssertEqual(update.sent["eventId"] as? String, "s1")
        XCTAssertEqual((update.sent["eventData"] as? [String: Any])?["title"] as? String, "Sync (moved)")

        try await model.delete(shared)
        XCTAssertEqual(backend.recording.calls("deleteEvent").first?.sent["eventId"] as? String, "s1")

        // A private event that gains a teammate is promoted by `updatePrivateEvent`.
        let lunch = CalendarItem(
            id: "p1", title: "Lunch", owner: Fixture.me, start: Fixture.date(28, 12), end: Fixture.date(28, 13),
            isPrivate: true)
        var share = EventDraft.editing(lunch)
        share.setPrivate(false)
        share.togglePeer(Fixture.carol)
        try await model.save(share)
        let promote = try XCTUnwrap(backend.recording.calls("updatePrivateEvent").first)
        XCTAssertEqual(promote.sent["eventId"] as? String, "p1")
        XCTAssertEqual((promote.sent["eventData"] as? [String: Any])?["peers"] as? [String], [Fixture.carol])

        try await model.delete(lunch)
        XCTAssertEqual(backend.recording.calls("deletePrivateEvent").first?.sent["eventId"] as? String, "p1")
        XCTAssertEqual(backend.recording.calls("deleteEvent").count, 1)
    }

    func testFirstOpenAsksForANameThenRegistersIt() async {
        let backend = Fixture.backend()
        let names = NameBook(store: MemoryStore())
        let model = makeModel(backend, names: names)
        await model.start()
        XCTAssertTrue(model.needsName)
        await model.setName(" Ana ")
        XCTAssertFalse(model.needsName)
        XCTAssertEqual(backend.recording.calls("setUsername").first?.sent["username"] as? String, "Ana")
        XCTAssertEqual(names.lastUsername, "Ana")

        let second = makeModel(backend, names: names)
        await second.start()
        XCTAssertFalse(second.needsName)
        XCTAssertEqual(backend.recording.calls("setUsername").count, 2)
    }

    func testValidationIsSaidBeforeAnythingIsSent() async {
        let backend = Fixture.backend()
        let model = makeModel(backend)
        do {
            try await model.save(EventDraft.new(on: Fixture.date(28), math: Fixture.math))
            XCTFail("saved")
        } catch {
            XCTAssertEqual(error as? DraftError, DraftError(message: "Add a title"))
        }
        XCTAssertTrue(backend.recording.calls.isEmpty)
    }

    func testALiveEventReloads() async throws {
        let backend = Fixture.backend()
        let model = makeModel(backend)
        let live = Task { await model.runLive() }
        defer { live.cancel() }
        for _ in 0..<50 where backend.recording.calls("getEvents").isEmpty {
            backend.emit(AppContextEvent(contextId: Fixture.contextId, kind: "StateMutation"))
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTAssertFalse(backend.recording.calls("getEvents").isEmpty)
    }

    func testNavigation() {
        let model = makeModel(Fixture.backend())
        model.mode = .week
        model.step(1)
        XCTAssertEqual(model.focus, Fixture.date(4, month: 11))
        model.mode = .day
        model.step(-1)
        XCTAssertEqual(model.focus, Fixture.date(3, month: 11))
        model.goToToday(Fixture.date(28, 15))
        XCTAssertEqual(model.focus, Fixture.date(28))
    }
}
