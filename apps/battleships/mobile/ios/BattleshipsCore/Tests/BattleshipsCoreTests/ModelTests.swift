import MeroKit
import MeroKitTestSupport
import XCTest

@testable import BattleshipsCore

/// ``BattleshipsBackend`` over the SDK's ``InMemoryAppBackend``: contexts are created there (so
/// they list), and the service each runs is remembered here.
final class FakeBattleshipsBackend: BattleshipsBackend, @unchecked Sendable {
    let memory: InMemoryAppBackend
    private let lock = NSLock()
    private var services: [String: String] = [:]
    private(set) var created: [(service: String, groupId: String, initArgs: JSONValue)] = []

    init(memory: InMemoryAppBackend = InMemoryAppBackend()) {
        self.memory = memory
    }

    var app: any MeroAppBackend { memory }

    func createServiceContext(
        groupId: String, applicationId: String, service: String, name: String, initArgs: JSONValue
    ) async throws -> String {
        let id = try await memory.createContext(
            groupId: groupId, applicationId: applicationId, name: name, initArgs: initArgs, service: service)
        record(id, service: service, groupId: groupId, initArgs: initArgs)
        return id
    }

    func serviceName(contextId: String) async throws -> String? {
        service(of: contextId)
    }

    private func record(_ id: String, service: String, groupId: String, initArgs: JSONValue) {
        lock.lock()
        services[id] = service
        created.append((service, groupId, initArgs))
        lock.unlock()
    }

    private func service(of id: String) -> String? {
        lock.lock()
        defer { lock.unlock() }
        return services[id]
    }

    func setService(_ service: String, for contextId: String) {
        lock.lock()
        services[contextId] = service
        lock.unlock()
    }
}

let me = String(repeating: "ab", count: 32)
let rival = String(repeating: "cd", count: 32)
let rivalAccount = String(repeating: "ce", count: 32)

func summary(_ id: String, contextId: String? = nil, status: String = "Active") -> JSONValue {
    .object([
        "match_id": .string(id), "player1": .string(me), "player2": .string(rival),
        "player2_account": .string(rivalAccount), "status": .string(status),
        "context_id": contextId.map { .string($0) } ?? .null, "winner": .null, "created_ms": .number(1),
    ])
}

@MainActor
final class LobbyModelTests: XCTestCase {
    func testCreatingALobbyFoundsItAndStartsTheLobbyService() async throws {
        let backend = FakeBattleshipsBackend()
        let model = LobbiesModel(backend: backend, applicationId: nil)
        let lobby = try await model.create(name: "  Harbour  ")
        XCTAssertEqual(lobby.name, "Harbour")
        XCTAssertTrue(backend.memory.log.contains("foundNamespace Harbour"))
        XCTAssertEqual(backend.created.map(\.service), ["lobby"])
        XCTAssertEqual(backend.created.first?.groupId, lobby.id)
        XCTAssertEqual(model.lobbies.map(\.id), [lobby.id])
    }

    func testALobbyNeedsAName() async {
        let backend = FakeBattleshipsBackend()
        do {
            _ = try await LobbiesModel(backend: backend, applicationId: nil).create(name: " ")
            XCTFail("expected a refusal")
        } catch {
            XCTAssertEqual(ErrorText.describe(error), "Give the lobby a name.")
        }
        XCTAssertTrue(backend.memory.log.isEmpty)
    }

    func testTheLobbyContextIsFoundByItsServiceNotByBeingFirst() async throws {
        let backend = FakeBattleshipsBackend()
        let ns = AppNamespace(id: "aa01", name: "Harbour", applicationId: "app")
        backend.memory.namespaces = [ns]
        backend.memory.rootContexts = ["aa01": ["game-ctx", "lobby-ctx"]]
        backend.setService("game", for: "game-ctx")
        backend.setService("lobby", for: "lobby-ctx")
        backend.memory.recording.setHandler { call in
            switch call.method {
            case "register_player": return .string(me)
            case "get_matches": return .array([summary("m1", contextId: "game-ctx")])
            case "get_players":
                return .array([
                    .object(["account": .string(me), "player": .string(me)]),
                    .object(["account": .string(rivalAccount), "player": .string(rival)]),
                ])
            case "get_player_stats": return .object(["wins": 2, "losses": 1, "games_played": 3])
            case "get_history": return .array([])
            default: return .null
            }
        }
        let model = LobbyModel(backend: backend, namespace: ns, syncAttempts: 1, syncDelay: .zero)
        await model.load()
        XCTAssertEqual(model.phase, .loaded)
        XCTAssertEqual(model.lobbyContextId, "lobby-ctx")
        XCTAssertTrue(backend.memory.log.contains("joinContext lobby-ctx"), "joins the lobby when not a member")
        XCTAssertEqual(backend.memory.recording.calls("register_player").first?.contextId, "lobby-ctx")
        XCTAssertEqual(model.opponents.map(\.player), [rival])
        XCTAssertEqual(model.myMatches.map(\.matchId), ["m1"])
        XCTAssertEqual(model.stats?.wins, 2)
        XCTAssertEqual(model.ref(for: model.myMatches[0])?.contextId, "game-ctx")
    }

