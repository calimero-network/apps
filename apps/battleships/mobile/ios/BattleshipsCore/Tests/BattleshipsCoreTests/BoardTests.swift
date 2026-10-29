import XCTest

@testable import BattleshipsCore

/// The two fleets and salts the vectors below were computed from with the web app's own code
/// (`computeCommitment` in `app/src/lib/board.ts`, run under Node). ALICE is also the contract's
/// `commitment_vector_shared_with_the_client` (crates/game/src/lib.rs). Kotlin `BoardTest`
/// carries the same vectors.
enum Vectors {
    /// `['0,0;1,0', '0,2;1,2;2,2', '0,4;1,4;2,4', '0,6;1,6;2,6;3,6', '0,8;1,8;2,8;3,8;4,8']`
    static var alice: FleetLayout {
        FleetLayout(ships: [
            PlacedShip(length: 5, origin: Coordinate(0, 8), horizontal: true),
            PlacedShip(length: 4, origin: Coordinate(0, 6), horizontal: true),
            PlacedShip(length: 3, origin: Coordinate(0, 2), horizontal: true),
            PlacedShip(length: 3, origin: Coordinate(0, 4), horizontal: true),
            PlacedShip(length: 2, origin: Coordinate(0, 0), horizontal: true),
        ])
    }
    static let aliceSalt = [UInt8](repeating: 0xA5, count: 16)
    static let aliceCommitment = "37188894d025229c47a83365463dbc5e15d7a267aa13ef63f4d963b0d03def4f"

    /// `['9,0;9,1', '7,0;7,1;7,2', '2,3;3,3;4,3', '0,9;1,9;2,9;3,9', '5,5;5,6;5,7;5,8;5,9']`
    static var bob: FleetLayout {
        FleetLayout(ships: [
            PlacedShip(length: 5, origin: Coordinate(5, 5), horizontal: false),
            PlacedShip(length: 4, origin: Coordinate(0, 9), horizontal: true),
            PlacedShip(length: 3, origin: Coordinate(7, 0), horizontal: false),
            PlacedShip(length: 3, origin: Coordinate(2, 3), horizontal: true),
            PlacedShip(length: 2, origin: Coordinate(9, 0), horizontal: false),
        ])
    }
    static let bobSalt = (0..<16).map { UInt8($0) }
    static let bobCommitment = "50338a717d089186053856a715f5d5eecc203a799fa1c4e13dd77d645acd2d84"
}

final class CommitmentTests: XCTestCase {
    func testMatchesTheWebAppAndTheContractForAlice() throws {
        XCTAssertEqual(try Commitment.compute(cells: Vectors.alice.cells, salt: Vectors.aliceSalt), Vectors.aliceCommitment)
    }

    func testMatchesTheWebAppForBob() throws {
        XCTAssertEqual(try Commitment.compute(cells: Vectors.bob.cells, salt: Vectors.bobSalt), Vectors.bobCommitment)
    }

    func testBoardBytesAreBorshOfAVec() {
        XCTAssertEqual(Commitment.boardBytes([1, 0, 0, 1]), [4, 0, 0, 0, 1, 0, 0, 1])
        let full = Commitment.boardBytes(Vectors.alice.cells)
        XCTAssertEqual(Array(full.prefix(4)), [100, 0, 0, 0])
        XCTAssertEqual(full.count, 104)
    }

    func testTheSaltChangesTheCommitment() throws {
        var other = Vectors.aliceSalt
        other[0] = 0xA6
        XCTAssertNotEqual(try Commitment.compute(cells: Vectors.alice.cells, salt: other), Vectors.aliceCommitment)
    }

    func testRefusesASaltThatIsNotSixteenBytes() {
        XCTAssertThrowsError(try Commitment.compute(cells: [0], salt: [1, 2, 3]))
    }

    func testRandomSaltsAreSixteenFreshBytes() {
        let a = Commitment.randomSalt()
        let b = Commitment.randomSalt()
        XCTAssertEqual(a.count, 16)
        XCTAssertNotEqual(a, b)
    }

    func testSealingKeepsTheSaltThatWasHashed() throws {
        let board = try StoredBoard.sealing(Vectors.alice, salt: Vectors.aliceSalt)
        XCTAssertEqual(board.commitment, Vectors.aliceCommitment)
        XCTAssertEqual(board.saltBytes, Vectors.aliceSalt)
        XCTAssertEqual(board.salt, String(repeating: "a5", count: 16))
    }

    func testStoredBoardIsTheWebAppsJSON() throws {
        let board = StoredBoard(cells: [0, 1], salt: "00ff", commitment: "ab", savedAt: 5)
        let json = try XCTUnwrap(String(data: JSONEncoder().encode(board), encoding: .utf8))
        XCTAssertTrue(json.contains("\"cells\":[0,1]"))
        XCTAssertTrue(json.contains("\"salt\":\"00ff\""))
        XCTAssertEqual(InMemoryBoardStore.key(owner: "k", matchId: "m"), "battleships:board:v1:k:m")
    }

    func testHexRoundTrips() {
        XCTAssertEqual(Hex.lower([0, 171, 255]), "00abff")
        XCTAssertEqual(Hex.bytes("00abff"), [0, 171, 255])
        XCTAssertNil(Hex.bytes("abc"))
        XCTAssertNil(Hex.bytes("zz"))
    }
}

