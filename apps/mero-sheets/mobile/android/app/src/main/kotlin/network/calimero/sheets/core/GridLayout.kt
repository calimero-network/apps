package network.calimero.sheets.core

import network.calimero.sheets.generated.AxisEntryView
import network.calimero.sheets.generated.SheetLayout

/**
 * Row and column order: which id sits at which position. The twin of
 * `logic/crates/recalc/src/layout.rs` (`Axis::build`).
 *
 * A cell is stored under row and column ids, never positions. An untouched axis has the implicit
 * layout (id `k` at position `k`); an explicit entry adds a row or column (a new id at a generated
 * position, compared as a string) or deletes one (a tombstone on its id).
 */
class AxisOrder(
    entries: List<AxisEntryView>,
    length: Int,
) {
    /** The id at each position. */
    val ids: List<String>
    private val index: Map<String, Int>

    init {
        if (entries.isEmpty()) {
            ids = List(length) { it.toString() }
        } else {
            val deletedImplicit = mutableMapOf<Int, Boolean>()
            val added = mutableListOf<Pair<String, String>>()
            for (e in entries) {
                val k = implicitIndex(e.id)
                if (k != null) {
                    deletedImplicit[k] = e.deleted
                } else if (!e.deleted) {
                    added += e.pos to e.id
                }
            }
            added.sortWith(compareBy<Pair<String, String>> { it.first }.thenBy { it.second })
            val out = ArrayList<String>(length)
            var nextImplicit = 0
            var nextAdded = 0
            while (out.size < length) {
                val implicit = implicitPos(nextImplicit)
                if (nextAdded < added.size && added[nextAdded].first < implicit) {
                    out += added[nextAdded].second
                    nextAdded += 1
                } else {
                    if (deletedImplicit[nextImplicit] != true) out += nextImplicit.toString()
                    nextImplicit += 1
                }
            }
            ids = out
        }
        index = ids.withIndex().associate { it.value to it.index }
    }

    val count: Int get() = ids.size

    /** The position of an id, or null when it is deleted or past the end. */
    fun position(id: String): Int? = index[id]

    fun idAt(position: Int): String? = ids.getOrNull(position)

    companion object {
        /** Rows a sheet has (`MAX_ROWS`) and columns (`MAX_COLS`, `A`..`ZZ`). */
        const val MAX_ROWS = 1000
        const val MAX_COLS = 702
        private const val IMPLICIT_WIDTH = 9

        /** `5` and the index zero-padded to nine digits. */
        fun implicitPos(k: Int): String = "5" + k.toString().padStart(IMPLICIT_WIDTH, '0')

        /** The implicit index an id names (`"12"`, never `"012"`). */
        fun implicitIndex(id: String): Int? {
            if (id.isEmpty() || !id.all { it in '0'..'9' } || (id.length > 1 && id.startsWith('0'))) return null
            return id.toIntOrNull()
        }
    }
}

/** A sheet's rows and columns in order. */
class SheetOrder(
    layout: SheetLayout?,
) {
    val rows = AxisOrder(layout?.rows.orEmpty(), AxisOrder.MAX_ROWS)
    val cols = AxisOrder(layout?.cols.orEmpty(), AxisOrder.MAX_COLS)
}

/** A1 addressing (`app/src/spreadsheet/refs.ts`). */
object A1 {
    private const val LETTERS = 26
    private const val MAX_LETTERS = 3

    /** 0-based column → letters (`0→A`, `25→Z`, `26→AA`). */
    fun column(col: Int): String {
        var n = col
        val label = StringBuilder()
        do {
            label.insert(0, ('A' + n % LETTERS))
            n = n / LETTERS - 1
        } while (n >= 0)
        return label.toString()
    }

    /** `B3` for 0-based row 2, column 1. */
    fun cell(
        row: Int,
        col: Int,
    ): String = "${column(col)}${row + 1}"

    /** Letters → 0-based column (`A→0`, `AA→26`); null when not letters. */
    fun columnIndex(letters: String): Int? {
        if (letters.isEmpty() || letters.length > MAX_LETTERS) return null
        var n = 0
        for (ch in letters.uppercase()) {
            if (ch !in 'A'..'Z') return null
            n = n * LETTERS + (ch - 'A' + 1)
        }
        return n - 1
    }

    /** `Data!` or `'Sheet 1'!`: simple names bare, others quoted with `'` doubled. */
    fun sheetPrefix(name: String): String {
        val simple = name.isNotEmpty() && name[0].isAsciiLetter() && name.all { it.isAsciiLetter() || it in '0'..'9' }
        return if (simple) "$name!" else "'${name.replace("'", "''")}'!"
    }

    private fun Char.isAsciiLetter() = this in 'A'..'Z' || this in 'a'..'z'
}