    func testChallengingCreatesTheGameContextBesideTheLobby() async throws {
        let backend = FakeBattleshipsBackend()
        let ns = AppNamespace(id: "aa01", name: "Harbour", applicationId: "app-id")
        backend.memory.rootContexts = ["aa01": ["lobby-ctx"]]
        backend.setService("lobby", for: "lobby-ctx")
        backend.memory.recording.setHandler { call in
            switch call.method {
            case "register_player": return .string(me)
            case "create_match": return .string("m9")
            case "get_matches": return .array([summary("m9")])
            default: return .null
            }
        }
        let model = LobbyModel(backend: backend, namespace: ns, syncAttempts: 1, syncDelay: .zero)
        await model.load()
        let challenged = await model.challenge(rival)
        let ref = try XCTUnwrap(challenged)
        XCTAssertEqual(ref.matchId, "m9")
        XCTAssertEqual(backend.created.map(\.service), ["game"])
        XCTAssertEqual(backend.created.first?.groupId, "aa01", "the game sits in the lobby's group, for the xcall")
        XCTAssertEqual(
            backend.created.first?.initArgs,
            .object([
                "player1": .string(me), "player2": .string(rival), "player2_account": .string(rivalAccount),
                "lobby_context_id": .string("lobby-ctx"), "match_id": .string("m9"),
            ]))
        let recorded = try XCTUnwrap(backend.memory.recording.calls("set_match_context_id").first)
        XCTAssertEqual(recorded.args["context_id"]?.stringValue, ref.contextId)
        XCTAssertEqual(backend.memory.recording.calls("create_match").first?.args["player2"]?.stringValue, rival)
    }

    func testAChallengeToSomethingThatIsNotAKeyIsRefusedLocally() async {
        let backend = FakeBattleshipsBackend()
        backend.memory.rootContexts = ["aa01": ["lobby-ctx"]]
        let model = LobbyModel(backend: backend, namespace: AppNamespace(id: "aa01", name: nil, applicationId: "a"), syncAttempts: 1, syncDelay: .zero)
        await model.load()
        let ref = await model.challenge("nope")
        XCTAssertNil(ref)
        XCTAssertEqual(model.notice, "That is not a valid player key.")
        XCTAssertTrue(backend.memory.recording.calls("create_match").isEmpty)
    }
}

/// The game contract, played in memory: commitments, one pending shot, answers.
final class FakeGame: @unchecked Sendable {
    let lock = NSLock()
    var committed: [String] = []
    var pending: (id: Int, x: Int, y: Int, target: String)?
    var standing = "playing"
    var revealed: [String] = []
    var winner: String?
    var shots = [UInt8](repeating: 0, count: 100)
    var incoming = [UInt8](repeating: 0, count: 100)
    var turn: String? = me
    var calls: [String] = []

