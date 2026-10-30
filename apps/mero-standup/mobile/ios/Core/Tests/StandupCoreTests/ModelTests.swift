import Foundation
import MeroKit
import MeroKitTestSupport
import XCTest

@testable import StandupCore

@MainActor
final class TeamsModelTests: XCTestCase {
    func testStartsATeamInTheNamespaceRootAndNamesIt() async throws {
        let fake = FakeTeam()
        let model = TeamsModel(backend: fake.backend, applicationId: "app-1")
        let created = await model.create(name: "  Platform ")
        let team = try XCTUnwrap(created)
        XCTAssertEqual(fake.backend.log.first, "foundNamespace Platform")
        XCTAssertEqual(team.name, "Platform")
        XCTAssertEqual(fake.backend.rootContexts[team.namespaceId], [team.contextId])
        let rename = try XCTUnwrap(fake.recording.calls("set_team_name").first)
        XCTAssertEqual(rename.path, .execute)
        XCTAssertEqual(rename.contextId, team.contextId)
        XCTAssertEqual(rename.args["name"]?.stringValue, "Platform")
        XCTAssertEqual(model.teams, [team])
    }

    func testFallsBackToTheNamespacesApplication() async throws {
        let fake = FakeTeam()
        fake.backend.applicationId = "from-namespace"
        let model = TeamsModel(backend: fake.backend, applicationId: nil)
        let created = await model.create(name: "Ops")
        XCTAssertNotNil(created)
        XCTAssertTrue(fake.backend.log.contains { $0.hasPrefix("createContext") })
    }

    func testListsTeamsWithTheirOwnNames() async {
        let fake = FakeTeam()
        fake.teamName = "Core team"
        fake.backend.namespaces = [AppNamespace(id: "ns-1", name: "ns name", applicationId: "app")]
        fake.backend.rootContexts = ["ns-1": ["ctx-1"]]
        let model = TeamsModel(backend: fake.backend, applicationId: "app")
        await model.load()
        XCTAssertEqual(model.teams, [TeamSummary(namespaceId: "ns-1", contextId: "ctx-1", name: "Core team")])
        XCTAssertNil(model.error)
    }

    func testDisconnectedAccountHasNoTeamsAndNoError() async {
        let fake = FakeTeam()
        fake.backend.hasRelay = false
        let model = TeamsModel(backend: fake.backend, applicationId: nil)
        await model.load()
        XCTAssertTrue(model.teams.isEmpty)
        XCTAssertTrue(model.hasLoaded)
        XCTAssertNil(model.error)
    }

    func testJoinRedeemsTheNamespaceAndOpensTheNamedTeam() async throws {
        let fake = FakeTeam()
        let ns = String(repeating: "cd", count: 32)
        let invitation = StandupInvitation(
            invitation: InMemoryAppBackend.invitation(namespaceId: ns), namespaceId: ns, contextId: "ctx-9")
        let model = TeamsModel(backend: fake.backend, applicationId: "app")
        let joined = await model.join(invitation)
        let team = try XCTUnwrap(joined)
        XCTAssertEqual(team.contextId, "ctx-9")
        XCTAssertTrue(fake.backend.log.contains("joinNamespace \(ns)"))
    }

    func testFailureIsReported() async {
        let fake = FakeTeam()
        fake.backend.failure = URLError(.notConnectedToInternet)
        let model = TeamsModel(backend: fake.backend, applicationId: "app")
        let team = await model.create(name: "X")
        XCTAssertNil(team)
        XCTAssertEqual(model.error?.hasPrefix("Your cluster can't be reached"), true)
    }
}

@MainActor
final class TeamModelTests: XCTestCase {
    func testLoadsIdentityAndNeedsAName() async {
        let fake = FakeTeam()
        let team = await fake.teamModel()
        XCTAssertEqual(team.me, me)
        XCTAssertEqual(team.teamName, "Platform")
        XCTAssertTrue(team.needsName)
        XCTAssertEqual(team.name(of: me, ""), "You")
        try? await team.setMyName(" Fran ")
        XCTAssertEqual(fake.recording.calls("set_name").last?.args["name"]?.stringValue, "Fran")
        XCTAssertFalse(team.needsName)
    }

    func testInviteLinkCarriesTheTeam() async throws {
        let fake = FakeTeam()
        let team = await fake.teamModel()
        let link = try await team.inviteLink()
        let parsed = try XCTUnwrap(StandupInvitation.parse(link))
        XCTAssertEqual(parsed.contextId, "ctx-1")
        XCTAssertEqual(parsed.namespaceId, "ns-1")
        XCTAssertTrue(fake.backend.log.contains("createInvitation ns-1"))
    }

