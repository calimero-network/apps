import MeroKit
import MeroKitTestSupport
import XCTest

@testable import KombatCore

@MainActor
final class ArenaModelTests: XCTestCase {
    private var backend: InMemoryAppBackend!
    private var script: ArenaScript!
    private var presence: FakePresence!
    private let ref = ArenaRef(contextId: String(repeating: "cc", count: 32), namespaceId: String(repeating: "aa", count: 32))

    override func setUp() async throws {
        backend = InMemoryAppBackend(account: Fixtures.me)
        script = ArenaScript(Fixtures.arena())
        script.install(on: backend.recording)
        presence = FakePresence()
    }

    private func model(_ store: PlayerStore = MemoryPlayerStore(name: "Ana", fighter: "cryo")) -> ArenaModel {
        ArenaModel(backend: backend, ref: ref, store: store, presence: presence)
    }

    private func args(_ method: String) -> [String: JSONValue]? {
        guard case .object(let fields)? = backend.recording.calls(method).last?.args else { return nil }
        return fields
    }

    func testAReadBootsThePageInMySeatAndFeedsItTheArena() async throws {
        let model = model()
        let page = PageSpy()
        page.attach(model)
        await model.refresh()
        XCTAssertEqual(model.mode, .net)
        XCTAssertEqual(model.local, 0)
        XCTAssertEqual(page.boots, [.boot(mode: .net, local: 0, fighters: ["cryo", "jinzo"], muted: false)])
        let state = try XCTUnwrap(page.states.first)
        let wire = try JSONSerialization.jsonObject(with: Data(state.utf8)) as? [String: Any]
        XCTAssertEqual(wire?["my_seat"] as? String, "p1", "the page reads the ABI's field names")
        XCTAssertEqual(wire?["match_index"] as? Int, 0)
        XCTAssertEqual(backend.recording.calls("arena").first?.path, .query)

        await model.refresh()
        XCTAssertEqual(page.boots.count, 1, "the same seat does not restart the fight")
        XCTAssertEqual(page.states.count, 2)
    }

    func testASpectatorWatches() async {
        script.view = Fixtures.arena(mySeat: "")
        let model = model()
        let page = PageSpy()
        page.attach(model)
        await model.refresh()
        XCTAssertEqual(page.boots, [.boot(mode: .spectate, local: nil, fighters: ["cryo", "jinzo"], muted: false)])
    }

    func testReadyRebootsWithTheLatestArena() async {
        let model = model()
        await model.refresh()
        let page = PageSpy()
        page.attach(model)
        await model.receive(.ready)
        XCTAssertEqual(page.boots.count, 1)
        XCTAssertEqual(page.states.count, 1)
    }

