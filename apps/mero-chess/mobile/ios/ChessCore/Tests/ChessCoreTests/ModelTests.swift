import MeroChessGenerated
import MeroKit
import MeroKitTestSupport
import XCTest

@testable import ChessCore

@MainActor
final class TableModelTests: XCTestCase {
    private var backend: InMemoryAppBackend!
    private var script: TableScript!
    private let contextId = String(repeating: "cc", count: 32)
    private let namespaceId = String(repeating: "aa", count: 32)

    override func setUp() async throws {
        backend = InMemoryAppBackend(account: Fixtures.me)
        script = TableScript(Fixtures.table())
        script.install(on: backend.recording)
    }

    private func model(name: String = "Ana") -> TableModel {
        TableModel(backend: backend, contextId: contextId, namespaceId: namespaceId, names: MemoryNameStore(name))
    }

    private func args(_ method: String) -> [String: JSONValue]? {
        guard case .object(let fields)? = backend.recording.calls(method).last?.args else { return nil }
        return fields
    }

    func testRefreshReadsTheWholeTableInOneCall() async {
        let model = model()
        await model.refresh()
        XCTAssertEqual(model.view?.title, "Friday game")
        XCTAssertEqual(backend.recording.calls("table").count, 1)
        XCTAssertEqual(backend.recording.calls("table").first?.contextId, contextId)
        XCTAssertEqual(backend.recording.calls("table").first?.path, .query)
        XCTAssertTrue(model.interactive)
        XCTAssertFalse(model.flipped)
        XCTAssertEqual(backend.recording.calls("history").count, 1, "the record is read once per game state")
        await model.refresh()
        XCTAssertEqual(backend.recording.calls("history").count, 1)
    }

    func testTapPicksUpThenMovesThroughTheContract() async {
        let model = model()
        await model.refresh()
        await model.tap("e2")
        XCTAssertEqual(model.selected, "e2")
        XCTAssertEqual(model.targets, ["e3", "e4"])
        let sent = await model.tap("e4")
        XCTAssertEqual(sent, "e2e4")
        XCTAssertEqual(backend.recording.calls("play").count, 1)
        XCTAssertEqual(backend.recording.calls("play").first?.path, .execute)
        XCTAssertEqual(args("play")?["uci"], .string("e2e4"))
        XCTAssertNil(model.selected)
        XCTAssertEqual(model.movesPlayed, 1)
    }

    func testTappingAnEmptyOrForeignSquareSelectsNothing() async {
        let model = model()
        await model.refresh()
        await model.tap("e4")
        XCTAssertNil(model.selected)
        await model.tap("e7")
        XCTAssertNil(model.selected)
        await model.tap("g1")
        await model.tap("g1")
        XCTAssertNil(model.selected, "tapping the selected piece puts it down")
        await model.tap("g1")
        await model.tap("b1")
        XCTAssertEqual(model.selected, "b1", "another of your pieces is picked up instead")
    }

    func testTheBoardIgnoresTapsWhenItIsNotYourMove() async {
        script.view = Fixtures.table(legal: [], myTurn: false, sideToMove: "black")
        let model = model()
        await model.refresh()
        XCTAssertFalse(model.interactive)
        await model.tap("e2")
        XCTAssertNil(model.selected)
        XCTAssertTrue(backend.recording.calls("play").isEmpty)
    }

    func testPromotionAsksForThePiece() async {
        script.view = Fixtures.table(fen: "8/4P3/8/8/8/8/k7/4K3 w - - 0 1", legal: ["e7e8q", "e7e8r", "e7e8b", "e7e8n", "e1d1"])
        let model = model()
        await model.refresh()
        await model.tap("e7")
        let sent = await model.tap("e8")
        XCTAssertNil(sent)
        XCTAssertEqual(model.promotion?.kinds, Array("qrbn"))
        XCTAssertEqual(model.promotion?.color, .white)
        XCTAssertTrue(backend.recording.calls("play").isEmpty)
        await model.promote("n")
        XCTAssertEqual(args("play")?["uci"], .string("e7e8n"))
        XCTAssertNil(model.promotion)
    }

    func testARefusalIsShownAsTheContractWroteIt() async {
        script.refuse("play", "it is not your move")
        let model = model()
        await model.refresh()
        await model.tap("e2")
        await model.tap("e4")
        XCTAssertEqual(model.error, "it is not your move")
        XCTAssertEqual(model.movesPlayed, 0)
        XCTAssertFalse(model.busy)
        model.dismissError()
        XCTAssertNil(model.error)
    }