    func testEventsBumpTheVersion() async throws {
        let fake = FakeTeam()
        let team = await fake.teamModel()
        let start = team.version
        let following = Task { await team.follow() }
        defer { following.cancel() }
        // Wait for the stream to be up, then nudge it.
        for _ in 0..<15 where team.version == start {
            fake.backend.emit(AppContextEvent(contextId: "ctx-1", kind: "StateMutation"))
            try await Task.sleep(for: .milliseconds(400))
        }
        XCTAssertGreaterThan(team.version, start)
    }

    func testPollsWithoutAStream() async throws {
        let fake = FakeTeam()
        fake.backend.canSubscribe = false
        let team = await fake.teamModel()
        team.pollWithoutStream = .milliseconds(20)
        let start = team.version
        let following = Task { await team.follow() }
        defer { following.cancel() }
        try await Task.sleep(for: .milliseconds(200))
        XCTAssertGreaterThan(team.version, start)
    }
}

@MainActor
final class BoardModelTests: XCTestCase {
    func testSplitsMineFromOthersAndListsWhoIsMissing() async {
        let fake = FakeTeam()
        fake.days["2026-10-28"] = [
            update(ana, day: "2026-10-28", name: "Ana", done: "x", blockers: "stuck"),
            update(me, day: "2026-10-28", done: "mine"),
        ]
        fake.members = [
            ["account": .string(ana), "name": "Ana", "last_day": "2026-10-28"],
            ["account": .string(bo), "name": "Bo", "last_day": "2026-10-20"],
            ["account": .string(me), "name": "", "last_day": "2026-10-28"],
        ]
        let team = await fake.teamModel()
        let board = BoardModel(team: team, now: { fixedNow }, calendar: utc)
        await board.load()
        XCTAssertEqual(board.mine?.done, "mine")
        XCTAssertEqual(board.others.map(\.author), [ana])
        XCTAssertEqual(board.waiting.map(\.account), [bo])
        XCTAssertEqual(board.summary(of: "2026-10-28").count, 2)
        XCTAssertTrue(board.summary(of: "2026-10-28").blocked)
        XCTAssertEqual(board.draft, UpdateDraft(done: "mine"))
        XCTAssertNil(board.carriedFrom)
        let filter = try? XCTUnwrap(fake.recording.calls("list_decisions").first)
        XCTAssertEqual(filter?.args["from_day"]?.stringValue, "2026-10-28")
        XCTAssertNil(filter?.args["search"], "optional arguments are omitted, not null")
    }

    func testCarriesYourLastUpdateForward() async {
        let fake = FakeTeam()
        fake.days["2026-10-26"] = [update(me, day: "2026-10-26", done: "old", next: "ship it", blockers: "review")]
        fake.members = [["account": .string(me), "name": "Me", "last_day": "2026-10-26"]]
        let team = await fake.teamModel()
        let board = BoardModel(team: team, now: { fixedNow }, calendar: utc)
        await board.load()
        XCTAssertNil(board.mine)
        XCTAssertEqual(board.carriedFrom, "2026-10-26")
        XCTAssertEqual(board.draft, UpdateDraft(done: "ship it", next: "", blockers: "review"))
    }

    func testPostsForTheSelectedDay() async throws {
        let fake = FakeTeam()
        let team = await fake.teamModel()
        let board = BoardModel(team: team, now: { fixedNow }, calendar: utc)
        await board.load()
        await board.shift(by: -1)
        XCTAssertEqual(board.day, "2026-10-27")
        let before = team.version
        try await board.post(UpdateDraft(done: "d", next: "n", blockers: ""))
        let post = try XCTUnwrap(fake.recording.calls("post_update").first)
        XCTAssertEqual(post.path, .execute)
        XCTAssertEqual(post.args, ["day": "2026-10-27", "done": "d", "next": "n", "blockers": ""])
        XCTAssertGreaterThan(team.version, before)
    }

    func testCannotSelectTheFuture() async {
        let fake = FakeTeam()
        let team = await fake.teamModel()
        let board = BoardModel(team: team, now: { fixedNow }, calendar: utc)
        await board.shift(by: 1)
        XCTAssertEqual(board.day, "2026-10-28")
        XCTAssertTrue(board.isToday)
    }