    func handle(_ call: RecordedContractCall) throws -> JSONValue? {
        lock.lock()
        defer { lock.unlock() }
        calls.append(call.method)
        switch call.method {
        case "get_match_state":
            var pendingValue: JSONValue = .null
            if let pending {
                pendingValue = .object([
                    "shot_id": .number(Double(pending.id)), "x": .number(Double(pending.x)),
                    "y": .number(Double(pending.y)), "target": .string(pending.target),
                ])
            }
            return .object([
                "standing": .string(standing), "committed": .array(committed.map { .string($0) }),
                "pending_shot": pendingValue, "ended_by": standing == "playing" ? .null : .string("sunk"),
                "loser": .null, "revealed": .array(revealed.map { .string($0) }), "audit_failed": .array([]),
                "winner": winner.map { .string($0) } ?? .null,
            ])
        case "get_shots": return .object(["size": 10, "shots": .array(shots.map { .number(Double($0)) })])
        case "get_incoming_shots": return .object(["size": 10, "shots": .array(incoming.map { .number(Double($0)) })])
        case "get_current_turn": return turn.map { .string($0) } ?? .null
        case "commit_board":
            committed.append(me)
            return .null
        case "acknowledge_shot":
            if let pending { incoming[pending.y * 10 + pending.x] = call.args["hit"]?.boolValue == true ? 2 : 3 }
            pending = nil
            turn = me
            return .string("ok")
        case "propose_shot":
            let x = Int(call.args["x"]?.doubleValue ?? 0)
            let y = Int(call.args["y"]?.doubleValue ?? 0)
            shots[y * 10 + x] = 4
            pending = (1, x, y, rival)
            turn = rival
            return .null
        case "reveal_board":
            revealed.append(me)
            return .null
        default: return .null
        }
    }
}

@MainActor
final class MatchModelTests: XCTestCase {
    private func makeModel(_ game: FakeGame, store: InMemoryBoardStore = InMemoryBoardStore()) -> (MatchModel, FakeBattleshipsBackend) {
        let backend = FakeBattleshipsBackend()
        backend.memory.members = ["game-ctx"]
        backend.memory.recording.setHandler { try game.handle($0) }
        let ref = MatchRef(namespaceId: "aa01", lobbyContextId: "lobby-ctx", matchId: "m1", contextId: "game-ctx", opponent: rival)
        return (MatchModel(ref: ref, me: me, backend: backend, store: store), backend)
    }

    func testANewMatchStartsWithPlacement() async {
        let (model, _) = makeModel(FakeGame())
        await model.refresh()
        XCTAssertEqual(model.stage, .placing)
    }

    func testTapToPlaceThenTapToRotate() {
        let (model, _) = makeModel(FakeGame())
        XCTAssertEqual(model.selectedShip, 0)
        XCTAssertTrue(model.tapPlacement(Coordinate(0, 0)))
        XCTAssertEqual(model.layout.ships[0], PlacedShip(length: 5, origin: Coordinate(0, 0), horizontal: true))
        XCTAssertEqual(model.selectedShip, 1, "the next ship is up")
        XCTAssertTrue(model.tapPlacement(Coordinate(2, 0)))
        XCTAssertEqual(model.layout.ships[0]?.horizontal, false)
        XCTAssertFalse(model.tapPlacement(Coordinate(1, 1)), "touching the carrier")
        XCTAssertNotNil(model.notice)
    }

    func testDeployKeepsTheBoardFirstAndSendsOnlyTheCommitment() async throws {
        let game = FakeGame()
        let store = InMemoryBoardStore()
        let (model, backend) = makeModel(game, store: store)
        model.shuffle()
        let ok = await model.deploy()
        XCTAssertTrue(ok)
        let stored = try XCTUnwrap(store.load(owner: me, matchId: "m1"))
        XCTAssertEqual(stored.cells, model.layout.cells)
        let commit = try XCTUnwrap(backend.memory.recording.calls("commit_board").first)
        XCTAssertEqual(commit.args["commitment"]?.stringValue, stored.commitment)
        XCTAssertEqual(try Commitment.compute(cells: stored.cells, salt: stored.saltBytes), stored.commitment)
        // Nothing but the commitment left the device: no call carries the salt or the cells.
        for call in backend.memory.recording.calls {
            let text = String(data: call.argsJSON ?? Data(), encoding: .utf8) ?? ""
            XCTAssertFalse(text.contains(stored.salt))
            XCTAssertFalse(text.contains("board_bytes"))
        }
        XCTAssertEqual(model.stage, .waiting)
    }

    func testABoardTheStoreRefusesIsNeverCommitted() async {
        let store = InMemoryBoardStore()
        store.refuses = true
        let (model, backend) = makeModel(FakeGame(), store: store)
        model.shuffle()
        let ok = await model.deploy()
        XCTAssertFalse(ok)
        XCTAssertTrue(backend.memory.recording.calls("commit_board").isEmpty)
    }

