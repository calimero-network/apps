import MeroKit
import MeroKitTestSupport
import XCTest

@testable import BattleshipsCore

let me = String(repeating: "ab", count: 32)
let rival = String(repeating: "cd", count: 32)
let rivalAccount = String(repeating: "ce", count: 32)

/// A `MatchSummary` as the contract answers it: u64s as decimal strings.
func summary(_ id: String, status: String = "Active") -> JSONValue {
    .object([
        "match_id": .string(id), "player1": .string(me), "player2": .string(rival),
        "player2_account": .string(rival), "status": .string(status), "winner": .null,
        "created_ms": .string("1700000000000"),
    ])
}

@MainActor
final class LobbyModelTests: XCTestCase {
    func testCreatingALobbyFoundsAnOrgAndOneInstanceOfThePackage() async throws {
        let backend = InMemoryAppBackend()
        let model = LobbiesModel(backend: backend, applicationId: Battleships.packageName)
        let lobby = try await model.create(name: "  Harbour  ")
        XCTAssertEqual(lobby.name, "Harbour")
        XCTAssertTrue(backend.log.contains("foundNamespace Harbour"))
        XCTAssertTrue(backend.log.contains("createContext \(lobby.id) \(Battleships.packageName) Harbour"))
        XCTAssertEqual(backend.rootContexts[lobby.id]?.count, 1)
        XCTAssertEqual(model.lobbies.map(\.id), [lobby.id])
    }

    func testALobbyNeedsAName() async {
        let backend = InMemoryAppBackend()
        do {
            _ = try await LobbiesModel(backend: backend, applicationId: nil).create(name: " ")
            XCTFail("expected a refusal")
        } catch {
            XCTAssertEqual(ErrorText.describe(error), "Give the lobby a name.")
        }
        XCTAssertTrue(backend.log.isEmpty)
    }

    func testLoadingReadsTheLobbyInstanceWithCamelCaseViews() async throws {
        let backend = InMemoryAppBackend()
        let ns = AppNamespace(id: "aa01", name: "Harbour", applicationId: "app")
        backend.namespaces = [ns]
        backend.rootContexts = ["aa01": ["lobby-app"]]
        backend.groupMembers = ["aa01": [AppMember(identity: rival, role: "Member", name: "Rafael")]]
        backend.recording.setHandler { call in
            switch call.method {
            case "registerPlayer": return .string(me)
            case "getMatches": return .array([summary("m1")])
            case "getPlayers":
                return .array([
                    .object(["account": .string(me), "player": .string(me)]),
                    .object(["account": .string(rival), "player": .string(rival)]),
                ])
            case "getPlayerStats":
                XCTAssertEqual(call.args["player"]?.stringValue, me)
                return .object(["wins": "2", "losses": "1", "games_played": "3"])
            case "getHistory":
                return .array([
                    .object([
                        "match_id": "m0", "winner": .string(me), "loser": .string(rival),
                        "finished_ms": "1700000000001",
                    ])
                ])
            default: return .null
            }
        }
        let model = LobbyModel(backend: backend, namespace: ns, syncAttempts: 1, syncDelay: .zero)
        await model.load()
        XCTAssertEqual(model.phase, .loaded)
        XCTAssertEqual(model.appId, "lobby-app")
        XCTAssertEqual(backend.recording.calls("registerPlayer").first?.contextId, "lobby-app")
        XCTAssertEqual(backend.recording.calls("registerPlayer").first?.path, .execute)
        XCTAssertEqual(backend.recording.calls("getMatches").first?.path, .query)
        XCTAssertEqual(model.opponents.map(\.player), [rival])
        XCTAssertEqual(model.myMatches.map(\.match_id), ["m1"])
        XCTAssertEqual(model.myMatches.first?.created_ms, 1_700_000_000_000)
        XCTAssertEqual(model.stats, PlayerStatsView(wins: 2, losses: 1, games_played: 3))
        XCTAssertEqual(model.history.first?.finished_ms, 1_700_000_000_001)
        XCTAssertEqual(model.displayName(rival), "Rafael", "names come from the org's member metadata")
        XCTAssertEqual(model.ref(for: model.myMatches[0]), MatchRef(namespaceId: "aa01", appId: "lobby-app", matchId: "m1", opponent: rival))
    }

