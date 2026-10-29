package network.calimero.sheets.core

/**
 * A stored formula in the form people read it.
 *
 * The contract stores formulas with rows and columns by id (`{r=k3;c=1}`, or `B12` for implicit
 * ids) and other sheets by id (`[sheet-id]!A1`). The web app shows positions and sheet names; this
 * is the twin of the engine's `to_display` (`logic/crates/recalc/src/formula.rs`) plus the web's
 * `idsToNames` (`app/src/spreadsheet/sheetref.ts`). It only rewrites reference spans: spacing,
 * functions and strings stay exactly as written.
 */
@Suppress("TooManyFunctions")
object FormulaDisplay {
    private const val REF_ERROR = "#REF!"

    @Suppress("CyclomaticComplexMethod", "LongMethod", "LoopWithTooManyJumpStatements")
    fun display(
        formula: String,
        home: String,
        orders: (String) -> SheetOrder,
        sheetName: (String) -> String?,
    ): String {
        if (!formula.startsWith("=")) return formula
        val body = formula.substring(1)
        val toks = lex(body) ?: return formula
        val edits = mutableListOf<Triple<Int, Int, String>>()
        var i = 0
        while (i < toks.size) {
            val sheet = (toks[i].kind as? Kind.Sheet)?.id
            if (sheet != null) sheetName(sheet)?.let { edits += Triple(toks[i].start, toks[i].end, A1.sheetPrefix(it)) }
            val first = i + if (sheet == null) 0 else 1
            if (first >= toks.size) break
            val a = toks[first]
            val colon = toks.getOrNull(first + 1)?.kind == Kind.Colon
            val b = if (colon) toks.getOrNull(first + 2) else null
            val isCall = toks.getOrNull(first + 1)?.kind == Kind.LParen
            val ea = anchor(a)
            val eb = b?.let { anchor(it) }
            val ends: List<Token>? =
                when {
                    ea is Anchor.Cell && eb is Anchor.Cell -> listOf(a, b!!)
                    ea is Anchor.Col && eb is Anchor.Col -> listOf(a, b!!)
                    ea is Anchor.Row && eb is Anchor.Row -> listOf(a, b!!)
                    ea is Anchor.Cell && !(isCall || (colon && b != null)) -> listOf(a)
                    else -> null
                }
            if (ends == null) {
                i += 1
                continue
            }
            val order = orders(sheet ?: home)
            val parts = ends.map { rewrite(it, order) }
            val text = if (parts.any { it == null }) REF_ERROR else parts.filterNotNull().joinToString(":")
            edits += Triple(ends.first().start, ends.last().end, text)
            i = first + if (ends.size == 2) 3 else 1
        }
        val out = StringBuilder("=")
        var copied = 0
        for ((start, end, text) in edits.sortedBy { it.first }) {
            if (start < copied) continue
            out.append(body, copied, start).append(text)
            copied = end
        }
        out.append(body, copied, body.length)
        return out.toString()
    }

    sealed interface Kind {
        data class Sheet(
            val id: String,
        ) : Kind

        data class IdRef(
            val row: String?,
            val col: String?,
        ) : Kind

        data class Word(
            val text: String,
        ) : Kind

        data class Number(
            val text: String,
        ) : Kind

        data object Colon : Kind

        data object LParen : Kind

        data object Other : Kind
    }

    data class Token(
        val kind: Kind,
        val start: Int,
        val end: Int,
        val raw: String,
    )

    sealed interface Anchor {
        data class Cell(
            val row: String,
            val col: String,
        ) : Anchor

        data class Col(
            val col: String,
        ) : Anchor

        data class Row(
            val row: String,
        ) : Anchor
    }

