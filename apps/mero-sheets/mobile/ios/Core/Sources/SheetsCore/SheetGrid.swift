import Foundation

/// A cell position on a sheet (0-based).
public struct GridPos: Hashable, Sendable {
    public let row: Int
    public let col: Int

    public init(row: Int, col: Int) {
        self.row = row
        self.col = col
    }

    /// `B3`.
    public var label: String { A1.cell(row: row, col: col) }
}

/// One cell as the grid draws it.
public struct GridCell: Equatable, Sendable {
    public let pos: GridPos
    public let rowId: String
    public let colId: String
    /// Display form: a formula with positions and sheet names.
    public let raw: String
    /// As the contract computed it.
    public let computed: String
    public let format: String
    /// The computed value through the format.
    public let text: String
    public let look: CellLook
    public let lastEditor: String
    public let lastEditedAt: UInt64

    public var isFormula: Bool { raw.hasPrefix("=") }
    public var isNumber: Bool { CellFormat.number(computed) != nil }
}

/// Everything the grid needs to draw one sheet: its cells by position, sizes,
/// frozen panes and how far to draw.
public struct SheetGrid: Equatable, Sendable {
    /// The web grid's metrics (`spreadsheet/viewport.ts`, `SpreadsheetGrid.tsx`), in points.
    public static let defaultColWidth = 100.0
    public static let defaultRowHeight = 24.0
    public static let headerHeight = 26.0
    public static let rowHeaderWidth = 52.0

    public let sheetId: String
    public let order: SheetOrder
    public let cells: [GridPos: GridCell]
    public let frozenRows: Int
    public let frozenCols: Int
    /// Rows and columns drawn (the content plus room to scroll past it).
    public let rowCount: Int
    public let colCount: Int
    /// Running offsets: `colOffsets[c]` is the left edge of column `c`; the last entry is the total width.
    public let colOffsets: [Double]
    public let rowOffsets: [Double]
    /// Cells with open comment threads.
    public let commented: Set<GridPos>

    public init(
        sheetId: String, order: SheetOrder, cells: [GridPos: GridCell], sizes: [AxisSize], frozenRows: Int, frozenCols: Int,
        commented: Set<GridPos> = [], extra: (rows: Int, cols: Int) = (30, 6)
    ) {
        self.sheetId = sheetId
        self.order = order
        self.cells = cells
        self.commented = commented
        let maxRow = cells.keys.map(\.row).max() ?? -1
        let maxCol = cells.keys.map(\.col).max() ?? -1
        self.frozenRows = min(frozenRows, order.rows.count)
        self.frozenCols = min(frozenCols, order.cols.count)
        rowCount = min(order.rows.count, max(maxRow + 1 + extra.rows, frozenRows + 1, 60))
        colCount = min(order.cols.count, max(maxCol + 1 + extra.cols, frozenCols + 1, 12))
        var colSize: [Int: Double] = [:]
        var rowSize: [Int: Double] = [:]
        for s in sizes where s.size > 0 {
            if s.axis == "col", let c = order.cols.position(of: s.id) { colSize[c] = Double(s.size) }
            if s.axis == "row", let r = order.rows.position(of: s.id) { rowSize[r] = Double(s.size) }
        }
        var x = [0.0]
        for c in 0..<colCount { x.append(x[c] + (colSize[c] ?? Self.defaultColWidth)) }
        var y = [0.0]
        for r in 0..<rowCount { y.append(y[r] + (rowSize[r] ?? Self.defaultRowHeight)) }
        colOffsets = x
        rowOffsets = y
    }

    public var totalWidth: Double { colOffsets.last ?? 0 }
    public var totalHeight: Double { rowOffsets.last ?? 0 }
    public func width(_ col: Int) -> Double { colOffsets[col + 1] - colOffsets[col] }
    public func height(_ row: Int) -> Double { rowOffsets[row + 1] - rowOffsets[row] }
    /// Width of the frozen columns, height of the frozen rows.
    public var frozenWidth: Double { colOffsets[frozenCols] }
    public var frozenHeight: Double { rowOffsets[frozenRows] }

    /// The column whose span holds `x` (content coordinates), clamped.
    public func col(at x: Double) -> Int { Self.index(in: colOffsets, at: x) }
    public func row(at y: Double) -> Int { Self.index(in: rowOffsets, at: y) }

    static func index(in offsets: [Double], at v: Double) -> Int {
        var lo = 0
        var hi = offsets.count - 2
        guard hi >= 0 else { return 0 }
        if v <= 0 { return 0 }
        if v >= offsets[hi + 1] { return hi }
        while lo < hi {
            let mid = (lo + hi + 1) / 2
            if offsets[mid] <= v { lo = mid } else { hi = mid - 1 }
        }
        return lo
    }

    /// The range of rows/columns that intersect `[from, to)` (content coordinates).
    public func rows(from: Double, to: Double) -> ClosedRange<Int> { row(at: from)...row(at: max(from, to - 0.001)) }
    public func cols(from: Double, to: Double) -> ClosedRange<Int> { col(at: from)...col(at: max(from, to - 0.001)) }
}
