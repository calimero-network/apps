import Foundation
import MeroChessGenerated
import MeroKit

/// A promotion the player has started and not yet chosen a piece for.
public struct PendingPromotion: Equatable, Sendable, Identifiable {
    public var id: String { from + to }

    public let from: String
    public let to: String
    public let kinds: [Character]
    public let color: PieceColor
}

/// One table, kept current: the port of the web app's `useChessTable` + `ChessBoard` state.
///
/// Everything the screen shows comes from ONE `table()` read: the contract derives position,
/// legal moves, status and result from the same replay of the move list, so reading them
/// separately could paint a board from one moment beside a result from another. There is no
/// optimistic update anywhere: a move is a move once the contract has taken it.
@MainActor
public final class TableModel: ObservableObject {
    public let contextId: String
    public let namespaceId: String?

    @Published public private(set) var view: TableView?
    @Published public private(set) var past: [GameSummary] = []
    @Published public private(set) var error: String?
    @Published public private(set) var busy = false
    @Published public private(set) var selected: String?
    @Published public private(set) var promotion: PendingPromotion?
    /// Bumped each time a move the player made is accepted (the screen plays a haptic on it).
    @Published public private(set) var movesPlayed = 0
    /// The name the player sits and announces under.
    @Published public var name: String {
        didSet { names.name = name }
    }

    private let backend: any MeroAppBackend
    private let client: MeroChessClient
    private let names: NameStore
    private var reading = false
    private var pastSignature: String?
    private var boardKey: String?

    public init(backend: any MeroAppBackend, contextId: String, namespaceId: String?, names: NameStore) {
        self.backend = backend
        self.contextId = contextId
        self.namespaceId = namespaceId
        self.names = names
        self.name = names.name
        self.client = MeroChessClient.bound(backend, contextId: contextId)
    }

    // MARK: Derived

    public var squares: [Piece?] { view.map { Board.squares(fen: $0.fen) } ?? Array(repeating: nil, count: 64) }

    /// A player sees the board from their own side, a spectator from White's. Not simply "my
    /// colour is black": one person holding both chairs would see the board spin after every move.
    public var flipped: Bool {
        guard let view else { return false }
        return view.black.member == view.me && view.white.member != view.me
    }

    /// The board takes taps only on your move (the contract also sends no legal moves otherwise).
    public var interactive: Bool { (view?.myTurn ?? false) && !busy }

    public var movable: Set<String> { interactive ? Board.movable(view?.legalMoves ?? []) : [] }

    public var targets: Set<String> {
        guard let selected, let view else { return [] }
        return Board.targets(view.legalMoves, from: selected)
    }

    public var lastMove: (from: String, to: String)? {
        guard let uci = view?.moves.last?.uci, uci.count >= 4 else { return nil }
        return (String(uci.prefix(2)), String(uci.dropFirst(2).prefix(2)))
    }

    /// The side whose king is lit red.
    public var inCheck: PieceColor? {
        guard let view, view.check else { return nil }
        return PieceColor(rawValue: view.sideToMove)
    }

    public var isSeated: Bool { !(view?.myColor.isEmpty ?? true) }

    /// The opponent has a draw offer standing in this position.
    public var offerFromOpponent: Bool {
        guard let view else { return false }
        return !view.drawOfferFrom.isEmpty && view.drawOfferFrom != view.me
    }

    /// Your own offer is standing.
    public var myOfferStands: Bool {
        guard let view else { return false }
        return !view.me.isEmpty && view.drawOfferFrom == view.me
    }

    /// Playing, as opposed to watching or waiting for the game to start.
    public var isPlaying: Bool { view?.status == "inProgress" && isSeated }

    public var isFinished: Bool { view?.status == "finished" }

    /// Standing up is offered only while the contract allows it: before the table's first game
    /// is under way.
    public func canStand(_ color: PieceColor) -> Bool {
        guard let view else { return false }
        let seat = color == .white ? view.white : view.black
        return seat.member == view.me && !seat.member.isEmpty && view.moves.isEmpty && view.game == 0
            && view.status != "finished"
    }

    public func seat(_ color: PieceColor) -> SeatView? {
        guard let view else { return nil }
        return color == .white ? view.white : view.black
    }

    // MARK: Reading

    /// Re-read the table. A read already in flight is not duplicated: a burst of events (a move
    /// and the ending it caused) would otherwise fire one read each.
    public func refresh() async {
        guard !reading else { return }
        reading = true
        defer { reading = false }
        do {
            let next = try await client.table(now: nowMillis()).named
            apply(next)
            error = nil
        } catch is CancellationError {
        } catch {
            self.error = ChessText.error(error)
        }
        await refreshPastIfNeeded()
    }

    private func apply(_ next: TableView) {
        // A selection cannot survive the position changing under it: the selected piece may just
        // have been captured.
        let key = "\(next.fen)|\(next.myTurn)"
        if key != boardKey {
            selected = nil
            promotion = nil
            boardKey = key
        }
        view = next
    }

    /// The record of finished games changes a handful of times an evening, so it is re-read only
    /// when the table says it could have: a game ending, or a rematch starting.
    private func refreshPastIfNeeded() async {
        guard let view else { return }
        let signature = "\(view.gamesPlayed):\(view.result)"
        guard signature != pastSignature else { return }
        if let rows = try? await client.history() {
            past = rows
            pastSignature = signature
        }
    }