    func testAShotAtYouIsAnsweredFromYourBoard() async throws {
        let game = FakeGame()
        let store = InMemoryBoardStore()
        let board = try StoredBoard.sealing(Vectors.alice, salt: Vectors.aliceSalt)
        _ = store.save(board, owner: me, matchId: "m1")
        game.committed = [me, rival]
        game.pending = (3, 1, 0, me)  // B1: Alice's destroyer
        game.turn = rival
        let (model, backend) = makeModel(game, store: store)
        await model.refresh()
        let answer = try XCTUnwrap(backend.memory.recording.calls("acknowledge_shot").first)
        XCTAssertEqual(answer.args["hit"]?.boolValue, true)
        XCTAssertEqual(answer.args["shot_id"]?.doubleValue, 3)
        XCTAssertEqual(model.stage, .battle)
        XCTAssertEqual(model.ownBoard[1], Cell.hit)
        XCTAssertTrue(model.isMyTurn)
    }

    func testAimThenFire() async throws {
        let game = FakeGame()
        let store = InMemoryBoardStore()
        _ = store.save(try StoredBoard.sealing(Vectors.alice), owner: me, matchId: "m1")
        game.committed = [me, rival]
        let (model, backend) = makeModel(game, store: store)
        await model.refresh()
        await model.tapTarget(Coordinate(4, 6))
        XCTAssertEqual(model.aim, Coordinate(4, 6))
        XCTAssertTrue(backend.memory.recording.calls("propose_shot").isEmpty)
        await model.tapTarget(Coordinate(4, 6))
        let shot = try XCTUnwrap(backend.memory.recording.calls("propose_shot").first)
        XCTAssertEqual(shot.args["x"]?.doubleValue, 4)
        XCTAssertEqual(shot.args["y"]?.doubleValue, 6)
        XCTAssertNil(model.aim)
        XCTAssertFalse(model.isMyTurn)
    }

    func testTheBoardIsRevealedWhenTheMatchEnds() async throws {
        let game = FakeGame()
        let store = InMemoryBoardStore()
        _ = store.save(try StoredBoard.sealing(Vectors.alice, salt: Vectors.aliceSalt), owner: me, matchId: "m1")
        game.committed = [me, rival]
        game.standing = "awaiting_reveal"
        let (model, backend) = makeModel(game, store: store)
        await model.refresh()
        let reveal = try XCTUnwrap(backend.memory.recording.calls("reveal_board").first)
        let salt = reveal.args["salt"]?.arrayValue?.compactMap(\.doubleValue).map { UInt8($0) }
        XCTAssertEqual(salt, Vectors.aliceSalt, "the salt goes as 16 numbers, as the contract's [u8; 16] reads it")
        let bytes = reveal.args["board_bytes"]?.arrayValue?.compactMap(\.doubleValue).map { UInt8($0) }
        XCTAssertEqual(bytes, Commitment.boardBytes(Vectors.alice.cells))
        XCTAssertEqual(model.stage, .finished)
        XCTAssertEqual(model.outcome, .auditing)
        game.standing = "won"
        game.winner = me
        await model.refresh()
        XCTAssertEqual(model.outcome, .won)
        XCTAssertEqual(backend.memory.recording.calls("reveal_board").count, 1, "revealed once")
    }

    func testAMatchDeployedElsewhereSaysSo() async {
        let game = FakeGame()
        game.committed = [me]
        let (model, _) = makeModel(game)
        await model.refresh()
        XCTAssertEqual(model.stage, .boardMissing)
    }
}

final class InvitationTests: XCTestCase {
    private let ns = String(repeating: "1f", count: 32)

    func testRoundTripsThroughALink() throws {
        let signed = InMemoryAppBackend.invitation(namespaceId: ns)
        let link = try LobbyInvitation(invitation: signed, lobbyName: "Harbour", inviterKey: me).link()
        XCTAssertTrue(link.hasPrefix("https://links.calimero.network/com.calimero.battleships/join?invitation="))
        let parsed = try XCTUnwrap(LobbyInvitation.parse(link))
        XCTAssertEqual(parsed.namespaceId, ns)
        XCTAssertEqual(parsed.lobbyName, "Harbour")
        XCTAssertEqual(parsed.inviterKey, me)
    }

    func testTheTokenIsTheSDKsLinkShape() throws {
        let invite = InMemoryAppBackend.invitation(namespaceId: ns)
        let token = try LobbyInvitation(invitation: invite, lobbyName: "Harbour").token()
        let json = try XCTUnwrap(InviteCodec.decode(token: token))
        let value = try JSONDecoder().decode(JSONValue.self, from: Data(json.utf8))
        XCTAssertEqual(value["invitation"]?["orgId"]?.stringValue, ns, "InvitationLinkPayload reads the org here")
        XCTAssertEqual(value["invitation"]?["token"]?.stringValue, invite.token)
        XCTAssertEqual(value["namespaceId"]?.stringValue, ns)
        XCTAssertEqual(value["__lobbyName"]?.stringValue, "Harbour")
    }