    func testHelpAndWithdraw() async throws {
        let fake = FakeTeam()
        let blocked = update(ana, day: "2026-10-28", blockers: "stuck")
        fake.days["2026-10-28"] = [blocked]
        let team = await fake.teamModel()
        let board = BoardModel(team: team, now: { fixedNow }, calendar: utc)
        await board.load()
        let u = try XCTUnwrap(board.others.first)
        try await board.offerHelp(on: u, note: " pairing ")
        XCTAssertEqual(
            fake.recording.calls("offer_help").first?.args,
            ["day": "2026-10-28", "author": .string(ana), "note": "pairing"])
        try await board.withdrawHelp(on: u)
        XCTAssertEqual(fake.recording.calls("withdraw_help").count, 1)
        try await board.withdraw()
        XCTAssertEqual(fake.recording.calls("clear_update").first?.args, ["day": "2026-10-28"])
    }
}

@MainActor
final class WeekModelTests: XCTestCase {
    func testReadsTheWeekAndStopsAtThisOne() async {
        let fake = FakeTeam()
        fake.days["2026-10-27"] = [update(ana, day: "2026-10-27", name: "Ana", done: "x")]
        let team = await fake.teamModel()
        let week = WeekModel(team: team, now: { fixedNow }, calendar: utc)
        await week.load()
        XCTAssertEqual(fake.recording.calls("get_week").first?.args, ["start": "2026-10-26"])
        XCTAssertEqual(week.people.map(\.name), ["Ana"])
        XCTAssertTrue(week.markdown.hasPrefix("# Platform — week of Oct 26 – Nov 1"))
        await week.shift(by: 1)
        XCTAssertEqual(week.start, "2026-10-26")
        await week.shift(by: -1)
        XCTAssertEqual(week.start, "2026-10-19")
        XCTAssertFalse(week.isThisWeek)
    }
}

@MainActor
final class DecisionsModelTests: XCTestCase {
    func testFiltersAndPages() async {
        let fake = FakeTeam()
        fake.decisions = [decision("d2", title: "New"), decision("d1", title: "Old", supersededBy: "d2")]
        fake.tags = [["tag": "infra", "count": 2]]
        fake.nextCursor = "d1"
        let team = await fake.teamModel()
        let model = DecisionsModel(team: team, calendar: utc)
        await model.load()
        XCTAssertEqual(model.items.map(\.id), ["d2", "d1"])
        XCTAssertTrue(model.hasMore)
        XCTAssertEqual(model.tags.first?.tag, "infra")
        XCTAssertEqual(model.months.count, 1)
        XCTAssertEqual(model.title(of: "d2"), "New")

        await model.toggle(tag: "infra")
        model.search = " rel "
        model.standingOnly = true
        await model.showOlder()
        let last = fake.recording.calls("list_decisions").last
        XCTAssertEqual(
            last?.args, ["search": "rel", "tag": "infra", "standing_only": true, "limit": 50])
    }

    func testLogsADecisionWithItsNotes() async throws {
        let fake = FakeTeam()
        let team = await fake.teamModel()
        let model = DecisionsModel(team: team, calendar: utc)
        let old = try decode(DecisionView.self, decision("d1", title: "Old"))
        var draft = DecisionDraft(fromDay: "2026-10-27", supersedes: old)
        draft.title = " Release weekly "
        draft.decision = "Every Monday"
        draft.tagsInput = "Release process, infra"
        draft.with = [bo, ana]
        let id = try await model.log(draft)
        XCTAssertEqual(id, "new-decision")
        let call = try XCTUnwrap(fake.recording.calls("log_decision").first)
        XCTAssertEqual(call.path, .execute)
        XCTAssertEqual(
            call.args,
            [
                "title": "Release weekly", "decision": "Every Monday", "rationale": "", "supersedes": "d1",
                "tags": ["infra", "release-process"], "with": [.string(ana), .string(bo)], "from_day": "2026-10-27",
            ])
    }

    func testOptionalArgumentsAreOmitted() async throws {
        let fake = FakeTeam()
        let team = await fake.teamModel()
        let model = DecisionsModel(team: team, calendar: utc)
        var draft = DecisionDraft()
        draft.title = "T"
        draft.decision = "D"
        try await model.log(draft)
        let args = try XCTUnwrap(fake.recording.calls("log_decision").first?.args)
        XCTAssertNil(args["supersedes"])
        XCTAssertNil(args["from_day"])
    }
}
