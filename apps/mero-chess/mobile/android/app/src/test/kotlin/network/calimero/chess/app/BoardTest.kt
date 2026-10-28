package network.calimero.chess.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BoardTest {
    @Test
    fun `starting position reads off the fen`() {
        val squares = Board.squares(Fixtures.START)
        assertEquals(32, squares.filterNotNull().size)
        assertEquals(Piece(PieceColor.WHITE, 'k'), squares[Board.squareIndex("e1")!!])
        assertEquals(Piece(PieceColor.BLACK, 'q'), squares[Board.squareIndex("d8")!!])
        assertNull(squares[Board.squareIndex("e4")!!])
        assertEquals("bN", squares[Board.squareIndex("g8")!!]?.assetName)
    }

    @Test
    fun `square names round trip`() {
        for (index in 0 until 64) assertEquals(index, Board.squareIndex(Board.squareName(index)))
        assertNull(Board.squareIndex("i9"))
        assertTrue(Board.isDark(Board.squareIndex("a1")!!))
        assertFalse(Board.isDark(Board.squareIndex("h1")!!))
    }

    @Test
    fun `display order puts the own side at the bottom`() {
        val white = Board.displayOrder(flipped = false)
        assertEquals("a8", Board.squareName(white.first()))
        assertEquals("h1", Board.squareName(white.last()))
        val black = Board.displayOrder(flipped = true)
        assertEquals("h1", Board.squareName(black.first()))
        assertEquals("a8", Board.squareName(black.last()))
    }

    @Test
    fun `targets and movable come from the legal move list`() {
        assertEquals(setOf("e3", "e4"), Board.targets(Fixtures.openingMoves, "e2"))
        assertEquals(setOf("f3", "h3"), Board.targets(Fixtures.openingMoves, "g1"))
        assertTrue("b1" in Board.movable(Fixtures.openingMoves))
        assertFalse("e1" in Board.movable(Fixtures.openingMoves))
    }

    @Test
    fun `promotions are offered queen first`() {
        val legal = listOf("e7e8n", "e7e8b", "e7e8q", "e7e8r", "e7d8q")
        assertEquals(listOf('q', 'r', 'b', 'n'), Board.promotions(legal, "e7", "e8"))
        assertEquals(emptyList<Char>(), Board.promotions(listOf("e2e4"), "e2", "e4"))
    }

    @Test
    fun `move pairs number the scoresheet`() {
        assertEquals(listOf(MovePair(1, "e4", "e5"), MovePair(2, "Nf3", "")), Board.movePairs(listOf("e4", "e5", "Nf3")))
    }

    @Test
    fun `material counts captures and lead`() {
        // White is missing a pawn, Black a knight and a pawn: White is three up.
        val material = Board.material(Board.squares("r1bqkbnr/ppp1pppp/8/8/8/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1"))
        assertEquals(listOf('n', 'p'), material.captured[PieceColor.WHITE])
        assertEquals(listOf('p'), material.captured[PieceColor.BLACK])
        assertEquals(3, material.lead[PieceColor.WHITE])
        assertEquals(0, material.lead[PieceColor.BLACK])
    }

    @Test
    fun `status sentences`() {
        assertEquals("White (Ana) to move.", ChessText.status(Fixtures.table()))
        assertEquals("White (Ana) is in check.", ChessText.status(Fixtures.table(check = true)))
        assertEquals("Ben wins — checkmate.", ChessText.status(Fixtures.table(status = "finished", result = "0-1", reason = "checkmate")))
        assertEquals("Draw — by agreement.", ChessText.status(Fixtures.table(status = "finished", result = "1/2-1/2", reason = "agreement")))
        assertEquals("Waiting for both players to sit down.", ChessText.status(Fixtures.table(status = "awaitingPlayers")))
        assertEquals("Claim draw (threefold repetition)", ChessText.claimLabel("threefold"))
        assertNull(ChessText.claimLabel(""))
        assertEquals("Game 1 of 1 · your move", ChessText.meta(Fixtures.table()))
    }

    @Test
    fun `an unnamed seat reads as a short id`() {
        val view = Fixtures.table(black = Fixtures.seat("black", Fixtures.them, "")).named
        assertEquals("cdcdcd…cdcd", view.black.name)
        assertEquals("Ana", view.white.name)
    }
}