    @Suppress("CyclomaticComplexMethod", "LongMethod", "ReturnCount", "NestedBlockDepth", "LoopWithTooManyJumpStatements")
    fun lex(c: String): List<Token>? {
        val out = mutableListOf<Token>()
        var i = 0

        fun isDigit(k: Int) = k < c.length && c[k] in '0'..'9'

        fun isWordChar(ch: Char) = ch.isLetterOrDigit() || ch == '_' || ch == '.' || ch == '$'

        fun number(): Kind {
            val start = i
            while (i < c.length && (c[i] in '0'..'9' || c[i] == '.')) i += 1
            return Kind.Number(c.substring(start, i))
        }

        fun word(): Kind {
            val w = StringBuilder()
            while (i < c.length && isWordChar(c[i])) {
                if (c[i] != '$') w.append(c[i])
                i += 1
            }
            return Kind.Word(w.toString())
        }
        while (i < c.length) {
            val ch = c[i]
            val start = i
            val kind: Kind
            when {
                ch == '$' && isDigit(i + 1) -> {
                    i += 1
                    kind = number()
                }
                ch == '$' -> {
                    i += 1
                    if (i >= c.length || !c[i].isLetter()) continue
                    kind = word()
                }
                ch.isWhitespace() -> {
                    i += 1
                    continue
                }
                ch == '"' -> {
                    i += 1
                    while (true) {
                        if (i >= c.length) return null
                        if (c[i] == '"' && i + 1 < c.length && c[i + 1] == '"') {
                            i += 2
                        } else if (c[i] == '"') {
                            i += 1
                            break
                        } else {
                            i += 1
                        }
                    }
                    kind = Kind.Other
                }
                ch == '[' -> {
                    val close = c.indexOf(']', i + 1)
                    if (close < 0 || close + 1 >= c.length || c[close + 1] != '!') return null
                    kind = Kind.Sheet(c.substring(i + 1, close))
                    i = close + 2
                }
                ch == '{' -> {
                    val close = c.indexOf('}', i + 1)
                    if (close < 0) return null
                    val inner = c.substring(i + 1, close)
                    i = close + 1
                    var row: String? = null
                    var col: String? = null
                    for (part in inner.split(';')) {
                        val pair = part.trim().trimStart('$').split('=', limit = 2)
                        if (pair.size != 2) return null
                        val id = pair[1].trim()
                        if (id.isEmpty() || !id.all { it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' }) return null
                        when {
                            pair[0].trim() == "r" && row == null -> row = id
                            pair[0].trim() == "c" && col == null -> col = id
                            else -> return null
                        }
                    }
                    kind = Kind.IdRef(row, col)
                }
                ch == '#' -> {
                    i += 1
                    while (i < c.length && (c[i].isLetterOrDigit() || c[i] in "/!?")) i += 1
                    kind = Kind.Other
                }
                ch in '0'..'9' || ch == '.' -> kind = number()
                ch.isLetter() || ch == '_' -> kind = word()
                else -> {
                    kind =
                        when (ch) {
                            '(' -> Kind.LParen
                            ':' -> Kind.Colon
                            else -> Kind.Other
                        }
                    val two = (ch == '<' || ch == '>') && i + 1 < c.length && (c[i + 1] == '=' || c[i + 1] == '>')
                    i += if (two) 2 else 1
                }
            }
            out += Token(kind, start, i, c.substring(start, i))
        }
        return out
    }

    fun anchor(t: Token): Anchor? =
        when (val k = t.kind) {
            is Kind.Word ->
                cellWord(k.text)?.let { (r, c) -> Anchor.Cell(r.toString(), c.toString()) }
                    ?: A1.columnIndex(k.text)?.takeIf { it < AxisOrder.MAX_COLS }?.let { Anchor.Col(it.toString()) }
            is Kind.Number ->
                k.text
                    .takeIf { '.' !in it }
                    ?.toIntOrNull()
                    ?.takeIf { it >= 1 }
                    ?.let { Anchor.Row((it - 1).toString()) }
            is Kind.IdRef ->
                when {
                    k.row != null && k.col != null -> Anchor.Cell(k.row, k.col)
                    k.col != null -> Anchor.Col(k.col)
                    k.row != null -> Anchor.Row(k.row)
                    else -> null
                }
            else -> null
        }

    /** `B12` → (11, 1). */
    fun cellWord(w: String): Pair<Int, Int>? {
        val split = w.indexOfFirst { it in '0'..'9' }
        if (split < 0) return null
        val col = A1.columnIndex(w.substring(0, split))?.takeIf { it < AxisOrder.MAX_COLS } ?: return null
        val digits = w.substring(split)
        if (!digits.all { it in '0'..'9' }) return null
        val row = digits.toIntOrNull()?.takeIf { it >= 1 } ?: return null
        return (row - 1) to col
    }

    /** One reference end with positions, or null when its row or column is gone. */
    fun rewrite(
        t: Token,
        order: SheetOrder,
    ): String? {
        val (colAbs, rowAbs) = anchors(t.raw)

        fun d(abs: Boolean) = if (abs) "$" else ""
        return when (val a = anchor(t) ?: return null) {
            is Anchor.Cell -> {
                val row = order.rows.position(a.row) ?: return null
                val col = order.cols.position(a.col) ?: return null
                "${d(colAbs)}${A1.column(col)}${d(rowAbs)}${row + 1}"
            }
            is Anchor.Col -> order.cols.position(a.col)?.let { "${d(colAbs)}${A1.column(it)}" }
            is Anchor.Row -> order.rows.position(a.row)?.let { "${d(rowAbs)}${it + 1}" }
        }
    }

    fun anchors(raw: String): Pair<Boolean, Boolean> {
        if (raw.startsWith("{")) return ("\$c=" in raw) to ("\$r=" in raw)
        val rowAbs = raw.indices.any { raw[it] == '$' && it + 1 < raw.length && raw[it + 1] in '0'..'9' }
        return raw.startsWith("$") to rowAbs
    }
}