    func testChallengingCreatesTheMatchInTheLobbyInstance() async throws {
        let backend = InMemoryAppBackend()
        let ns = AppNamespace(id: "aa01", name: "Harbour", applicationId: "app-id")
        backend.rootContexts = ["aa01": ["lobby-app"]]
        backend.recording.setHandler { call in
            switch call.method {
            case "registerPlayer": return .string(me)
            case "createMatch": return .string("m9")
            case "getMatches": return .array([summary("m9", status: "Pending")])
            default: return .null
            }
        }
        let model = LobbyModel(backend: backend, namespace: ns, syncAttempts: 1, syncDelay: .zero)
        await model.load()
        let challenged = await model.challenge(rival)
        let ref = try XCTUnwrap(challenged)
        XCTAssertEqual(ref, MatchRef(namespaceId: "aa01", appId: "lobby-app", matchId: "m9", opponent: rival))
        let created = try XCTUnwrap(backend.recording.calls("createMatch").first)
        XCTAssertEqual(created.args, .object(["player2": .string(rival)]))
        XCTAssertEqual(created.contextId, "lobby-app")
        XCTAssertFalse(backend.log.contains { $0.hasPrefix("createContext") }, "no instance per match on 1.0")
    }

    func testAChallengeToNoOneIsRefusedLocally() async {
        let backend = InMemoryAppBackend()
        backend.rootContexts = ["aa01": ["lobby-app"]]
        let model = LobbyModel(backend: backend, namespace: AppNamespace(id: "aa01", name: nil, applicationId: "a"), syncAttempts: 1, syncDelay: .zero)
        await model.load()
        let ref = await model.challenge("  ")
        XCTAssertNil(ref)
        XCTAssertEqual(model.notice, "That is not a valid player.")
        XCTAssertTrue(backend.recording.calls("createMatch").isEmpty)
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
        case "getMatchState":
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
        case "getShots": return .object(["size": 10, "shots": .array(shots.map { .number(Double($0)) })])
        case "getIncomingShots": return .object(["size": 10, "shots": .array(incoming.map { .number(Double($0)) })])
        case "getCurrentTurn": return turn.map { .string($0) } ?? .null
        case "commitBoard":
            committed.append(me)
            return .null
        case "acknowledgeShot":
            if let pending { incoming[pending.y * 10 + pending.x] = call.args["hit"]?.boolValue == true ? 2 : 3 }
            pending = nil
            turn = me
            return .string("ok")
        case "proposeShot":
            let x = Int(call.args["x"]?.doubleValue ?? 0)
            let y = Int(call.args["y"]?.doubleValue ?? 0)
            shots[y * 10 + x] = 4
            pending = (1, x, y, rival)
            turn = rival
            return .null
        case "revealBoard":
            revealed.append(me)
            return .null
        default: return .null
        }
    }
}

