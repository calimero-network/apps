import Foundation
import MeroChessGenerated
import MeroKit

/// The app's fixed values, shared with the web app and the contract's bundle.
public enum ChessConstants {
    /// The bundle's package id (`logic/Cargo.toml`), which is also the invitation link slug.
    public static let packageName = "com.calimero.mero-chess"
    /// What a new table is called when the field is left empty (the web app's only title).
    public static let defaultTitle = "Chess table"
    /// What the contract files a player under when they gave no name.
    public static let defaultName = "Guest"
    /// How often an open table is re-read even when no event arrived: presence expires (nobody
    /// emits "I went away") and an event can be missed while the stream reconnects. The web app's
    /// value.
    public static let pollSeconds: Double = 6
}

/// Every sentence the screens show that is worked out from the contract's answers. Same words as
/// the web app (`utils/board.ts`, `TablePanel.tsx`).
public enum ChessText {
    /// The sentence under the board: whose move it is, or how the game ended.
    public static func status(_ view: TableView) -> String {
        if view.status == "awaitingPlayers" { return "Waiting for both players to sit down." }
        if view.status == "finished" {
            let how = reasons[view.reason] ?? view.reason
            if view.result == "1/2-1/2" { return "Draw — \(how)." }
            let winner = view.result == "1-0" ? view.white.name : view.result == "0-1" ? view.black.name : ""
            if !winner.isEmpty { return "\(winner) wins — \(how)." }
            return "Game over — \(how)."
        }
        let white = view.sideToMove == "white"
        let mover = white ? view.white.name : view.black.name
        let side = white ? "White" : "Black"
        return view.check ? "\(side) (\(mover)) is in check." : "\(side) (\(mover)) to move."
    }

    /// "Game 2 of 3 · 1-0 · your move".
    public static func meta(_ view: TableView) -> String {
        var parts = ["Game \(view.game + 1) of \(view.gamesPlayed)"]
        if view.result != "*" { parts.append(view.result) }
        if view.myTurn { parts.append("your move") }
        return parts.joined(separator: " · ")
    }

    /// The claim-a-draw button's label, or nil when there is nothing to claim.
    public static func claimLabel(_ claimable: String) -> String? {
        switch claimable {
        case "threefold": return "Claim draw (threefold repetition)"
        case "fiftyMove": return "Claim draw (fifty-move rule)"
        default: return nil
        }
    }

    /// `1/2-1/2` as a person writes it.
    public static func score(_ result: String) -> String { result.replacingOccurrences(of: "1/2", with: "½") }

    /// How a past game ended, for the record.
    public static func recordReason(_ reason: String) -> String { recordWords[reason] ?? reason }

    /// A readable short form of an id nobody named.
    public static func shortId(_ id: String) -> String {
        id.count > 12 ? "\(id.prefix(6))…\(id.suffix(4))" : id
    }

    static let reasons: [String: String] = [
        "checkmate": "checkmate",
        "stalemate": "stalemate",
        "insufficientMaterial": "neither side can mate",
        "fivefold": "fivefold repetition",
        "seventyFiveMove": "the seventy-five-move rule",
        "resignation": "resignation",
        "agreement": "by agreement",
        "threefold": "threefold repetition",
        "fiftyMove": "the fifty-move rule",
        "equivocation": "two different moves played at once",
    ]

    static let recordWords: [String: String] = [
        "checkmate": "checkmate",
        "stalemate": "stalemate",
        "insufficientMaterial": "dead position",
        "fivefold": "fivefold repetition",
        "seventyFiveMove": "seventy-five-move rule",
        "resignation": "resignation",
        "agreement": "agreement",
        "threefold": "threefold repetition",
        "fiftyMove": "fifty-move rule",
        "equivocation": "two moves at once",
    ]

    /// An error as one sentence. A contract refusal is already written for a player ("it is not
    /// your move"), so it is shown as it came; only the transport's wrapping is taken off.
    public static func error(_ error: Error) -> String {
        if let text = cluster(error) { return text }
        if let described = (error as? LocalizedError)?.errorDescription, !described.isEmpty { return described }
        let text = String(describing: error)
        return text.isEmpty ? "Something went wrong talking to your cluster." : text
    }
}

extension ChessText {
    /// The Calimero 1.0 node's typed errors, in words. A contract refusal (`AppError`) keeps its
    /// own words.
    static func cluster(_ error: Error) -> String? {
        switch error {
        case is ConfirmCancelled: return "The passkey prompt was cancelled."
        case is LoginRequired: return "Your session ended. Sign in again."
        case is ReleaseDeadlineError:
            return "A newer node release needs approval before anything can change. Review it under Tables."
        case is ConsentStale: return "That approval request is out of date. Try again."
        case is NotFound: return "This table isn't available to you (yet)."
        case let error as UnavailableError:
            return "Your cluster is unavailable right now (\(error.reason)). Try again shortly."
        case let error as AppError:
            let text = error.message.isEmpty ? error.appCode : error.message
            return text.isEmpty ? nil : text
        default: return nil
        }
    }
}

extension TableView {
    /// The view with every occupied seat named: the name given at the table, else a short id, so
    /// no sentence reads "White () to move".
    public var named: TableView {
        var copy = self
        copy.white = Self.named(white)
        copy.black = Self.named(black)
        return copy
    }

    private static func named(_ seat: SeatView) -> SeatView {
        guard !seat.member.isEmpty, seat.name.trimmingCharacters(in: .whitespaces).isEmpty else { return seat }
        var copy = seat
        copy.name = ChessText.shortId(seat.member)
        return copy
    }
}
