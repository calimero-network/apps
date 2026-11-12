import Foundation
import MeroKit

/// One match, from placing the fleet to the audited result. (Kotlin `MatchModel`; the web app's
/// `pages/match`.)
///
/// The board and its salt never leave the device before the reveal: placing seals the fleet
/// (``StoredBoard/sealing(_:salt:)``), keeps it in the ``BoardStore`` FIRST, then files only the
/// commitment. Every shot at you is answered from that board, automatically, and when the answers
/// end the match the board is revealed for every reader to audit.
@MainActor
public final class MatchModel: ObservableObject {
    public enum Stage: Equatable, Sendable {
        /// The first read has not come back (or the context is still syncing to the relay).
        case loading
        /// Lay out the fleet and deploy it.
        case placing
        /// Deployed; the opponent has not.
        case waiting
        /// Both fleets are down: take turns.
        case battle
        /// The answers ended it.
        case finished
        /// You deployed on another device: this one cannot answer shots or reveal.
        case boardMissing
        case failed(String)
    }

    public enum Outcome: Equatable, Sendable {
        case won
        case lost
        /// The answers ended it; the reveals are still being audited.
        case auditing
        /// Both players' reveals failed the audit.
        case void
    }

    @Published public private(set) var stage: Stage = .loading
    @Published public private(set) var state: MatchStateView?
    /// Your shots at the opponent, one ``Cell`` byte per square.
    @Published public private(set) var shots: [UInt8] = Array(repeating: Cell.empty, count: BoardGeometry.cellCount)
    /// Your waters: your fleet with the opponent's answered shots over it.
    @Published public private(set) var ownBoard: [UInt8] = []
    @Published public private(set) var turn: String?
    @Published public private(set) var busy = false
    @Published public private(set) var syncing = false
    @Published public var notice: String?

    // Placement
    @Published public private(set) var layout = FleetLayout()
    @Published public var selectedShip: Int? = 0
    @Published public var horizontal = true

    // Aiming
    @Published public private(set) var aim: Coordinate?

    public let ref: MatchRef
    public let backend: any BattleshipsBackend
    public let store: any BoardStore
    /// The account the match names you by (`registerPlayer`'s answer).
    public let me: String
    private let game: BattleshipsClient
    private var answeredShot: UInt32?
    private var revealing = false
    private var refreshing = false
    private var refreshAgain = false

    public init(ref: MatchRef, me: String, backend: any BattleshipsBackend, store: any BoardStore) {
        self.ref = ref
        self.me = me.lowercased()
        self.backend = backend
        self.store = store
        self.game = BattleshipsClient(backend: backend, app: ref.appId)
    }

    // MARK: Reading

    public var stored: StoredBoard? { store.load(owner: me, matchId: ref.matchId) }

    public var isMyTurn: Bool {
        stage == .battle && turn?.lowercased() == me && state?.pendingShot == nil
    }

    /// Whose move the battle is waiting on, in words.
    public var turnText: String {
        if let pending = state?.pendingShot {
            return pending.target.lowercased() == me ? "Answering their shot…" : "Waiting for their answer…"
        }
        return isMyTurn ? "Your turn. Pick a square." : "Their turn."
    }

    public var outcome: Outcome? {
        guard let state, stage == .finished else { return nil }
        switch state.standing {
        case "won": return state.winner?.lowercased() == me ? .won : .lost
        case "void": return .void
        default: return .auditing
        }
    }

    /// Why it ended, from the contract's `ended_by` and audit.
    public var endedText: String? {
        guard let state else { return nil }
        if state.auditFailed.contains(where: { $0.lowercased() == me }) {
            return "Your revealed board did not match your answers."
        }
        if state.auditFailed.contains(where: { $0.lowercased() != me }) {
            return "Their revealed board did not match their answers, so the match is yours."
        }
        switch state.endedBy {
        case "sunk": return state.loser?.lowercased() == me ? "Your fleet was sunk." : "Every ship of theirs is sunk."
        case "impossible_misses": return "Too many misses to be true: a fleet was hidden."
        default: return nil
        }
    }