    func testAnActFromThePageIsOneTransactionThroughTheGeneratedClient() async throws {
        let model = model()
        let page = PageSpy()
        page.attach(model)
        await model.receive(
            .call(
                id: 9, kind: .execute, method: "act",
                argsJSON: #"{"match_index":0,"round":1,"id":42,"kind":"uppercut","hit":true,"blocked":false,"now":1700000000000}"#))
        let call = try XCTUnwrap(backend.recording.calls("act").first)
        XCTAssertEqual(call.path, .execute)
        XCTAssertEqual(call.contextId, ref.contextId)
        XCTAssertEqual(args("act")?["kind"], .string("uppercut"))
        XCTAssertEqual(args("act")?["id"], .number(42))
        XCTAssertEqual(args("act")?["match_index"], .number(0))
        XCTAssertTrue(page.messages.contains(.result(id: 9, valueJSON: "null")))
        XCTAssertEqual(model.meter.sent, 1)
        XCTAssertEqual(model.meter.ok, 1)
    }

    func testARefusedActIsAnsweredAsAFailure() async {
        script.refuse("act", "round 1 is already decided")
        let model = model()
        let page = PageSpy()
        page.attach(model)
        await model.receive(
            .call(id: 3, kind: .execute, method: "act",
                  argsJSON: #"{"match_index":0,"round":1,"id":1,"kind":"kick","hit":false,"blocked":false}"#))
        XCTAssertTrue(page.messages.contains(.failure(id: 3, message: "round 1 is already decided")))
        XCTAssertEqual(model.meter.failed, 1)
    }

    func testThePageCannotCallAnythingButTheFight() async {
        let model = model()
        let page = PageSpy()
        page.attach(model)
        await model.receive(.call(id: 1, kind: .execute, method: "rematch", argsJSON: #"{"now":1}"#))
        await model.receive(.call(id: 2, kind: .query, method: "act", argsJSON: "{}"))
        XCTAssertTrue(backend.recording.calls("rematch").isEmpty)
        XCTAssertTrue(backend.recording.calls("act").isEmpty)
        XCTAssertEqual(page.messages.filter { if case .failure = $0 { return true } else { return false } }.count, 2)
    }

    func testQueriesFromThePageGoThroughTheClient() async {
        let model = model()
        let page = PageSpy()
        page.attach(model)
        await model.receive(.call(id: 5, kind: .query, method: "history", argsJSON: "{}"))
        XCTAssertTrue(page.messages.contains(.result(id: 5, valueJSON: "[]")))
    }

    func testSlicesGoOutThroughPresenceAndComeInToThePage() async {
        let model = model()
        let page = PageSpy()
        page.attach(model)
        await model.receive(.presence(sliceJSON: #"{"seat":"p1","n":1}"#))
        XCTAssertEqual(presence.published, [#"{"seat":"p1","n":1}"#])

        model.onSlice(#"{"seat":"p2","n":4}"#)
        XCTAssertEqual(page.messages.last, .slice(json: #"{"seat":"p2","n":4}"#))
        XCTAssertEqual(model.live, ["p2"])
    }

    func testSittingSendsTheNameAndFighterAndPublishesTheName() async throws {
        script.view = Fixtures.arena(status: "waiting", mySeat: "", p2: Fixtures.corner("p2", "", "", ""))
        let model = model()
        await model.refresh()
        await model.sit("p2")
        XCTAssertEqual(args("sit")?["seat"], .string("p2"))
        XCTAssertEqual(args("sit")?["name"], .string("Ana"))
        XCTAssertEqual(args("sit")?["fighter"], .string("cryo"))
    }

    func testChoosingAFighterPicksOnlyWhenSeated() async {
        let store = MemoryPlayerStore(name: "Ana", fighter: "cryo")
        script.view = Fixtures.arena(mySeat: "")
        let model = model(store)
        await model.refresh()
        await model.choose("inferno")
        XCTAssertTrue(backend.recording.calls("pick").isEmpty)
        XCTAssertEqual(store.fighter, "inferno")

        script.view = Fixtures.arena()
        await model.refresh()
        await model.choose("jinzo")
        XCTAssertEqual(args("pick")?["fighter"], .string("jinzo"))
    }

    func testLeavingIsOfferedOnlyBeforeTheFirstBlow() async {
        script.view = Fixtures.arena(status: "waiting", matchActions: 0)
        let model = model()
        await model.refresh()
        XCTAssertTrue(model.canLeave(model.view!.p1))
        XCTAssertFalse(model.canLeave(model.view!.p2), "not my corner")
        script.view = Fixtures.arena(matchActions: 1)
        await model.refresh()
        XCTAssertFalse(model.canLeave(model.view!.p1))
    }

    func testTheRecordIsFinishedMatchesNewestFirst() async {
        script.past = [
            MatchSummary(index: 0, startedAt: 1, winner: "p1", flawless: true, rounds: ["p1", "p1"], actions: 40),
            MatchSummary(index: 1, startedAt: 2, winner: "p2", flawless: false, rounds: ["p2", "p1", "p2"], actions: 61),
            MatchSummary(index: 2, startedAt: 3, winner: "", flawless: false, rounds: [], actions: 3),
        ]
        let model = model()
        await model.refresh()
        XCTAssertEqual(model.record.map(\.index), [1, 0])
    }

    func testAnnounceJoinsOnce() async {
        let model = model()
        await model.announce()
        await model.announce()
        XCTAssertEqual(backend.recording.calls("join").count, 1)
        XCTAssertEqual(args("join")?["fighter"], .string("cryo"))
    }

    func testInviteLinkRoundTrips() async throws {
        let link = try await model().inviteLink()
        XCTAssertTrue(link.hasPrefix("https://links.calimero.network/com.calimero.mero-kombat/join?invitation="))
        let parsed = try XCTUnwrap(KombatInvitation.parse(link))
        XCTAssertEqual(parsed.contextId, ref.contextId)
        XCTAssertEqual(parsed.namespaceId, ref.namespaceId)
    }
}

@MainActor
final class PracticeModelTests: XCTestCase {
    func testReadyBootsAgainstTheCPUAndRematchRestarts() async {
        let model = PracticeModel(store: MemoryPlayerStore(fighter: "kinetic"))
        let page = PageSpy()
        page.attach(model)
        await model.receive(.ready)
        XCTAssertEqual(page.messages, [.boot(mode: .cpu, local: 0, fighters: ["kinetic", "cryo"], muted: false)])
        await model.receive(.over(true))
        XCTAssertTrue(model.over)
        model.rematch()
        XCTAssertFalse(model.over)
        XCTAssertEqual(page.messages.last, .restart)
        model.choose("cryo")
        XCTAssertEqual(page.messages.last, .boot(mode: .cpu, local: 0, fighters: ["cryo", "kinetic"], muted: false))
    }
}

@MainActor
final class LobbyModelTests: XCTestCase {
    func testCreatingAnArenaFoundsANamespaceAndInitialisesTheContract() async throws {
        let backend = InMemoryAppBackend(account: Fixtures.me)
        ArenaScript(Fixtures.arena(status: "waiting", mySeat: "")).install(on: backend.recording)
        let lobby = LobbyModel(backend: backend, applicationId: backend.applicationId)
        await lobby.load()
        XCTAssertTrue(lobby.loaded)
        let ref = try await lobby.create(title: "  Friday night ", namespaceId: nil)
        XCTAssertNotNil(ref.namespaceId)
        guard case .object(let initArgs)? = backend.initArgs[ref.contextId] else { return XCTFail("no init args") }
        XCTAssertEqual(initArgs["title"], .string("Friday night"))
        XCTAssertNotNil(initArgs["now"])
        await lobby.load()
        XCTAssertEqual(lobby.arenas.map(\.id), [ref.contextId])
        XCTAssertEqual(lobby.arenas.first?.summary?.state, "Waiting for fighters")
        XCTAssertEqual(lobby.arenas.first?.summary?.players, "Ana vs Ben")
    }

    func testAnotherAppsLinkIsNotAnInvitation() {
        XCTAssertNil(KombatInvitation.parse("https://links.calimero.network/com.calimero.mero-chess/join?invitation=abc"))
        XCTAssertNil(KombatInvitation.parse("hello"))
    }
}

final class SlicePublisherTests: XCTestCase {
    func testOnlyTheNewestSliceWaitsBehindTheOneInFlight() async {
        let channel = FakePresence()
        channel.delayNanos = 50_000_000
        let publisher = SlicePublisher(channel: channel)
        let first = Task { await publisher.offer("1") }
        try? await Task.sleep(nanoseconds: 10_000_000)
        await publisher.offer("2")
        await publisher.offer("3")
        await publisher.offer("4")
        await first.value
        XCTAssertEqual(channel.published, ["1", "4"])
        let dropped = await publisher.dropped
        XCTAssertEqual(dropped, 2)
    }
}
