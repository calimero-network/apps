#if DEBUG
import BattleshipsCore
import Foundation
import GameGenerated
import LobbyGenerated
import MeroKit

/// Battleships' demo: four lobbies, their players, matches and results, and
/// a lobby contract and game contract that answer from them in the generated
/// clients' wire shape. Writes change the fixtures: challenging someone
/// creates a match, deploying commits a fleet, firing is answered from the
/// opponent's board (and they fire back a few seconds later), and sinking
/// the last ship finishes the match and records the result in the lobby.
enum BattleshipsDemo {
    static let account = DemoIds.hex("account:me")
    static let me = DemoIds.hex("player:me")
    static let applicationId = DemoIds.hex("app:battleships")

    static let boards = InMemoryBoardStore()
    static let backend: DemoBackend = makeBackend()

    static func player(_ name: String) -> String { DemoIds.hex("player:\(name)") }
    static func accountOf(_ name: String) -> String { DemoIds.hex("account:\(name)") }

    private static func makeBackend() -> DemoBackend {
        let store = Store(now: Date())
        var namespaces: [AppNamespace] = []
        var subgroups: [String: [AppSubgroup]] = [:]
        var members: Set<String> = []
        for lobby in store.lobbyList {
            namespaces.append(
                AppNamespace(id: lobby.namespaceId, name: lobby.name, applicationId: applicationId, memberCount: lobby.memberCount))
            let contexts = [lobby.contextId] + lobby.matches.compactMap(\.contextId)
            subgroups[lobby.namespaceId] = [AppSubgroup(groupId: lobby.namespaceId, name: lobby.name, contextIds: contexts)]
            members.formUnion(contexts)
        }
        return DemoBackend(
            account: account, applicationId: applicationId, namespaces: namespaces, subgroups: subgroups,
            members: members, handler: { try store.handle($0) })
    }

    // MARK: State

    struct Lobby {
        var name: String
        var namespaceId: String
        var contextId: String
        var memberCount: Int
        var players: [PlayerEntry]
        var matches: [MatchSummary]
        var history: [MatchRecord]
    }

    struct Game {
        var lobbyContextId: String
        var matchId: String
        var opponent: String
        /// The opponent's pristine board, what their device answers from.
        var enemy: [UInt8]
        /// Your shots at them, and theirs at you.
        var shots: [UInt8] = empty
        var incoming: [UInt8] = empty
        var committed: [String] = []
        var turn: String?
        var standing = "playing"
        var winner: String?
        var loser: String?
        var endedBy: String?
        var revealed: [String] = []
        /// When the opponent deploys their fleet, and when they fire back.
        var opponentCommitsAt: Date?
        var opponentFiresAt: Date?
    }

    static let empty = [UInt8](repeating: Cell.empty, count: BoardGeometry.cellCount)

    final class Store: @unchecked Sendable {
        private let lock = NSLock()
        private let now: Date
        private var lobbies: [String: Lobby] = [:]
        private var order: [String] = []
        private var games: [String: Game] = [:]
        private var next = 0

        init(now: Date) {
            self.now = now
            seed()
        }

        var lobbyList: [Lobby] { order.compactMap { lobbies[$0] } }

        // MARK: Calls

        func handle(_ call: DemoCall) throws -> Data {
            lock.lock()
            defer { lock.unlock() }
            if lobbies[call.contextId] != nil { return try lobbyCall(call) }
            if games[call.contextId] != nil { return try gameCall(call) }
            throw DemoContractError("unknown context")
        }

