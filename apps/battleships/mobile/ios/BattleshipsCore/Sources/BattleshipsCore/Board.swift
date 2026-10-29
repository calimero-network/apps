import Foundation

/// The contract's `board::Cell` bytes, pinned here (as the web app's `lib/board.ts` pins them) so
/// a renumbering upstream fails the commitment test instead of committing to a board the reveal
/// can never match. (Kotlin `Cell`.)
public enum Cell {
    public static let empty: UInt8 = 0
    public static let ship: UInt8 = 1
    public static let hit: UInt8 = 2
    public static let miss: UInt8 = 3
    public static let pending: UInt8 = 4
}

/// The board's fixed shape. (Kotlin `BoardGeometry`.)
public enum BoardGeometry {
    public static let size = 10
    public static let cellCount = size * size
}

/// A square on the board: `x` is the column (A–J), `y` the row (1–10). (Kotlin `Coordinate`.)
public struct Coordinate: Hashable, Sendable, Comparable {
    public let x: Int
    public let y: Int

    public init(_ x: Int, _ y: Int) {
        self.x = x
        self.y = y
    }

    /// Row-major index into a 100-cell grid.
    public var index: Int { y * BoardGeometry.size + x }

    public var isOnBoard: Bool {
        x >= 0 && y >= 0 && x < BoardGeometry.size && y < BoardGeometry.size
    }

    /// `A1`…`J10`, as the board's edges label it.
    public var label: String { "\(Coordinate.columnLabel(x))\(y + 1)" }

    public static func columnLabel(_ x: Int) -> String {
        String(UnicodeScalar(UInt8(65 + x)))
    }

    public static func < (lhs: Coordinate, rhs: Coordinate) -> Bool { lhs.index < rhs.index }

    /// The four orthogonal neighbours, on the board or not.
    var orthogonal: [Coordinate] {
        [Coordinate(x + 1, y), Coordinate(x - 1, y), Coordinate(x, y + 1), Coordinate(x, y - 1)]
    }

    /// All eight neighbours, on the board or not.
    var around: [Coordinate] {
        (-1...1).flatMap { dy in (-1...1).map { dx in Coordinate(x + dx, y + dy) } }
            .filter { $0 != self }
    }

    public static let all: [Coordinate] =
        (0..<BoardGeometry.size).flatMap { y in (0..<BoardGeometry.size).map { x in Coordinate(x, y) } }
}

/// One kind of ship in the fleet. (Kotlin `ShipClass`.)
public struct ShipClass: Hashable, Sendable {
    public let name: String
    public let length: Int
}

/// The fleet the contract audits at the reveal: 1x5, 1x4, 2x3, 1x2 (`SHIP_TARGETS` on the web).
public enum Fleet {
    public static let classes: [ShipClass] = [
        ShipClass(name: "Carrier", length: 5),
        ShipClass(name: "Battleship", length: 4),
        ShipClass(name: "Cruiser", length: 3),
        ShipClass(name: "Submarine", length: 3),
        ShipClass(name: "Destroyer", length: 2),
    ]

    /// Cells a full fleet covers (17).
    public static let cellCount = classes.reduce(0) { $0 + $1.length }
}

/// A ship on the board: where its bow is and which way it points. (Kotlin `PlacedShip`.)
public struct PlacedShip: Hashable, Sendable {
    public let length: Int
    public let origin: Coordinate
    public let horizontal: Bool

    public init(length: Int, origin: Coordinate, horizontal: Bool) {
        self.length = length
        self.origin = origin
        self.horizontal = horizontal
    }

    public var cells: [Coordinate] {
        (0..<length).map { horizontal ? Coordinate(origin.x + $0, origin.y) : Coordinate(origin.x, origin.y + $0) }
    }
}

