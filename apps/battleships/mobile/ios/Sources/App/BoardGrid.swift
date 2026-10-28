import BattleshipsCore
import SwiftUI

/// How one square looks: a flat fill and, for a shot, a marker symbol.
struct SquareLook: Equatable {
    var fill: Color = Palette.water
    var symbol: String?
    var tint: Color = .white
    var symbolScale: CGFloat = 0.5
    var spoken = "water"

    static let water = SquareLook()
    static let ship = SquareLook(fill: Palette.ship, spoken: "ship")
    static let selectedShip = SquareLook(fill: Palette.lime, spoken: "selected ship")
    static let hit = SquareLook(fill: Palette.hit, symbol: "xmark", tint: .white, symbolScale: 0.46, spoken: "hit")
    static let sunk = SquareLook(fill: Palette.sunk, symbol: "xmark", tint: .white, symbolScale: 0.46, spoken: "sunk")
    static let miss = SquareLook(fill: Palette.water, symbol: "circle.fill", tint: Palette.miss, symbolScale: 0.24, spoken: "miss")
    static let pending = SquareLook(
        fill: Palette.pendingSoft, symbol: "hourglass", tint: Palette.pending, symbolScale: 0.46, spoken: "waiting for an answer")
    static let aim = SquareLook(fill: Palette.lime, symbol: "scope", tint: Palette.ink, symbolScale: 0.56, spoken: "aimed")
}

/// The 10x10 board: column letters across the top, row numbers down the side, flat cells.
struct BoardGrid: View {
    let looks: [SquareLook]
    var compact = false
    var onTap: ((Coordinate) -> Void)?

    var body: some View {
        let gap: CGFloat = compact ? 2 : 3
        let label: CGFloat = compact ? 14 : 18
        VStack(spacing: gap) {
            HStack(spacing: gap) {
                Color.clear.frame(width: label, height: label)
                ForEach(0..<BoardGeometry.size, id: \.self) { x in
                    Text(Coordinate.columnLabel(x))
                        .font(.system(size: compact ? 9 : 11, weight: .semibold))
                        .foregroundStyle(Palette.muted)
                        .frame(maxWidth: .infinity)
                }
            }
            ForEach(0..<BoardGeometry.size, id: \.self) { y in
                HStack(spacing: gap) {
                    Text("\(y + 1)")
                        .font(.system(size: compact ? 9 : 11, weight: .semibold))
                        .foregroundStyle(Palette.muted)
                        .frame(width: label)
                    ForEach(0..<BoardGeometry.size, id: \.self) { x in
                        square(Coordinate(x, y))
                    }
                }
            }
        }
    }

    private func square(_ cell: Coordinate) -> some View {
        let look = cell.index < looks.count ? looks[cell.index] : .water
        return GeometryReader { proxy in
            ZStack {
                RoundedRectangle(cornerRadius: compact ? 2.5 : 4, style: .continuous).fill(look.fill)
                if let symbol = look.symbol {
                    Image(systemName: symbol)
                        .font(.system(size: proxy.size.width * look.symbolScale, weight: .bold))
                        .foregroundStyle(look.tint)
                }
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .frame(maxWidth: .infinity)
        .contentShape(Rectangle())
        .onTapGesture { onTap?(cell) }
        .accessibilityElement()
        .accessibilityLabel("\(cell.label), \(look.spoken)")
        .accessibilityAddTraits(onTap == nil ? [] : .isButton)
    }
}

/// The grids a match shows, as looks.
enum BoardLooks {
    /// Placement: your ships, the selected one in lime.
    static func placement(_ layout: FleetLayout, selected: Int?) -> [SquareLook] {
        var looks = Array(repeating: SquareLook.water, count: BoardGeometry.cellCount)
        for (index, ship) in layout.ships.enumerated() {
            guard let ship else { continue }
            for cell in ship.cells { looks[cell.index] = index == selected ? .selectedShip : .ship }
        }
        return looks
    }

    /// Their waters: your shots, with the ships you have certainly sunk and where you are aiming.
    static func enemy(shots: [UInt8], sunk: [[Coordinate]], aim: Coordinate?) -> [SquareLook] {
        let sunkCells = Set(sunk.flatMap { $0 })
        return Coordinate.all.map { cell in
            if cell == aim { return .aim }
            let value = cell.index < shots.count ? shots[cell.index] : Cell.empty
            switch value {
            case Cell.hit: return sunkCells.contains(cell) ? .sunk : .hit
            case Cell.miss: return .miss
            case Cell.pending: return .pending
            default: return .water
            }
        }
    }

    /// Your fleet: your ships, with the opponent's answered shots over them.
    static func own(board: [UInt8], sunk: [[Coordinate]]) -> [SquareLook] {
        let sunkCells = Set(sunk.flatMap { $0 })
        return Coordinate.all.map { cell in
            let value = cell.index < board.count ? board[cell.index] : Cell.empty
            switch value {
            case Cell.ship: return .ship
            case Cell.hit: return sunkCells.contains(cell) ? .sunk : .hit
            case Cell.miss: return .miss
            case Cell.pending: return .pending
            default: return .water
            }
        }
    }
}