        private func lobbyCall(_ call: DemoCall) throws -> Data {
            guard var lobby = lobbies[call.contextId] else { return DemoReply.null }
            defer { lobbies[call.contextId] = lobby }
            switch call.method {
            case "register_player":
                return try DemoReply.json(BattleshipsDemo.me)
            case "get_matches":
                return try DemoReply.json(lobby.matches)
            case "get_players":
                return try DemoReply.json(lobby.players)
            case "get_history":
                return try DemoReply.json(lobby.history)
            case "get_player_stats":
                let key = (call.string("player") ?? BattleshipsDemo.me).lowercased()
                let wins = lobby.history.filter { $0.winner == key }.count
                let losses = lobby.history.filter { $0.loser == key }.count
                return try DemoReply.json(
                    PlayerStatsView(wins: UInt64(wins), losses: UInt64(losses), gamesPlayed: UInt64(wins + losses)))
            case "create_match":
                let opponent = (call.string("player2") ?? "").lowercased()
                guard let entry = lobby.players.first(where: { $0.player == opponent }) else {
                    throw DemoContractError("player2 is not a valid hex key")
                }
                next += 1
                let matchId = DemoIds.hex("match:new:\(next)")
                lobby.matches.append(
                    MatchSummary(
                        matchId: matchId, player1: BattleshipsDemo.me, player2: opponent, player2Account: entry.account,
                        status: .pending, createdMs: ms(Date())))
                return try DemoReply.json(matchId)
            case "set_match_context_id":
                guard let matchId = call.string("match_id"), let contextId = call.string("context_id"),
                    let index = lobby.matches.firstIndex(where: { $0.matchId == matchId })
                else { return DemoReply.null }
                lobby.matches[index].contextId = contextId
                var rng = SeededRandom(seed: matchId)
                games[contextId] = Game(
                    lobbyContextId: call.contextId, matchId: matchId, opponent: lobby.matches[index].player2,
                    enemy: FleetLayout.random(using: &rng).cells, turn: BattleshipsDemo.me)
                return DemoReply.null
            default:
                return DemoReply.null
            }
        }

        private func gameCall(_ call: DemoCall) throws -> Data {
            guard var game = games[call.contextId] else { return DemoReply.null }
            defer { games[call.contextId] = game }
            tick(&game)
            let me = BattleshipsDemo.me
            switch call.method {
            case "get_match_state":
                return try DemoReply.json(
                    MatchStateView(
                        standing: game.standing, committed: game.committed, endedBy: game.endedBy, loser: game.loser,
                        revealed: game.revealed, auditFailed: [], winner: game.winner))
            case "get_shots":
                return try DemoReply.json(ShotsView(size: UInt32(BoardGeometry.size), shots: game.shots))
            case "get_incoming_shots":
                return try DemoReply.json(ShotsView(size: UInt32(BoardGeometry.size), shots: game.incoming))
            case "get_current_turn":
                guard let turn = game.turn, game.standing == "playing" else { return DemoReply.null }
                return try DemoReply.json(turn)
            case "commit_board":
                if !game.committed.contains(me) { game.committed.append(me) }
                if game.committed.count < 2 {
                    game.opponentCommitsAt = Date().addingTimeInterval(7)
                } else {
                    activate(game)
                }
                return DemoReply.null
            case "propose_shot":
                guard game.standing == "playing" else { throw DemoContractError("match finished") }
                guard game.turn == me else { throw DemoContractError("not your turn") }
                let cell = Coordinate(call.int("x") ?? -1, call.int("y") ?? -1)
                guard cell.isOnBoard else { throw DemoContractError("out of bounds") }
                guard game.shots[cell.index] == Cell.empty else { throw DemoContractError("already shot") }
                let hit = game.enemy[cell.index] == Cell.ship
                game.shots[cell.index] = hit ? Cell.hit : Cell.miss
                let remaining = game.enemy.indices.contains { game.enemy[$0] == Cell.ship && game.shots[$0] != Cell.hit }
                if !remaining {
                    finish(&game, winner: me, loser: game.opponent)
                } else {
                    game.turn = game.opponent
                    game.opponentFiresAt = Date().addingTimeInterval(4)
                }
                return DemoReply.null
            case "reveal_board":
                if !game.revealed.contains(me) { game.revealed.append(me) }
                if !game.revealed.contains(game.opponent) { game.revealed.append(game.opponent) }
                return DemoReply.null
            default:
                return DemoReply.null
            }
        }

        /// The opponent's side, played on the clock: deploying, then firing back.
        private func tick(_ game: inout Game) {
            let me = BattleshipsDemo.me
            if let due = game.opponentCommitsAt, due <= Date() {
                game.opponentCommitsAt = nil
                if !game.committed.contains(game.opponent) { game.committed.append(game.opponent) }
                activate(game)
            }
            guard let due = game.opponentFiresAt, due <= Date(), game.standing == "playing" else { return }
            game.opponentFiresAt = nil
            let mine = boards.load(owner: me, matchId: game.matchId)?.cells ?? BattleshipsDemo.empty
            let open = Coordinate.all.filter { game.incoming[$0.index] == Cell.empty }
            var rng = SeededRandom(seed: "\(game.matchId):\(open.count)")
            let ships = open.filter { mine[$0.index] == Cell.ship }
            let pickShip = !ships.isEmpty && Int.random(in: 0..<3, using: &rng) == 0
            guard let target = (pickShip ? ships : open).randomElement(using: &rng) else { return }
            game.incoming[target.index] = mine[target.index] == Cell.ship ? Cell.hit : Cell.miss
            game.turn = me
        }