/// The fleet being laid out before it is committed: one slot per ``Fleet/classes`` entry, placed
/// or not. Ships stay straight, on the board, apart from each other and never touching, not even
/// at a corner, which is what the contract's audit accepts. (Kotlin `FleetLayout`.)
public struct FleetLayout: Equatable, Sendable {
    public private(set) var ships: [PlacedShip?]

    public init() {
        ships = Array(repeating: nil, count: Fleet.classes.count)
    }

    public init(ships: [PlacedShip?]) {
        precondition(ships.count == Fleet.classes.count)
        self.ships = ships
    }

    public var isComplete: Bool { ships.allSatisfy { $0 != nil } }
    public var placedCount: Int { ships.compactMap { $0 }.count }
    public var nextUnplaced: Int? { ships.firstIndex { $0 == nil } }

    /// The slot whose ship covers `cell`.
    public func shipIndex(at cell: Coordinate) -> Int? {
        ships.firstIndex { $0?.cells.contains(cell) == true }
    }

    /// Whether `ship` fits: on the board, and clear of every other ship by at least one square.
    public func fits(_ ship: PlacedShip, ignoring index: Int? = nil) -> Bool {
        guard ship.cells.allSatisfy(\.isOnBoard) else { return false }
        var taken = Set<Coordinate>()
        for (i, other) in ships.enumerated() where i != index {
            if let other { taken.formUnion(other.cells) }
        }
        return ship.cells.allSatisfy { cell in
            !taken.contains(cell) && !cell.around.contains { taken.contains($0) }
        }
    }

    /// Place slot `index` with its bow at `cell` (or as near as it can go without running off the
    /// edge). `false`, and nothing changes, when it does not fit there.
    @discardableResult
    public mutating func place(_ index: Int, at cell: Coordinate, horizontal: Bool) -> Bool {
        let length = Fleet.classes[index].length
        let maxStart = BoardGeometry.size - length
        let origin =
            horizontal
            ? Coordinate(min(cell.x, maxStart), cell.y)
            : Coordinate(cell.x, min(cell.y, maxStart))
        let ship = PlacedShip(length: length, origin: origin, horizontal: horizontal)
        guard fits(ship, ignoring: index) else { return false }
        ships[index] = ship
        return true
    }

    /// Turn slot `index` a quarter, about its bow, or about the square that was tapped when the
    /// bow has no room. `false` when neither fits.
    @discardableResult
    public mutating func rotate(_ index: Int, pivot: Coordinate? = nil) -> Bool {
        guard let ship = ships[index] else { return false }
        let turned = !ship.horizontal
        for origin in [ship.origin, pivot].compactMap({ $0 }) {
            let candidate = PlacedShip(length: ship.length, origin: origin, horizontal: turned)
            if fits(candidate, ignoring: index) {
                ships[index] = candidate
                return true
            }
        }
        // Slide it back along the new axis so a ship near the edge can still turn.
        var copy = self
        if copy.place(index, at: pivot ?? ship.origin, horizontal: turned) {
            self = copy
            return true
        }
        return false
    }

    public mutating func remove(_ index: Int) {
        ships[index] = nil
    }

    public mutating func clear() {
        ships = Array(repeating: nil, count: Fleet.classes.count)
    }

    /// The 100 pristine cells (water or ship), row-major: what is committed and revealed.
    public var cells: [UInt8] {
        var out = [UInt8](repeating: Cell.empty, count: BoardGeometry.cellCount)
        for ship in ships.compactMap({ $0 }) {
            for cell in ship.cells { out[cell.index] = Cell.ship }
        }
        return out
    }

    /// A legal fleet laid out at random, biggest ships first.
    public static func random<G: RandomNumberGenerator>(using generator: inout G) -> FleetLayout {
        while true {
            var layout = FleetLayout()
            var stuck = false
            for index in Fleet.classes.indices {
                var placed = false
                for _ in 0..<200 {
                    let horizontal = Bool.random(using: &generator)
                    let cell = Coordinate(
                        Int.random(in: 0..<BoardGeometry.size, using: &generator),
                        Int.random(in: 0..<BoardGeometry.size, using: &generator))
                    if layout.place(index, at: cell, horizontal: horizontal) {
                        placed = true
                        break
                    }
                }
                if !placed {
                    stuck = true
                    break
                }
            }
            if !stuck { return layout }
        }
    }