    func testSittingUsesTheStoredName() async {
        script.view = Fixtures.table(
            legal: [], myColor: "", myTurn: false, status: "awaitingPlayers",
            white: Fixtures.seat("white", "", ""), black: Fixtures.seat("black", Fixtures.them, "Ben"))
        let model = model(name: "  Ana  ")
        await model.refresh()
        XCTAssertFalse(model.isSeated)
        await model.sit(.white)
        XCTAssertEqual(args("sit")?["seat"], .string("white"))
        XCTAssertEqual(args("sit")?["name"], .string("Ana"))
        model.name = ""
        await model.sit(.white)
        XCTAssertEqual(args("sit")?["name"], .string("Guest"))
    }

    func testDrawOfferStatesAndActions() async {
        script.view = Fixtures.table(drawOfferFrom: Fixtures.them)
        let model = model()
        await model.refresh()
        XCTAssertTrue(model.offerFromOpponent)
        XCTAssertFalse(model.myOfferStands)
        await model.acceptDraw()
        await model.declineDraw()
        await model.offerDraw()
        await model.claimDraw()
        await model.resign()
        await model.rematch()
        let methods = backend.recording.calls.filter { $0.path == .execute }.map(\.method)
        XCTAssertEqual(methods, ["accept_draw", "decline_draw", "offer_draw", "claim_draw", "resign", "rematch"])
    }

    func testBlackSeesTheBoardFromBlacksSideButBothChairsDoNotFlip() async {
        script.view = Fixtures.table(
            myColor: "black", white: Fixtures.seat("white", Fixtures.them, "Ben"),
            black: Fixtures.seat("black", Fixtures.me, "Ana"))
        let black = model()
        await black.refresh()
        XCTAssertTrue(black.flipped)

        script.view = Fixtures.table(
            myColor: "black", white: Fixtures.seat("white", Fixtures.me, "Ana"),
            black: Fixtures.seat("black", Fixtures.me, "Ana"))
        let both = model()
        await both.refresh()
        XCTAssertFalse(both.flipped)
    }

    func testStandIsOfferedOnlyBeforeTheFirstMove() async {
        let model = model()
        await model.refresh()
        XCTAssertTrue(model.canStand(.white))
        XCTAssertFalse(model.canStand(.black))
        script.view = Fixtures.table(moves: [MoveView(ply: 0, uci: "e2e4", san: "e4", by: Fixtures.me, at: 1)])
        await model.refresh()
        XCTAssertFalse(model.canStand(.white))
        XCTAssertEqual(model.lastMove?.from, "e2")
        XCTAssertEqual(model.lastMove?.to, "e4")
    }

    func testAnEventTriggersARead() async throws {
        let model = model()
        let task = Task { await model.run() }
        try await waitUntil { self.backend.recording.calls("table").count >= 1 }
        XCTAssertEqual(backend.recording.calls("join").count, 1, "presence is announced on open")
        let before = backend.recording.calls("table").count
        backend.emit(AppContextEvent(contextId: contextId, kind: "StateMutation"))
        try await waitUntil { self.backend.recording.calls("table").count > before }
        task.cancel()
    }

    func testInviteLinkCarriesTheTableAndItsNamespace() async throws {
        let model = model()
        let link = try await model.inviteLink()
        XCTAssertTrue(link.hasPrefix("https://links.calimero.network/com.calimero.mero-chess/join?invitation="))
        let parsed = try XCTUnwrap(ChessInvitation.parse(link))
        XCTAssertEqual(parsed.contextId, contextId)
        XCTAssertEqual(parsed.namespaceId, namespaceId)
        XCTAssertEqual(backend.log.last, "createInvitation \(namespaceId)")
    }

    private func waitUntil(_ condition: @escaping @MainActor () -> Bool) async throws {
        for _ in 0..<200 {
            if condition() { return }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTFail("condition never held")
    }
}

@MainActor
final class LobbyModelTests: XCTestCase {
    func testLoadListsEveryTableWithItsSummary() async {
        let backend = InMemoryAppBackend(account: Fixtures.me)
        TableScript(Fixtures.table()).install(on: backend.recording)
        let club = String(repeating: "aa", count: 32)
        backend.namespaces = [AppNamespace(id: club, name: "Friday club", applicationId: backend.applicationId)]
        backend.rootContexts = [club: ["c1", "c2"]]
        let lobby = LobbyModel(backend: backend, applicationId: backend.applicationId)
        await lobby.load()
        XCTAssertEqual(lobby.tables.map(\.id), ["c1", "c2"])
        XCTAssertEqual(lobby.tables.first?.clubName, "Friday club")
        XCTAssertEqual(lobby.tables.first?.summary?.title, "Friday game")
        XCTAssertEqual(lobby.tables.first?.summary?.state, "Your move")
        XCTAssertEqual(lobby.tables.first?.summary?.players, "Ana vs Ben")
        XCTAssertTrue(lobby.loaded)
    }

