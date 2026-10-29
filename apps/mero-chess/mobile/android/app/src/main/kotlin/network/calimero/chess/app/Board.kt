package network.calimero.chess.app

/** A side of the board. */
enum class PieceColor(
    val wire: String,
    val label: String,
) {
    WHITE("white", "White"),
    BLACK("black", "Black"),
    ;

    val opposite: PieceColor get() = if (this == WHITE) BLACK else WHITE

    companion object {
        fun fromWire(value: String): PieceColor? = entries.firstOrNull { it.wire == value }
    }
}

/** One piece on a square. [kind] is the lowercase FEN letter: p n b r q k. */
data class Piece(
    val color: PieceColor,
    val kind: Char,
) {
    /** The artwork's name: `wK`, `bN`, … (drawable `piece_wk`, `piece_bn`). */
    val assetName: String get() = "${if (color == PieceColor.WHITE) "w" else "b"}${kind.uppercaseChar()}"

    /** "white knight": the accessible name of a square's occupant. */
    val spokenName: String get() = "${color.wire} ${Board.PIECE_NAMES[kind] ?: "piece"}"
}

data class MovePair(
    val number: Int,
    val white: String,
    val black: String,
)

data class Material(
    /** The kinds each side has TAKEN from the other, heaviest first. */
    val captured: Map<PieceColor, List<Char>>,
    /** Points ahead, or 0 for the side behind. */
    val lead: Map<PieceColor, Int>,
)

/**
 * The board as the app draws it, read from the contract's answers.
 *
 * There is no chess engine here, on purpose (see `docs/trust-model.md` and the web app's
 * `utils/board.ts`, which this mirrors): the contract's `table()` returns the position as a FEN AND
 * every legal move in it, so the board only ever offers moves the node will accept. Everything below
 * reads those two values; none of it decides a rule. (Swift `Board`.)
 */
object Board {
    const val FILES = "abcdefgh"

    internal val PIECE_NAMES = mapOf('k' to "king", 'q' to "queen", 'r' to "rook", 'b' to "bishop", 'n' to "knight", 'p' to "pawn")

    /** The 64 squares of a FEN's placement field, index `rank * 8 + file` (a1 = 0, h8 = 63). */
    fun squares(fen: String): List<Piece?> {
        val squares = arrayOfNulls<Piece>(64)
        val placement = fen.substringBefore(' ')
        placement.split('/').take(8).forEachIndexed { row, rank ->
            val rankIndex = 7 - row
            var file = 0
            for (char in rank) {
                if (char.isDigit()) {
                    file += char.digitToInt()
                } else {
                    val kind = char.lowercaseChar()
                    if (file < 8 && PIECE_NAMES.containsKey(kind)) {
                        squares[rankIndex * 8 + file] = Piece(if (char.isUpperCase()) PieceColor.WHITE else PieceColor.BLACK, kind)
                    }
                    file += 1
                }
            }
        }
        return squares.toList()
    }

    /** `e4` for an index. */
    fun squareName(index: Int): String = "${FILES[index % 8]}${index / 8 + 1}"

    /** The index of `e4`, or null. */
    fun squareIndex(name: String): Int? {
        if (name.length != 2) return null
        val file = FILES.indexOf(name[0])
        val rank = name[1].digitToIntOrNull() ?: return null
        if (file < 0 || rank !in 1..8) return null
        return (rank - 1) * 8 + file
    }

    /** a1 is dark. */
    fun isDark(index: Int): Boolean = (index % 8 + index / 8) % 2 == 0

    /** The squares top-left to bottom-right as the player sees them: rank 8 first from White's side, mirrored from Black's. */
    fun displayOrder(flipped: Boolean): List<Int> {
        val order = (7 downTo 0).flatMap { rank -> (0 until 8).map { file -> rank * 8 + file } }
        return if (flipped) order.reversed() else order
    }

    /** The origin squares that have at least one legal move. */
    fun movable(legalMoves: List<String>): Set<String> = legalMoves.map { it.take(2) }.toSet()

    /** Where a piece on [from] may legally go. */
    fun targets(
        legalMoves: List<String>,
        from: String,
    ): Set<String> = legalMoves.filter { it.startsWith(from) }.map { it.substring(2, 4) }.toSet()

    /** The promotion pieces offered for [from]→[to], queen first. Empty when it is not a promotion. */
    fun promotions(
        legalMoves: List<String>,
        from: String,
        to: String,
    ): List<Char> {
        val found = legalMoves.filter { it.length == 5 && it.startsWith(from + to) }.map { it[4] }.toSet()
        return "qrbn".filter { it in found }.toList()
    }

    /** Scoresheet rows: move number, White's SAN, Black's SAN. */
    fun movePairs(san: List<String>): List<MovePair> =
        (san.indices step 2).map { i -> MovePair(i / 2 + 1, san[i], san.getOrElse(i + 1) { "" }) }

    private val START_COUNT = mapOf('q' to 1, 'r' to 2, 'b' to 2, 'n' to 2, 'p' to 8)
    private val VALUE = mapOf('q' to 9, 'r' to 5, 'b' to 3, 'n' to 3, 'p' to 1)
    private const val CAPTURE_ORDER = "qrbnp"

    /** Who has taken what, read off the board (display only, as every chess app shows it). */
    fun material(squares: List<Piece?>): Material {
        val onBoard =
            PieceColor.entries.associateWith { color ->
                squares
                    .filterNotNull()
                    .filter { it.color == color }
                    .groupingBy { it.kind }
                    .eachCount()
            }

        fun missing(color: PieceColor): List<Char> =
            CAPTURE_ORDER.flatMap { kind -> List(maxOf(0, (START_COUNT[kind] ?: 0) - (onBoard[color]?.get(kind) ?: 0))) { kind } }

        fun points(color: PieceColor): Int = onBoard[color].orEmpty().entries.sumOf { (VALUE[it.key] ?: 0) * it.value }
        val diff = points(PieceColor.WHITE) - points(PieceColor.BLACK)
        return Material(
            captured = mapOf(PieceColor.WHITE to missing(PieceColor.BLACK), PieceColor.BLACK to missing(PieceColor.WHITE)),
            lead = mapOf(PieceColor.WHITE to maxOf(0, diff), PieceColor.BLACK to maxOf(0, -diff)),
        )
    }
}