    public static func random() -> FleetLayout {
        var generator = SystemRandomNumberGenerator()
        return random(using: &generator)
    }
}

/// Reading the grids the contract returns. (Kotlin `BoardReading`.)
public enum BoardReading {
    /// "Your waters": the pristine cells with the opponent's answered shots laid over them
    /// (`overlayOwnBoard` on the web): a cell shows what was ANSWERED, never what the device would answer.
    public static func overlay(cells: [UInt8], incoming: [UInt8]) -> [UInt8] {
        cells.enumerated().map { index, cell in
            let shot = index < incoming.count ? incoming[index] : Cell.empty
            return shot == Cell.hit || shot == Cell.miss || shot == Cell.pending ? shot : cell
        }
    }

    /// What this device answers to a shot at `cell`: whether a ship is there.
    public static func isHit(cells: [UInt8], at cell: Coordinate) -> Bool {
        cell.isOnBoard && cell.index < cells.count && cells[cell.index] == Cell.ship
    }

    /// The ships in a set of pristine cells, each as its squares. Ships never touch, so every
    /// orthogonally connected run of ship cells is one ship.
    public static func ships(in cells: [UInt8]) -> [[Coordinate]] {
        clusters(in: cells) { $0 == Cell.ship }
    }

    /// The ships of your own fleet the opponent has sunk: every square answered as a hit.
    public static func sunkOwnShips(cells: [UInt8], incoming: [UInt8]) -> [[Coordinate]] {
        ships(in: cells).filter { ship in
            ship.allSatisfy { $0.index < incoming.count && incoming[$0.index] == Cell.hit }
        }
    }

    /// The opponent's ships your shots have certainly sunk. Ships never touch, so a run of hits is
    /// one ship, and it is whole once both squares past its ends are misses or off the board (all
    /// four sides for a single hit), or once it is as long as the longest ship.
    public static func sunkEnemyShips(shots: [UInt8]) -> [[Coordinate]] {
        let longest = Fleet.classes.map(\.length).max() ?? 5
        func closed(_ cell: Coordinate) -> Bool {
            !cell.isOnBoard || shots[cell.index] == Cell.miss
        }
        return clusters(in: shots) { $0 == Cell.hit }.filter { run in
            if run.count >= longest { return true }
            guard let first = run.min(), let last = run.max() else { return false }
            if run.count == 1 { return first.orthogonal.allSatisfy(closed) }
            let horizontal = first.y == last.y
            let before = horizontal ? Coordinate(first.x - 1, first.y) : Coordinate(first.x, first.y - 1)
            let after = horizontal ? Coordinate(last.x + 1, last.y) : Coordinate(last.x, last.y + 1)
            return closed(before) && closed(after)
        }
    }

    /// How many shots a grid holds that have been answered hit or miss.
    public static func count(_ value: UInt8, in grid: [UInt8]) -> Int {
        grid.filter { $0 == value }.count
    }

    private static func clusters(in grid: [UInt8], where matches: (UInt8) -> Bool) -> [[Coordinate]] {
        guard grid.count >= BoardGeometry.cellCount else { return [] }
        var seen = Set<Coordinate>()
        var out: [[Coordinate]] = []
        for start in Coordinate.all where matches(grid[start.index]) && !seen.contains(start) {
            var run: [Coordinate] = []
            var stack = [start]
            seen.insert(start)
            while let cell = stack.popLast() {
                run.append(cell)
                for next in cell.orthogonal
                where next.isOnBoard && !seen.contains(next) && matches(grid[next.index]) {
                    seen.insert(next)
                    stack.append(next)
                }
            }
            out.append(run.sorted())
        }
        return out
    }
}