    /// Announce, then keep the table current until the task is cancelled: every live event is a
    /// nudge to re-read (nothing is read out of its payload), and a poll covers presence and any
    /// event missed while the stream reconnects.
    public func run() async {
        await announce()
        await refresh()
        await withTaskGroup(of: Void.self) { group in
            group.addTask { [weak self] in await self?.listen() }
            group.addTask { [weak self] in await self?.poll() }
        }
    }

    private func listen() async {
        do {
            for try await _ in backend.events(contextId: contextId) {
                await refresh()
            }
        } catch {
            // The stream ended; the poll keeps the table current.
        }
    }

    private func poll() async {
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: UInt64(ChessConstants.pollSeconds * 1_000_000_000))
            if Task.isCancelled { return }
            await refresh()
        }
    }

    /// Presence: so a spectator is visible and a player's dot is honest before they have done
    /// anything. Best-effort, as on the web.
    public func announce() async {
        _ = try? await client.join(name: displayName, now: nowMillis())
    }

    private var displayName: String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? ChessConstants.defaultName : String(trimmed.prefix(32))
    }

    // MARK: The board

    /// A tap on a square: pick a piece up, put it down, or move it.
    /// Returns the UCI of a move sent, if the tap sent one.
    @discardableResult
    public func tap(_ square: String) async -> String? {
        guard interactive, let view else { return nil }
        if let from = selected, targets.contains(square) {
            let kinds = Board.promotions(view.legalMoves, from: from, to: square)
            if !kinds.isEmpty {
                // Ask rather than assume a queen: underpromotion is rare and occasionally the only
                // move that wins.
                let mover = Board.squareIndex(from).flatMap { squares[$0] }
                promotion = PendingPromotion(from: from, to: square, kinds: kinds, color: mover?.color ?? .white)
                return nil
            }
            let uci = from + square
            await play(uci)
            return uci
        }
        // Tapping the selected piece puts it down; tapping another of yours picks that one up.
        selected = selected == square || !movable.contains(square) ? nil : square
        return nil
    }

    /// Send the promotion with `kind`. The pending promotion is cleared at once, before the call
    /// goes out, so the picker can close in the same frame.
    @discardableResult
    public func choosePromotion(_ kind: Character) -> Task<Void, Never>? {
        guard let pending = promotion else { return nil }
        promotion = nil
        return Task { await self.play(pending.from + pending.to + String(kind)) }
    }

    public func promote(_ kind: Character) async {
        await choosePromotion(kind)?.value
    }

    public func cancelPromotion() {
        promotion = nil
        selected = nil
    }

    private func play(_ uci: String) async {
        selected = nil
        if await call({ _ = try await $0.play(uci: uci, now: nowMillis()) }) { movesPlayed += 1 }
    }

    // MARK: Everything that is not a move

    public func sit(_ color: PieceColor) async {
        await call { [displayName] in try await $0.sit(seat: color.rawValue, name: displayName, now: nowMillis()) }
    }

    public func stand() async { await call { try await $0.stand(now: nowMillis()) } }
    public func resign() async { await call { try await $0.resign(now: nowMillis()) } }
    public func offerDraw() async { await call { try await $0.offerDraw(now: nowMillis()) } }
    public func acceptDraw() async { await call { try await $0.acceptDraw(now: nowMillis()) } }
    public func declineDraw() async { await call { try await $0.declineDraw(now: nowMillis()) } }
    public func claimDraw() async { await call { try await $0.claimDraw(now: nowMillis()) } }
    public func rematch() async { await call { _ = try await $0.rematch(now: nowMillis()) } }

    public func dismissError() { error = nil }

    /// Run one contract call, then re-read either way: a refused call still moves the player's
    /// picture forward (it is not your turn *because* someone else moved).
    @discardableResult
    private func call(_ body: @escaping (MeroChessClient) async throws -> Void) async -> Bool {
        busy = true
        error = nil
        var ok = true
        do {
            try await body(client)
        } catch {
            self.error = ChessText.error(error)
            ok = false
        }
        busy = false
        reading = false
        let kept = error
        await refresh()
        if !ok { error = kept }
        return ok
    }

    // MARK: Inviting

    /// A link that admits someone to this table's org (club) and opens this table.
    public func inviteLink() async throws -> String {
        guard let namespaceId else { throw ChessError.noNamespace }
        let signed = try await backend.createInvitation(namespaceId: namespaceId)
        return try ChessInvitation(invitation: signed, namespaceId: namespaceId, contextId: contextId).link()
    }
}

public enum ChessError: Error, LocalizedError, Equatable {
    case noNamespace
    case noApplication
    case notAnInvitation
    case noRelay

    public var errorDescription: String? {
        switch self {
        case .noNamespace: return "This table's club is not known on this device yet. Open it from Tables and try again."
        case .noApplication: return "Mero Chess is still being looked up in the app registry. Try again in a moment."
        case .notAnInvitation: return "That is not a Mero Chess invitation link."
        case .noRelay: return "You're not connected to your cluster. Sign in again, or join a table from an invitation link."
        }
    }
}