    func testReadsRawJSONAndRefusesOtherAppsAndPre10Invitations() throws {
        let json = #"{"invitation":{"orgId":"\#(ns)","token":"inv_abc"},"namespaceId":"\#(ns)"}"#
        XCTAssertEqual(LobbyInvitation.parse(json)?.namespaceId, ns)
        XCTAssertEqual(LobbyInvitation.parse(json)?.invitation.token, "inv_abc")
        let token = try XCTUnwrap(InviteCodec.encode(json: json))
        XCTAssertNil(LobbyInvitation.parse("https://links.calimero.network/com.calimero.chat/join?invitation=\(token)"))
        XCTAssertNotNil(LobbyInvitation.parse("calimero://com.calimero.battleships/join?invitation=\(token)"))
        XCTAssertNil(LobbyInvitation.parse("hello"))
        let pre10 = #"{"invitation":{"group_id":[1,2]},"inviter_signature":"ff"}"#
        XCTAssertNil(LobbyInvitation.parse(pre10), "a 1.0 cluster cannot redeem a signed group invitation")
    }

    @MainActor
    func testJoiningRedeemsTheNamespace() async throws {
        let backend = InMemoryAppBackend()
        let link = try LobbyInvitation(invitation: InMemoryAppBackend.invitation(namespaceId: ns), lobbyName: "Harbour").link()
        let model = InvitationModel()
        XCTAssertTrue(model.open(link))
        XCTAssertEqual(model.stage, .confirm(title: "Harbour"))
        var joined = false
        await model.accept(backend: { backend }, didJoin: { joined = true })
        XCTAssertTrue(joined)
        XCTAssertEqual(model.stage, .joined(namespaceId: ns, title: "Harbour"))
        XCTAssertTrue(backend.log.contains { $0.hasPrefix("joinNamespace \(ns)") })
    }
}

final class ServiceBackendTests: XCTestCase {
    func testCreatesPerServiceAndTagsTheInstance() async throws {
        let memory = InMemoryAppBackend()
        let ns = try await memory.foundNamespace(name: "Harbour").namespaceId
        let tags = Tags()
        let backend = ServiceBattleshipsBackend(
            app: memory, tagService: { id, _, service in tags.set(id, service) }, readService: { tags.get($0) })
        let id = try await backend.createServiceContext(
            groupId: ns, applicationId: memory.applicationId, service: Battleships.lobbyService, name: "lobby",
            initArgs: .object([:]))
        XCTAssertTrue(memory.log.contains { $0.hasPrefix("createContext") && $0.hasSuffix("service=lobby") })
        let service = try await backend.serviceName(contextId: id)
        XCTAssertEqual(service, Battleships.lobbyService)
    }

    func testFallsBackToTheInstanceMetadata() async throws {
        let backend = ServiceBattleshipsBackend(app: InMemoryAppBackend())
        let service = try await backend.serviceName(contextId: "nope")
        XCTAssertNil(service)
    }

    final class Tags: @unchecked Sendable {
        private let lock = NSLock()
        private var map: [String: String] = [:]
        func set(_ id: String, _ service: String) { lock.lock(); map[id] = service; lock.unlock() }
        func get(_ id: String) -> String? { lock.lock(); defer { lock.unlock() }; return map[id] }
    }
}

final class ErrorTextTests: XCTestCase {
    struct Raw: Error, CustomStringConvertible {
        let description: String
    }

    func testReadsTheContractErrorOutOfItsBytes() {
        let body = Array(#"{"kind":"Invalid","data":"not your turn"}"#.utf8).map(String.init).joined(separator: ", ")
        XCTAssertEqual(ErrorText.describe(Raw(description: "rpc failed: [\(body)]")), "It is not your turn yet.")
        XCTAssertTrue(ErrorText.isFinished(Raw(description: #"{"kind":"Finished","data":""}"#)))
    }

    func testOfflineIsSaidPlainly() {
        XCTAssertEqual(
            ErrorText.describe(URLError(.notConnectedToInternet)), "You're offline. Check your connection and try again.")
    }
}