    func testCreateFoundsAClubAndInitialisesTheTable() async throws {
        let backend = InMemoryAppBackend(account: Fixtures.me)
        let lobby = LobbyModel(backend: backend, applicationId: backend.applicationId)
        let ref = try await lobby.create(title: " Sunday ", clubId: nil)
        XCTAssertEqual(backend.log.first, "foundNamespace Sunday")
        XCTAssertNotNil(ref.namespaceId)
        XCTAssertEqual(backend.rootContexts[ref.namespaceId!], [ref.contextId], "directly in the namespace")
        guard case .object(let initArgs)? = backend.initArgs[ref.contextId] else { return XCTFail("no init args") }
        XCTAssertEqual(initArgs["title"], .string("Sunday"))
        XCTAssertNotNil(initArgs["now"])
    }

    func testCreateInAnExistingClub() async throws {
        let backend = InMemoryAppBackend(account: Fixtures.me)
        let lobby = LobbyModel(backend: backend, applicationId: backend.applicationId)
        let club = String(repeating: "aa", count: 32)
        let ref = try await lobby.create(title: "", clubId: club)
        XCTAssertFalse(backend.log.contains { $0.hasPrefix("foundNamespace") })
        XCTAssertEqual(ref.namespaceId, club)
        guard case .object(let initArgs)? = backend.initArgs[ref.contextId] else { return XCTFail("no init args") }
        XCTAssertEqual(initArgs["title"], .string("Chess table"))
    }

    func testCreateNeedsAConnectedAccount() async {
        let backend = InMemoryAppBackend(account: Fixtures.me)
        backend.hasRelay = false
        let lobby = LobbyModel(backend: backend, applicationId: backend.applicationId)
        do {
            _ = try await lobby.create(title: "x", clubId: nil)
            XCTFail("created while disconnected")
        } catch {
            XCTAssertEqual(error as? ChessError, .noRelay)
        }
    }

    func testJoinRedeemsTheInvitationAndOpensItsTable() async throws {
        let backend = InMemoryAppBackend(account: Fixtures.me)
        backend.hasRelay = false
        let club = String(repeating: "aa", count: 32)
        let invitation = ChessInvitation(
            invitation: InMemoryAppBackend.invitation(namespaceId: club), namespaceId: club, contextId: "c9")
        let parsed = try XCTUnwrap(ChessInvitation.parse(try invitation.link()))
        let lobby = LobbyModel(backend: backend, applicationId: backend.applicationId)
        var joined = false
        let ref = try await lobby.join(parsed) { joined = true }
        XCTAssertTrue(joined)
        XCTAssertEqual(ref, TableRef(contextId: "c9", namespaceId: club))
        XCTAssertEqual(backend.log, ["joinNamespace \(club)"])
        XCTAssertTrue(backend.hasRelay)
    }

    func testLinkCarriesTheSDKPayload() throws {
        let club = "club1"
        let invitation = InMemoryAppBackend.invitation(namespaceId: club)
        let link = try ChessInvitation(invitation: invitation, namespaceId: club, contextId: "c9").link()
        let json = try XCTUnwrap(InviteCodec.decode(token: XCTUnwrap(InviteLink.token(fromPasted: link))))
        let root = try JSONDecoder().decode(JSONValue.self, from: Data(json.utf8))
        XCTAssertEqual(root["invitation"]?.stringValue, invitation.token)
        XCTAssertEqual(OrgInvitation.parse(link, expectedSlug: ChessConstants.packageName)?.contextId, "c9")
        XCTAssertEqual(root["namespaceId"]?.stringValue, club)
        XCTAssertEqual(root["contextId"]?.stringValue, "c9")
    }

    func testObjectShapedInvitationIsRefused() {
        let json = #"{"invitation":{"orgId":"n","token":"inv_x"},"namespaceId":"n","contextId":"c"}"#
        XCTAssertNil(ChessInvitation.parse(json: json))
    }

    func testPreOneSignedInvitationIsRefused() {
        let json = #"{"invitation":{"invitation":{"group_id":[1]},"inviter_signature":"5a"},"namespaceId":"n","contextId":"c"}"#
        XCTAssertNil(ChessInvitation.parse(json: json))
    }

    func testAnotherAppsLinkIsNotAChessInvitation() throws {
        let club = String(repeating: "aa", count: 32)
        let link = try ChessInvitation(
            invitation: InMemoryAppBackend.invitation(namespaceId: club), namespaceId: club, contextId: "c9"
        ).link()
        XCTAssertNil(ChessInvitation.parse(link.replacingOccurrences(of: "com.calimero.mero-chess", with: "com.calimero.chat")))
        XCTAssertNil(ChessInvitation.parse("hello"))
        XCTAssertNotNil(ChessInvitation.parse(link))
    }
}
