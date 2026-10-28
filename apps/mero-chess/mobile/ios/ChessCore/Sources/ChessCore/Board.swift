import Foundation

/// A side of the board.
public enum PieceColor: String, Sendable, CaseIterable {
    case white
    case black

    public var opposite: PieceColor { self == .white ? .black : .white }
    public var label: String { self == .white ? "White" : "Black" }
}

/// One piece on a square. `kind` is the lowercase FEN letter: p n b r q k.
public struct Piece: Equatable, Hashable, Sendable {
    public let color: PieceColor
    public let kind: Character

    public init(color: PieceColor, kind: Character) {
        self.color = color
        self.kind = kind
    }

    /// The artwork's name in the asset catalog: `wK`, `bN`, …
    public var assetName: String { "\(color == .white ? "w" : "b")\(kind.uppercased())" }

    /// "white knight": the accessible name of a square's occupant.
    public var spokenName: String { "\(color.rawValue) \(Board.pieceNames[kind] ?? "piece")" }
}

/// The board as the app draws it, read from the contract's answers.
///
/// There is no chess engine here, on purpose (see `docs/trust-model.md` and the web app's
/// `utils/board.ts`, which this mirrors): the contract's `table()` returns the position as a FEN
/// AND every legal move in it, so the board only ever offers moves the node will accept. Everything
/// below is reading those two values, never deciding a rule.
public enum Board {
    public static let files: [Character] = Array("abcdefgh")

    static let pieceNames: [Character: String] = [
        "k": "king", "q": "queen", "r": "rook", "b": "bishop", "n": "knight", "p": "pawn",
    ]

    /// The 64 squares of a FEN's placement field, index `rank * 8 + file` (a1 = 0, h8 = 63).
    public static func squares(fen: String) -> [Piece?] {
        var squares = [Piece?](repeating: nil, count: 64)
        let placement = fen.split(separator: " ").first ?? ""
        let ranks = placement.split(separator: "/", omittingEmptySubsequences: false)
        for (row, rank) in ranks.prefix(8).enumerated() {
            let rankIndex = 7 - row
            var file = 0
            for char in rank {
                if let skip = char.wholeNumberValue {
                    file += skip
                    continue
                }
                guard file < 8 else { break }
                let kind = Character(char.lowercased())
                guard pieceNames[kind] != nil else { file += 1; continue }
                squares[rankIndex * 8 + file] = Piece(color: char.isUppercase ? .white : .black, kind: kind)
                file += 1
            }
        }
        return squares
    }

    /// `e4` for an index.
    public static func squareName(_ index: Int) -> String {
        "\(files[index % 8])\(index / 8 + 1)"
    }

    /// The index of `e4`, or nil.
    public static func squareIndex(_ name: String) -> Int? {
        let chars = Array(name)
        guard chars.count == 2, let file = files.firstIndex(of: chars[0]), let rank = chars[1].wholeNumberValue,
            (1...8).contains(rank)
        else { return nil }
        return (rank - 1) * 8 + file
    }

    /// a1 is dark.
    public static func isDark(_ index: Int) -> Bool { (index % 8 + index / 8) % 2 == 0 }

    /// The squares top-left to bottom-right as the player sees them: rank 8 first from White's
    /// side, mirrored from Black's.
    public static func displayOrder(flipped: Bool) -> [Int] {
        var order: [Int] = []
        for rank in stride(from: 7, through: 0, by: -1) {
            for file in 0..<8 { order.append(rank * 8 + file) }
        }
        return flipped ? order.reversed() : order
    }

    /// The origin squares that have at least one legal move.
    public static func movable(_ legalMoves: [String]) -> Set<String> {
        Set(legalMoves.map { String($0.prefix(2)) })
    }

    /// Where a piece on `from` may legally go.
    public static func targets(_ legalMoves: [String], from: String) -> Set<String> {
        Set(legalMoves.filter { $0.hasPrefix(from) }.map { String($0.dropFirst(2).prefix(2)) })
    }

    /// The promotion pieces offered for `from`→`to`, queen first. Empty when it is not a promotion.
    public static func promotions(_ legalMoves: [String], from: String, to: String) -> [Character] {
        let found = Set(legalMoves.filter { $0.count == 5 && $0.hasPrefix(from + to) }.compactMap(\.last))
        return Array("qrbn").filter { found.contains($0) }
    }

    /// Scoresheet rows: move number, White's SAN, Black's SAN.
    public static func movePairs(_ san: [String]) -> [MovePair] {
        stride(from: 0, to: san.count, by: 2).map { i in
            MovePair(number: i / 2 + 1, white: san[i], black: i + 1 < san.count ? san[i + 1] : "")
        }
    }

    // MARK: Material

    private static let startCount: [Character: Int] = ["q": 1, "r": 2, "b": 2, "n": 2, "p": 8]
    private static let value: [Character: Int] = ["q": 9, "r": 5, "b": 3, "n": 3, "p": 1]
    private static let captureOrder: [Character] = Array("qrbnp")

    /// Who has taken what, read off the board (display only, as every chess app shows it).
    public static func material(_ squares: [Piece?]) -> Material {
        var onBoard: [PieceColor: [Character: Int]] = [.white: [:], .black: [:]]
        for piece in squares.compactMap({ $0 }) { onBoard[piece.color, default: [:]][piece.kind, default: 0] += 1 }
        func missing(_ color: PieceColor) -> [Character] {
            captureOrder.flatMap { kind in
                Array(repeating: kind, count: max(0, (startCount[kind] ?? 0) - (onBoard[color]?[kind] ?? 0)))
            }
        }
        func points(_ color: PieceColor) -> Int {
            (onBoard[color] ?? [:]).reduce(0) { $0 + (value[$1.key] ?? 0) * $1.value }
        }
        let diff = points(.white) - points(.black)
        return Material(
            captured: [.white: missing(.black), .black: missing(.white)],
            lead: [.white: max(0, diff), .black: max(0, -diff)])
    }
}

public struct MovePair: Equatable, Sendable {
    public let number: Int
    public let white: String
    public let black: String
}

public struct Material: Equatable, Sendable {
    /// The kinds each side has TAKEN from the other, heaviest first.
    public let captured: [PieceColor: [Character]]
    /// Points ahead, or 0 for the side behind.
    public let lead: [PieceColor: Int]
}
