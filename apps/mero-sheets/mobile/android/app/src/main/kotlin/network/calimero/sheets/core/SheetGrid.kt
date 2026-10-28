package network.calimero.sheets.core

import network.calimero.sheets.generated.AxisSize

/** A cell position on a sheet (0-based). */
data class GridPos(
    val row: Int,
    val col: Int,
) {
    /** `B3`. */
    val label: String get() = A1.cell(row, col)
}

/** One cell as the grid draws it. */
data class GridCell(
    val pos: GridPos,
    val rowId: String,
    val colId: String,
    /** Display form: a formula with positions and sheet names. */
    val raw: String,
    /** As the contract computed it. */
    val computed: String,
    val format: String,
    /** The computed value through the format. */
    val text: String,
    val look: CellLook,
    val lastEditor: String,
    val lastEditedAt: Long,
) {
    val isFormula: Boolean get() = raw.startsWith("=")
}

/**
 * Everything the grid needs to draw one sheet: its cells by position, sizes, frozen panes and how
 * far to draw.
 */
@Suppress("LongParameterList")
class SheetGrid(
    val sheetId: String,
    val order: SheetOrder,
    val cells: Map<GridPos, GridCell>,
    sizes: List<AxisSize>,
    frozenRows: Int,
    frozenCols: Int,
    /** Cells with open comment threads. */
    val commented: Set<GridPos> = emptySet(),
    extraRows: Int = EXTRA_ROWS,
    extraCols: Int = EXTRA_COLS,
) {
    val frozenRows: Int = minOf(frozenRows, order.rows.count)
    val frozenCols: Int = minOf(frozenCols, order.cols.count)

    /** Rows and columns drawn (the content plus room to scroll past it). */
    val rowCount: Int
    val colCount: Int

    /** Running offsets: `colOffsets[c]` is the left edge of column `c`; the last entry is the total width. */
    val colOffsets: DoubleArray
    val rowOffsets: DoubleArray

    init {
        val maxRow = cells.keys.maxOfOrNull { it.row } ?: -1
        val maxCol = cells.keys.maxOfOrNull { it.col } ?: -1
        rowCount = minOf(order.rows.count, maxOf(maxRow + 1 + extraRows, frozenRows + 1, MIN_ROWS))
        colCount = minOf(order.cols.count, maxOf(maxCol + 1 + extraCols, frozenCols + 1, MIN_COLS))
        val colSize = mutableMapOf<Int, Double>()
        val rowSize = mutableMapOf<Int, Double>()
        for (s in sizes) {
            if (s.size == 0u) continue
            if (s.axis == "col") order.cols.position(s.id)?.let { colSize[it] = s.size.toDouble() }
            if (s.axis == "row") order.rows.position(s.id)?.let { rowSize[it] = s.size.toDouble() }
        }
        colOffsets = DoubleArray(colCount + 1)
        for (c in 0 until colCount) colOffsets[c + 1] = colOffsets[c] + (colSize[c] ?: DEFAULT_COL_WIDTH)
        rowOffsets = DoubleArray(rowCount + 1)
        for (r in 0 until rowCount) rowOffsets[r + 1] = rowOffsets[r] + (rowSize[r] ?: DEFAULT_ROW_HEIGHT)
    }

    val totalWidth: Double get() = colOffsets.last()
    val totalHeight: Double get() = rowOffsets.last()

    fun width(col: Int): Double = colOffsets[col + 1] - colOffsets[col]

    fun height(row: Int): Double = rowOffsets[row + 1] - rowOffsets[row]

    /** Width of the frozen columns, height of the frozen rows. */
    val frozenWidth: Double get() = colOffsets[frozenCols]
    val frozenHeight: Double get() = rowOffsets[frozenRows]

    /** The column whose span holds `x` (content coordinates), clamped. */
    fun colAt(x: Double): Int = index(colOffsets, x)

    fun rowAt(y: Double): Int = index(rowOffsets, y)

    companion object {
        /** The web grid's metrics (`spreadsheet/viewport.ts`, `SpreadsheetGrid.tsx`), in dp. */
        const val DEFAULT_COL_WIDTH = 100.0
        const val DEFAULT_ROW_HEIGHT = 24.0
        const val HEADER_HEIGHT = 26.0
        const val ROW_HEADER_WIDTH = 52.0
        private const val EXTRA_ROWS = 30
        private const val EXTRA_COLS = 6
        private const val MIN_ROWS = 60
        private const val MIN_COLS = 12

        fun index(
            offsets: DoubleArray,
            v: Double,
        ): Int {
            var lo = 0
            var hi = offsets.size - 2
            if (hi < 0 || v <= 0) return 0
            if (v >= offsets[hi + 1]) return hi
            while (lo < hi) {
                val mid = (lo + hi + 1) / 2
                if (offsets[mid] <= v) lo = mid else hi = mid - 1
            }
            return lo
        }
    }
}
