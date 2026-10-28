import MeroChessGenerated
import XCTest

@testable import ChessCore

final class BoardTests: XCTestCase {
    func testStartingPositionReadsOffTheFen() {
        let squares = Board.squares(fen: Fixtures.start)
        XCTAssertEqual(squares.compactMap { $0 }.count, 32)
        XCTAssertEqual(squares[Board.squareIndex("e1")!], Piece(color: .white, kind: "k"))
        XCTAssertEqual(squares[Board.squareIndex("d8")!], Piece(color: .black, kind: "q"))
        XCTAssertNil(squares[Board.squareIndex("e4")!])
        XCTAssertEqual(squares[Board.squareIndex("g8")!]?.assetName, "bN")
    }

    func testSquareNamesRoundTrip() {
        for index in 0..<64 { XCTAssertEqual(Board.squareIndex(Board.squareName(index)), index) }
        XCTAssertNil(Board.squareIndex("i9"))
        XCTAssertTrue(Board.isDark(Board.squareIndex("a1")!))
        XCTAssertFalse(Board.isDark(Board.squareIndex("h1")!))
    }

    func testDisplayOrderPutsTheOwnSideAtTheBottom() {
        let white = Board.displayOrder(flipped: false)
        XCTAssertEqual(Board.squareName(white.first!), "a8")
        XCTAssertEqual(Board.squareName(white.last!), "h1")
        let black = Board.displayOrder(flipped: true)
        XCTAssertEqual(Board.squareName(black.first!), "h1")
        XCTAssertEqual(Board.squareName(black.last!), "a8")
    }

    func testTargetsAndMovableComeFromTheLegalMoveList() {
        XCTAssertEqual(Board.targets(Fixtures.openingMoves, from: "e2"), ["e3", "e4"])
        XCTAssertEqual(Board.targets(Fixtures.openingMoves, from: "g1"), ["f3", "h3"])
        XCTAssertTrue(Board.movable(Fixtures.openingMoves).contains("b1"))
        XCTAssertFalse(Board.movable(Fixtures.openingMoves).contains("e1"))
    }

    func testPromotionsAreOfferedQueenFirst() {
        let legal = ["e7e8n", "e7e8b", "e7e8q", "e7e8r", "e7d8q"]
        XCTAssertEqual(Board.promotions(legal, from: "e7", to: "e8"), Array("qrbn"))
        XCTAssertEqual(Board.promotions(["e2e4"], from: "e2", to: "e4"), [])
    }

    func testMovePairsNumberTheScoresheet() {
        let rows = Board.movePairs(["e4", "e5", "Nf3"])
        XCTAssertEqual(rows, [MovePair(number: 1, white: "e4", black: "e5"), MovePair(number: 2, white: "Nf3", black: "")])
    }

    func testMaterialCountsCapturesAndLead() {
        // White is missing a pawn, Black a knight and a pawn: White is three up.
        let squares = Board.squares(fen: "r1bqkbnr/ppp1pppp/8/8/8/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1")
        let material = Board.material(squares)
        XCTAssertEqual(material.captured[.white], ["n", "p"])
        XCTAssertEqual(material.captured[.black], ["p"])
        XCTAssertEqual(material.lead[.white], 3)
        XCTAssertEqual(material.lead[.black], 0)
    }

    func testStatusSentences() {
        XCTAssertEqual(ChessText.status(Fixtures.table()), "White (Ana) to move.")
        XCTAssertEqual(ChessText.status(Fixtures.table(check: true)), "White (Ana) is in check.")
        XCTAssertEqual(
            ChessText.status(Fixtures.table(status: "finished", result: "0-1", reason: "checkmate")),
            "Ben wins — checkmate.")
        XCTAssertEqual(
            ChessText.status(Fixtures.table(status: "finished", result: "1/2-1/2", reason: "agreement")),
            "Draw — by agreement.")
        XCTAssertEqual(ChessText.status(Fixtures.table(status: "awaitingPlayers")), "Waiting for both players to sit down.")
        XCTAssertEqual(ChessText.claimLabel("threefold"), "Claim draw (threefold repetition)")
        XCTAssertNil(ChessText.claimLabel(""))
        XCTAssertEqual(ChessText.meta(Fixtures.table()), "Game 1 of 1 · your move")
    }

    func testAnUnnamedSeatReadsAsAShortId() {
        let view = Fixtures.table(black: Fixtures.seat("black", Fixtures.them, "")).named
        XCTAssertEqual(view.black.name, "cdcdcd…cdcd")
        XCTAssertEqual(view.white.name, "Ana")
    }
}