        private func activate(_ game: Game) {
            guard var lobby = lobbies[game.lobbyContextId],
                let index = lobby.matches.firstIndex(where: { $0.matchId == game.matchId })
            else { return }
            lobby.matches[index].status = .active
            lobbies[game.lobbyContextId] = lobby
        }

        private func finish(_ game: inout Game, winner: String, loser: String) {
            game.standing = "won"
            game.winner = winner
            game.loser = loser
            game.endedBy = "sunk"
            game.turn = nil
            guard var lobby = lobbies[game.lobbyContextId] else { return }
            if let index = lobby.matches.firstIndex(where: { $0.matchId == game.matchId }) {
                lobby.matches[index].status = .finished
                lobby.matches[index].winner = winner
            }
            lobby.history.append(MatchRecord(matchId: game.matchId, winner: winner, loser: loser, finishedMs: ms(Date())))
            lobbies[game.lobbyContextId] = lobby
        }

        // MARK: Seed

        private func ms(_ date: Date) -> UInt64 { UInt64(date.timeIntervalSince1970 * 1000) }
        private func ago(_ seconds: TimeInterval) -> UInt64 { ms(now.addingTimeInterval(-seconds)) }

        private func seed() {
            let hour: TimeInterval = 3600
            let day: TimeInterval = 86400
            let me = BattleshipsDemo.me

            // Anchor Bay Regulars: the lobby the tour opens (sorts first).
            var anchor = lobby("Anchor Bay Regulars", members: 7, people: ["Ines", "Tomas", "Priya", "Jonah", "Mila", "Rafael"])
            addMidGame(to: &anchor, opponent: "Ines", created: ago(38 * 60))
            addGame(to: &anchor, opponent: "Tomas", meFirst: false, created: ago(1 * day + 3 * hour), state: .theirTurn)
            addGame(to: &anchor, opponent: "Priya", meFirst: true, created: ago(2 * day + 5 * hour), state: .won)
            addGame(to: &anchor, opponent: "Jonah", meFirst: false, created: ago(3 * day + 2 * hour), state: .lost)
            addGame(to: &anchor, opponent: "Ines", meFirst: true, created: ago(5 * day + 7 * hour), state: .won)
            anchor.matches.append(
                MatchSummary(
                    matchId: DemoIds.hex("match:mila-rafael"), player1: player("Mila"), player2: player("Rafael"),
                    player2Account: accountOf("Rafael"), status: .active, contextId: DemoIds.hex("ctx:mila-rafael"),
                    createdMs: ago(2 * hour)))
            for (winner, loser, seconds) in [
                ("Mila", "Jonah", 4 * day), (me, "Mila", 8 * day), ("Priya", "Tomas", 6 * day), ("Rafael", me, 9 * day),
                ("Rafael", "Priya", 10 * day), (me, "Tomas", 12 * day), ("Ines", me, 14 * day),
            ] as [(String, String, TimeInterval)] {
                anchor.history.append(
                    MatchRecord(
                        matchId: DemoIds.hex("record:\(winner):\(loser):\(seconds)"), winner: key(winner), loser: key(loser),
                        finishedMs: ago(seconds)))
            }
            add(anchor)

            var friday = lobby("Friday Night Fleet", members: 4, people: ["Jonah", "Mila", "Theo"])
            addGame(to: &friday, opponent: "Theo", meFirst: true, created: ago(4 * day), state: .won)
            addGame(to: &friday, opponent: "Mila", meFirst: false, created: ago(11 * day), state: .lost)
            add(friday)

            var harbour = lobby(
                "Harbour Office League", members: 12, people: ["Priya", "Theo", "Nadia", "Oskar", "Lena", "Sam"])
            addGame(to: &harbour, opponent: "Nadia", meFirst: false, created: ago(6 * hour), state: .myTurn)
            addGame(to: &harbour, opponent: "Oskar", meFirst: true, created: ago(9 * day), state: .won)
            add(harbour)

            var night = lobby("Night Watch", members: 3, people: ["Rafael", "Lena"])
            addGame(to: &night, opponent: "Lena", meFirst: true, created: ago(16 * day), state: .lost)
            add(night)
        }