    public var enemySunk: [[Coordinate]] { BoardReading.sunkEnemyShips(shots: shots) }

    public var ownSunk: [[Coordinate]] {
        guard let stored else { return [] }
        return BoardReading.sunkOwnShips(cells: stored.cells, incoming: ownBoard)
    }

    // MARK: Loading and live updates

    /// Read the match and act on it: answer a shot aimed at you, reveal when it is over.
    public func refresh() async {
        if refreshing {
            refreshAgain = true
            return
        }
        refreshing = true
        defer { refreshing = false }
        repeat {
            refreshAgain = false
            await readOnce()
        } while refreshAgain
    }

    private func readOnce() async {
        let matchId = ref.matchId
        let current: MatchStateView
        let mine: ShotsView
        let incoming: ShotsView
        do {
            current = try await game.getMatchState(matchId: matchId).decoded(as: MatchStateView.self)
            mine = try await game.getShots(matchId: matchId).decoded(as: ShotsView.self)
            incoming = try await game.getIncomingShots(matchId: matchId).decoded(as: ShotsView.self)
        } catch {
            if state == nil {
                // A match the node has not applied yet (just created on another node).
                syncing = true
                if case .failed = stage {} else { stage = .loading }
            } else {
                notice = ErrorText.describe(error, fallback: "Couldn't refresh the match.")
            }
            return
        }
        syncing = false
        var latest = current
        shots = mine.shots
        turn = try? await game.getCurrentTurn(matchId: matchId)
        let committed = latest.committed.contains { $0.lowercased() == me }
        guard committed else {
            state = latest
            stage = latest.standing == "playing" ? .placing : .finished
            return
        }
        guard let board = stored else {
            state = latest
            ownBoard = BoardReading.overlay(
                cells: Array(repeating: Cell.empty, count: BoardGeometry.cellCount), incoming: incoming.shots)
            stage = latest.standing == "playing" ? .boardMissing : .finished
            return
        }
        var answers = incoming.shots
        if await answerPendingShot(latest, cells: board.cells) {
            latest = (try? await game.getMatchState(matchId: matchId).decoded(as: MatchStateView.self)) ?? latest
            answers = (try? await game.getIncomingShots(matchId: matchId).decoded(as: ShotsView.self))?.shots ?? answers
            turn = try? await game.getCurrentTurn(matchId: matchId)
        }
        if await revealIfDue(latest, board: board) {
            latest = (try? await game.getMatchState(matchId: matchId).decoded(as: MatchStateView.self)) ?? latest
        }
        state = latest
        ownBoard = BoardReading.overlay(cells: board.cells, incoming: answers)
        if latest.standing != "playing" {
            stage = .finished
            aim = nil
        } else if latest.committed.count < 2 {
            stage = .waiting
        } else {
            stage = .battle
        }
    }

    /// Answer the pending shot from the board on this device, if it is yours to answer. Automatic,
    /// as on the web: the answer is your signed statement, and the reveal is replayed against it.
    private func answerPendingShot(_ state: MatchStateView, cells: [UInt8]) async -> Bool {
        guard state.standing == "playing", let shot = state.pendingShot, shot.target.lowercased() == me,
            answeredShot != shot.shotId
        else { return false }
        answeredShot = shot.shotId
        do {
            try await game.acknowledgeShot(
                matchId: ref.matchId, shotId: shot.shotId,
                hit: BoardReading.isHit(cells: cells, at: Coordinate(Int(shot.x), Int(shot.y))))
            return true
        } catch {
            answeredShot = nil
            return false
        }
    }