@MainActor
final class MatchModelTests: XCTestCase {
    private func makeModel(_ game: FakeGame, store: InMemoryBoardStore = InMemoryBoardStore()) -> (MatchModel, InMemoryAppBackend) {
        let backend = InMemoryAppBackend()
        backend.recording.setHandler { try game.handle($0) }
        let ref = MatchRef(namespaceId: "aa01", appId: "lobby-app", matchId: "m1", opponent: rival)
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
        let commit = try XCTUnwrap(backend.recording.calls("commitBoard").first)
        XCTAssertEqual(commit.args["commitment"]?.stringValue, stored.commitment)
        XCTAssertEqual(try Commitment.compute(cells: stored.cells, salt: stored.saltBytes), stored.commitment)
        // Nothing but the commitment left the device: no call carries the salt or the cells.
        for call in backend.recording.calls {
            let text = String(data: call.argsJSON ?? Data(), encoding: .utf8) ?? ""
            XCTAssertFalse(text.contains(stored.salt))
            XCTAssertFalse(text.contains("boardBytes"))
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
        XCTAssertTrue(backend.recording.calls("commitBoard").isEmpty)
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
        let answer = try XCTUnwrap(backend.recording.calls("acknowledgeShot").first)
        XCTAssertEqual(answer.args["hit"]?.boolValue, true)
        XCTAssertEqual(answer.args["shotId"]?.doubleValue, 3)
        XCTAssertEqual(answer.args["matchId"]?.stringValue, "m1")
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
        XCTAssertTrue(backend.recording.calls("proposeShot").isEmpty)
        await model.tapTarget(Coordinate(4, 6))
        let shot = try XCTUnwrap(backend.recording.calls("proposeShot").first)
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
        let reveal = try XCTUnwrap(backend.recording.calls("revealBoard").first)
        XCTAssertEqual(reveal.contextId, "lobby-app")
        let salt = reveal.args["salt"]?.stringValue.flatMap(Base64URL.decode)
        XCTAssertEqual(salt, Vectors.aliceSalt, "the salt goes as base64url")
        XCTAssertFalse(reveal.args["salt"]?.stringValue?.contains("=") ?? true, "unpadded")
        let bytes = reveal.args["boardBytes"]?.stringValue.flatMap(Base64URL.decode)
        XCTAssertEqual(bytes, Commitment.boardBytes(Vectors.alice.cells))
        XCTAssertEqual(model.stage, .finished)
        XCTAssertEqual(model.outcome, .auditing)
        game.standing = "won"
        game.winner = me
        await model.refresh()
        XCTAssertEqual(model.outcome, .won)
        XCTAssertEqual(backend.recording.calls("revealBoard").count, 1, "revealed once")
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
        XCTAssertEqual(value["invitation"]?.stringValue, invite.token)
        XCTAssertEqual(value["namespaceId"]?.stringValue, ns, "OrgInvitation reads the org here")
        XCTAssertEqual(value["name"]?.stringValue, "Harbour")
        let sdk = try XCTUnwrap(OrgInvitation.decode(token))
        XCTAssertEqual(sdk.namespaceId, ns)
        XCTAssertEqual(value["__lobbyName"]?.stringValue, "Harbour")
    }

    func testReadsRawJSONAndRefusesOtherAppsAndPre10Invitations() throws {
        let json = #"{"invitation":"inv_abc","namespaceId":"\#(ns)"}"#
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

final class ErrorTextTests: XCTestCase {
    func testAppErrorsInWords() {
        XCTAssertEqual(ErrorText.describe(AppError("x", details: ["code": "Finished"])), "This match is already finished.")
        XCTAssertTrue(ErrorText.isFinished(AppError("x", details: ["code": "Finished"])))
        let invalid = AppError("x", details: ["code": "Invalid", "fields": .object(["message": "not your turn"])])
        XCTAssertEqual(ErrorText.describe(invalid), "Not your turn.")
        let notReady = AppError("x", details: ["code": "Invalid", "fields": .object(["message": "opponent must place ships first"])])
        XCTAssertTrue(ErrorText.isOpponentNotReady(notReady))
        XCTAssertEqual(
            ErrorText.describe(AppError("x", details: ["code": "CommitmentMismatch"])),
            "That board does not match the fleet you deployed.")
    }

    func testEveryContractErrorHasWords() throws {
        for code in ["AlreadyCommitted", "CommitmentMismatch", "Finished", "Forbidden", "Invalid", "MatchIdCollision", "NotFound"] {
            XCTAssertNotNil(ErrorText.appErrors[code], code)
        }
    }

    func testTransportErrorsAreSaidPlainly() {
        XCTAssertEqual(
            ErrorText.describe(URLError(.notConnectedToInternet)), "You're offline. Check your connection and try again.")
        XCTAssertEqual(ErrorText.describe(LoginRequired("expired")), "Your session ended. Sign in again.")
        XCTAssertEqual(ErrorText.describe(ConfirmCancelled()), "You dismissed the passkey sheet, so nothing changed.")
    }
}