        /// "me" or a person's name, as a player key.
        private func key(_ who: String) -> String { who == BattleshipsDemo.me ? who : player(who) }

        private func lobby(_ name: String, members: Int, people: [String]) -> Lobby {
            Lobby(
                name: name, namespaceId: DemoIds.hex("lobby:\(name)"), contextId: DemoIds.hex("lobby-context:\(name)"),
                memberCount: members,
                players: [PlayerEntry(account: BattleshipsDemo.account, player: BattleshipsDemo.me)]
                    + people.map { PlayerEntry(account: accountOf($0), player: player($0)) },
                matches: [], history: [])
        }

        private func add(_ lobby: Lobby) {
            lobbies[lobby.contextId] = lobby
            order.append(lobby.contextId)
        }

        enum Seeded { case won, lost, myTurn, theirTurn }

        /// A match from a random but legal pair of fleets, played to `state`.
        private func addGame(to lobby: inout Lobby, opponent name: String, meFirst: Bool, created: UInt64, state: Seeded) {
            let me = BattleshipsDemo.me
            let opponent = player(name)
            let matchId = DemoIds.hex("match:\(lobby.name):\(name):\(created)")
            let contextId = DemoIds.hex("context:\(matchId)")
            var rng = SeededRandom(seed: matchId)
            let myLayout = FleetLayout.random(using: &rng)
            let enemy = FleetLayout.random(using: &rng).cells
            let board = try! StoredBoard.sealing(myLayout, salt: (0..<16).map { _ in UInt8.random(in: 0...255, using: &rng) })
            _ = boards.save(board, owner: me, matchId: matchId)

            var game = Game(lobbyContextId: lobby.contextId, matchId: matchId, opponent: opponent, enemy: enemy)
            game.committed = [me, opponent]
            let finished = state == .won || state == .lost
            let myHits = state == .won ? Fleet.cellCount : (finished ? 11 : 7)
            let theirHits = state == .lost ? Fleet.cellCount : (finished ? 9 : 6)
            game.shots = Self.volley(on: enemy, hits: myHits, misses: finished ? 19 : 13, rng: &rng)
            game.incoming = Self.volley(on: board.cells, hits: theirHits, misses: finished ? 21 : 13, rng: &rng)
            var summary = MatchSummary(
                matchId: matchId, player1: meFirst ? me : opponent, player2: meFirst ? opponent : me,
                player2Account: meFirst ? accountOf(name) : BattleshipsDemo.account, status: .active, contextId: contextId,
                createdMs: created)
            switch state {
            case .won, .lost:
                game.standing = "won"
                game.winner = state == .won ? me : opponent
                game.loser = state == .won ? opponent : me
                game.endedBy = "sunk"
                game.revealed = [me, opponent]
                summary.status = .finished
                summary.winner = game.winner
            case .myTurn:
                game.turn = me
            case .theirTurn:
                game.turn = opponent
            }
            lobby.matches.append(summary)
            games[contextId] = game
        }

        /// `hits` shots on ship squares and `misses` on open water.
        private static func volley(on cells: [UInt8], hits: Int, misses: Int, rng: inout SeededRandom) -> [UInt8] {
            var out = BattleshipsDemo.empty
            let ships = cells.indices.filter { cells[$0] == Cell.ship }.shuffled(using: &rng)
            let water = cells.indices.filter { cells[$0] != Cell.ship }.shuffled(using: &rng)
            for index in ships.prefix(hits) { out[index] = Cell.hit }
            for index in water.prefix(misses) { out[index] = Cell.miss }
            return out
        }