    /// Open the board once the answers have ended the match and the contract has not seen yours.
    private func revealIfDue(_ state: MatchStateView, board: StoredBoard) async -> Bool {
        guard state.standing != "playing", !state.revealed.contains(where: { $0.lowercased() == me }),
            !state.auditFailed.contains(where: { $0.lowercased() == me }), !revealing
        else { return false }
        revealing = true
        defer { revealing = false }
        do {
            try await game.revealBoard(
                matchId: ref.matchId, boardBytes: Data(Commitment.boardBytes(board.cells)), salt: Data(board.saltBytes))
            return true
        } catch {
            return false
        }
    }

    /// Keep the match fresh while it is on screen: the lobby instance's events, and a poll
    /// either way, so a dropped event never stalls a turn.
    public func live() async {
        await withTaskGroup(of: Void.self) { group in
            if backend.canSubscribe {
                let stream = backend.events(contextId: ref.appId)
                group.addTask { [weak self] in
                    do {
                        for try await _ in stream { await self?.refresh() }
                    } catch {}
                }
            }
            group.addTask { [weak self] in
                while !Task.isCancelled {
                    await pause(Battleships.pollInterval)
                    if Task.isCancelled { return }
                    await self?.refresh()
                }
            }
        }
    }

    // MARK: Placing

    /// A tap on the placement grid: on one of your ships, turn it; on open water, put the
    /// selected ship there (moving it, when it is already placed).
    @discardableResult
    public func tapPlacement(_ cell: Coordinate) -> Bool {
        if let index = layout.shipIndex(at: cell) {
            var next = layout
            guard next.rotate(index, pivot: cell) else {
                notice = "No room to turn the \(Fleet.classes[index].name.lowercased()) there."
                return false
            }
            layout = next
            return true
        }
        guard let index = selectedShip ?? layout.nextUnplaced else { return false }
        var next = layout
        guard next.place(index, at: cell, horizontal: horizontal) else {
            notice = "Ships can't overlap or touch, not even at a corner."
            return false
        }
        layout = next
        selectedShip = layout.nextUnplaced
        return true
    }

    public func select(_ index: Int) {
        selectedShip = index
    }

    public func remove(_ index: Int) {
        layout.remove(index)
        selectedShip = index
    }

    public func shuffle() {
        layout = FleetLayout.random()
        selectedShip = nil
    }

    public func clearLayout() {
        layout.clear()
        selectedShip = 0
    }

    public func toggleOrientation() {
        horizontal.toggle()
    }

    /// Seal the fleet, keep it on this device, and file the commitment.
    public func deploy() async -> Bool {
        guard layout.isComplete else {
            notice = "Place all five ships first."
            return false
        }
        guard !busy else { return false }
        busy = true
        defer { busy = false }
        do {
            let board = try StoredBoard.sealing(layout)
            guard store.save(board, owner: me, matchId: ref.matchId) else {
                notice = "This device refused to keep your board, so it could not answer shots."
                return false
            }
            try await game.commitBoard(matchId: ref.matchId, commitment: board.commitment)
            await refresh()
            return true
        } catch {
            notice = ErrorText.describe(error, fallback: "Couldn't deploy your fleet. Try again.")
            return false
        }
    }

    // MARK: Firing

    /// A tap on the enemy grid: aim there, or fire when it is already aimed there.
    public func tapTarget(_ cell: Coordinate) async {
        guard isMyTurn, cell.isOnBoard, shots[cell.index] == Cell.empty else { return }
        if aim == cell {
            await fire()
        } else {
            aim = cell
        }
    }

    public func fire() async {
        guard let target = aim, isMyTurn, !busy else { return }
        busy = true
        defer { busy = false }
        do {
            try await game.proposeShot(matchId: ref.matchId, x: UInt8(target.x), y: UInt8(target.y))
            aim = nil
            await refresh()
        } catch {
            if ErrorText.isFinished(error) {
                await refresh()
            } else if ErrorText.isOpponentNotReady(error) {
                notice = "Your opponent has not deployed their fleet yet."
            } else {
                notice = ErrorText.describe(error, fallback: "Couldn't fire. Try again.")
            }
        }
    }

    public func clearAim() {
        aim = nil
    }
}