final class FleetLayoutTests: XCTestCase {
    func testAFullFleetCoversSeventeenCells() {
        XCTAssertTrue(Vectors.alice.isComplete)
        XCTAssertEqual(Vectors.alice.cells.filter { $0 == Cell.ship }.count, 17)
        XCTAssertEqual(Vectors.alice.cells[0], Cell.ship)
        XCTAssertEqual(Vectors.alice.cells[8 * 10 + 4], Cell.ship)
    }

    func testShipsSlideBackInsteadOfRunningOffTheEdge() {
        var layout = FleetLayout()
        XCTAssertTrue(layout.place(0, at: Coordinate(8, 0), horizontal: true))
        XCTAssertEqual(layout.ships[0]?.origin, Coordinate(5, 0))
    }

    func testShipsMayNotTouchEvenAtACorner() {
        var layout = FleetLayout()
        XCTAssertTrue(layout.place(4, at: Coordinate(0, 0), horizontal: true))
        XCTAssertFalse(layout.place(3, at: Coordinate(2, 1), horizontal: true), "diagonal neighbour")
        XCTAssertFalse(layout.place(3, at: Coordinate(0, 1), horizontal: true), "side neighbour")
        XCTAssertFalse(layout.place(3, at: Coordinate(1, 0), horizontal: false), "overlap")
        XCTAssertTrue(layout.place(3, at: Coordinate(0, 2), horizontal: true))
    }

    func testRotatingTurnsAboutTheBowOrTheTappedSquare() {
        var layout = FleetLayout()
        layout.place(1, at: Coordinate(2, 2), horizontal: true)
        XCTAssertTrue(layout.rotate(1))
        XCTAssertEqual(layout.ships[1], PlacedShip(length: 4, origin: Coordinate(2, 2), horizontal: false))
        // Near the bottom edge: slides up to fit.
        var low = FleetLayout()
        low.place(0, at: Coordinate(0, 9), horizontal: true)
        XCTAssertTrue(low.rotate(0, pivot: Coordinate(2, 9)))
        XCTAssertEqual(low.ships[0]?.horizontal, false)
        XCTAssertTrue(low.ships[0]!.cells.allSatisfy(\.isOnBoard))
    }

    func testARotationWithNoRoomChangesNothing() {
        var layout = FleetLayout()
        layout.place(0, at: Coordinate(0, 0), horizontal: true)
        layout.place(1, at: Coordinate(0, 2), horizontal: true)
        let before = layout
        XCTAssertFalse(layout.rotate(0))
        XCTAssertEqual(layout, before)
    }

    func testRandomFleetsAreLegal() {
        for _ in 0..<50 {
            let layout = FleetLayout.random()
            XCTAssertTrue(layout.isComplete)
            XCTAssertEqual(BoardReading.ships(in: layout.cells).map(\.count).sorted(), [2, 3, 3, 4, 5])
        }
    }
}

final class BoardReadingTests: XCTestCase {
    private func grid(_ marks: [(Int, Int, UInt8)]) -> [UInt8] {
        var out = [UInt8](repeating: Cell.empty, count: 100)
        for (x, y, v) in marks { out[y * 10 + x] = v }
        return out
    }

    func testAnswersComeFromTheBoard() {
        XCTAssertTrue(BoardReading.isHit(cells: Vectors.alice.cells, at: Coordinate(1, 0)))
        XCTAssertFalse(BoardReading.isHit(cells: Vectors.alice.cells, at: Coordinate(2, 0)))
        XCTAssertFalse(BoardReading.isHit(cells: Vectors.alice.cells, at: Coordinate(10, 0)))
    }

    func testOverlayShowsWhatWasAnswered() {
        let incoming = grid([(0, 0, Cell.hit), (5, 5, Cell.miss), (2, 0, Cell.pending)])
        let own = BoardReading.overlay(cells: Vectors.alice.cells, incoming: incoming)
        XCTAssertEqual(own[0], Cell.hit)
        XCTAssertEqual(own[1], Cell.ship)
        XCTAssertEqual(own[55], Cell.miss)
        XCTAssertEqual(own[2], Cell.pending)
    }

    func testAnEnemyShipIsSunkOnceBothEndsAreClosed() {
        let open = grid([(3, 3, Cell.hit), (4, 3, Cell.hit), (2, 3, Cell.miss)])
        XCTAssertTrue(BoardReading.sunkEnemyShips(shots: open).isEmpty)
        let closed = grid([(3, 3, Cell.hit), (4, 3, Cell.hit), (2, 3, Cell.miss), (5, 3, Cell.miss)])
        XCTAssertEqual(BoardReading.sunkEnemyShips(shots: closed), [[Coordinate(3, 3), Coordinate(4, 3)]])
        let edge = grid([(0, 0, Cell.hit), (0, 1, Cell.hit), (0, 2, Cell.miss)])
        XCTAssertEqual(BoardReading.sunkEnemyShips(shots: edge).count, 1)
        let carrier = grid((0..<5).map { ($0, 7, Cell.hit) })
        XCTAssertEqual(BoardReading.sunkEnemyShips(shots: carrier).count, 1)
    }

    func testYourShipIsSunkWhenEverySquareIsHit() {
        let incoming = grid([(0, 0, Cell.hit), (1, 0, Cell.hit), (0, 2, Cell.hit)])
        XCTAssertEqual(BoardReading.sunkOwnShips(cells: Vectors.alice.cells, incoming: incoming), [[Coordinate(0, 0), Coordinate(1, 0)]])
    }

    func testCoordinatesReadLikeTheBoard() {
        XCTAssertEqual(Coordinate(0, 0).label, "A1")
        XCTAssertEqual(Coordinate(9, 9).label, "J10")
    }
}