        /// The match the tour fights: late in the game against Ines, your turn, four of her five
        /// ships sunk and her destroyer hit once (G6, with a miss at F6), so H6 wins it.
        private func addMidGame(to lobby: inout Lobby, opponent name: String, created: UInt64) {
            let me = BattleshipsDemo.me
            let opponent = player(name)
            let matchId = DemoIds.hex("match:midgame:\(name)")
            let contextId = DemoIds.hex("context:\(matchId)")

            var theirs = FleetLayout()
            theirs.place(0, at: Coordinate(1, 1), horizontal: true)  // carrier B2-F2
            theirs.place(1, at: Coordinate(9, 2), horizontal: false)  // battleship J3-J6
            theirs.place(2, at: Coordinate(2, 4), horizontal: false)  // cruiser C5-C7
            theirs.place(3, at: Coordinate(4, 8), horizontal: true)  // submarine E9-G9
            theirs.place(4, at: Coordinate(6, 5), horizontal: true)  // destroyer G6-H6
            assert(theirs.isComplete, "demo: the opponent's fleet must be legal")
            let enemy = theirs.cells

            var mine = FleetLayout()
            mine.place(0, at: Coordinate(0, 0), horizontal: false)  // carrier A1-A5
            mine.place(1, at: Coordinate(2, 8), horizontal: true)  // battleship C9-F9
            mine.place(2, at: Coordinate(7, 1), horizontal: true)  // cruiser H2-J2
            mine.place(3, at: Coordinate(4, 3), horizontal: false)  // submarine E4-E6
            mine.place(4, at: Coordinate(7, 5), horizontal: false)  // destroyer H6-H7
            assert(mine.isComplete, "demo: your fleet must be legal")
            var rng = SeededRandom(seed: matchId)
            let board = try! StoredBoard.sealing(mine, salt: (0..<16).map { _ in UInt8.random(in: 0...255, using: &rng) })
            _ = boards.save(board, owner: me, matchId: matchId)

            var shots = BattleshipsDemo.empty
            for (index, ship) in theirs.ships.enumerated() {
                guard let ship else { continue }
                if index == 4 {
                    shots[Coordinate(6, 5).index] = Cell.hit
                    shots[Coordinate(5, 5).index] = Cell.miss
                    continue
                }
                for cell in ship.cells { shots[cell.index] = Cell.hit }
                let first = ship.cells[0]
                let last = ship.cells[ship.cells.count - 1]
                let ends =
                    ship.horizontal
                    ? [Coordinate(first.x - 1, first.y), Coordinate(last.x + 1, last.y)]
                    : [Coordinate(first.x, first.y - 1), Coordinate(last.x, last.y + 1)]
                for end in ends where end.isOnBoard { shots[end.index] = Cell.miss }
            }
            for (x, y) in [(0, 7), (4, 4), (7, 2), (5, 7), (8, 8), (1, 9), (6, 3), (3, 6), (7, 9)] {
                shots[Coordinate(x, y).index] = Cell.miss
            }

            var incoming = BattleshipsDemo.empty
            // Their hits: your cruiser and destroyer sunk, two holes in the carrier, one in the battleship.
            for (x, y) in [(7, 1), (8, 1), (9, 1), (7, 5), (7, 6), (0, 1), (0, 2), (3, 8)] {
                incoming[Coordinate(x, y).index] = Cell.hit
            }
            for (x, y) in [
                (6, 1), (7, 0), (7, 2), (7, 4), (7, 7), (6, 6), (1, 2), (0, 5), (2, 2), (3, 4), (5, 2), (9, 4), (8, 6),
                (2, 6), (5, 0), (1, 8), (3, 7), (6, 8), (9, 9), (4, 1), (8, 3), (0, 8), (5, 6),
            ] where board.cells[Coordinate(x, y).index] != Cell.ship {
                incoming[Coordinate(x, y).index] = Cell.miss
            }

            var game = Game(lobbyContextId: lobby.contextId, matchId: matchId, opponent: opponent, enemy: enemy)
            game.shots = shots
            game.incoming = incoming
            game.committed = [me, opponent]
            game.turn = me
            games[contextId] = game
            lobby.matches.append(
                MatchSummary(
                    matchId: matchId, player1: me, player2: opponent, player2Account: accountOf(name), status: .active,
                    contextId: contextId, createdMs: created))
        }
    }
}

/// A deterministic generator (SplitMix64) seeded from a string, so fixtures look the same every run.
struct SeededRandom: RandomNumberGenerator {
    private var state: UInt64

    init(seed: String) {
        var hash: UInt64 = 1469598103934665603
        for byte in seed.utf8 { hash = (hash ^ UInt64(byte)) &* 1099511628211 }
        state = hash
    }

    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}
#endif
