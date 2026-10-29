package network.calimero.battleships.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * The two fleets and salts the vectors below were computed from with the web app's own code
 * (`computeCommitment` in `app/src/lib/board.ts`, run under Node). ALICE is also the contract's
 * `commitment_vector_shared_with_the_client` (crates/game/src/lib.rs). Swift `BoardTests` carries
 * the same vectors.
 */
object Vectors {
    /** `['0,0;1,0', '0,2;1,2;2,2', '0,4;1,4;2,4', '0,6;1,6;2,6;3,6', '0,8;1,8;2,8;3,8;4,8']` */
    val alice =
        FleetLayout(
            listOf(
                PlacedShip(5, Coordinate(0, 8), true),
                PlacedShip(4, Coordinate(0, 6), true),
                PlacedShip(3, Coordinate(0, 2), true),
                PlacedShip(3, Coordinate(0, 4), true),
                PlacedShip(2, Coordinate(0, 0), true),
            ),
        )
    val aliceSalt = List(16) { 0xA5 }
    const val ALICE_COMMITMENT = "37188894d025229c47a83365463dbc5e15d7a267aa13ef63f4d963b0d03def4f"

    /** `['9,0;9,1', '7,0;7,1;7,2', '2,3;3,3;4,3', '0,9;1,9;2,9;3,9', '5,5;5,6;5,7;5,8;5,9']` */
    val bob =
        FleetLayout(
            listOf(
                PlacedShip(5, Coordinate(5, 5), false),
                PlacedShip(4, Coordinate(0, 9), true),
                PlacedShip(3, Coordinate(7, 0), false),
                PlacedShip(3, Coordinate(2, 3), true),
                PlacedShip(2, Coordinate(9, 0), false),
            ),
        )
    val bobSalt = List(16) { it }
    const val BOB_COMMITMENT = "50338a717d089186053856a715f5d5eecc203a799fa1c4e13dd77d645acd2d84"
}

class CommitmentTest {
    @Test
    fun `matches the web app and the contract for alice`() {
        assertEquals(Vectors.ALICE_COMMITMENT, Commitment.compute(Vectors.alice.cells, Vectors.aliceSalt))
    }

    @Test
    fun `matches the web app for bob`() {
        assertEquals(Vectors.BOB_COMMITMENT, Commitment.compute(Vectors.bob.cells, Vectors.bobSalt))
    }

    @Test
    fun `board bytes are borsh of a vec`() {
        assertEquals(listOf(4, 0, 0, 0, 1, 0, 0, 1), Commitment.boardBytes(listOf(1, 0, 0, 1)))
        val full = Commitment.boardBytes(Vectors.alice.cells)
        assertEquals(listOf(100, 0, 0, 0), full.take(4))
        assertEquals(104, full.size)
    }

    @Test
    fun `the salt changes the commitment`() {
        val other = Vectors.aliceSalt.toMutableList().also { it[0] = 0xA6 }
        assertNotEquals(Vectors.ALICE_COMMITMENT, Commitment.compute(Vectors.alice.cells, other))
    }

    @Test
    fun `refuses a salt that is not sixteen bytes`() {
        try {
            Commitment.compute(listOf(0), listOf(1, 2, 3))
            fail("expected a refusal")
        } catch (_: BattleshipsException) {
        }
    }

    @Test
    fun `random salts are sixteen fresh bytes`() {
        val a = Commitment.randomSalt()
        assertEquals(16, a.size)
        assertNotEquals(a, Commitment.randomSalt())
    }

    @Test
    fun `sealing keeps the salt that was hashed`() {
        val board = StoredBoard.sealing(Vectors.alice, Vectors.aliceSalt)
        assertEquals(Vectors.ALICE_COMMITMENT, board.commitment)
        assertEquals(Vectors.aliceSalt, board.saltBytes)
        assertEquals("a5".repeat(16), board.salt)
        assertEquals("battleships:board:v1:k:m", BoardStore.key("k", "m"))
    }

    @Test
    fun `hex round trips`() {
        assertEquals("00abff", Hex.lower(listOf(0, 171, 255)))
        assertEquals(listOf(0, 171, 255), Hex.bytes("00abff"))
        assertNull(Hex.bytes("abc"))
        assertNull(Hex.bytes("zz"))
    }
}

class FleetLayoutTest {
    @Test
    fun `a full fleet covers seventeen cells`() {
        assertTrue(Vectors.alice.isComplete)
        assertEquals(17, Vectors.alice.cells.count { it == Cell.SHIP })
        assertEquals(Cell.SHIP, Vectors.alice.cells[8 * 10 + 4])
    }

    @Test
    fun `ships slide back instead of running off the edge`() {
        val layout = FleetLayout().place(0, Coordinate(8, 0), true)
        assertEquals(Coordinate(5, 0), layout?.ships?.get(0)?.origin)
    }

    @Test
    fun `ships may not touch even at a corner`() {
        val layout = FleetLayout().place(4, Coordinate(0, 0), true)!!
        assertNull("diagonal", layout.place(3, Coordinate(2, 1), true))
        assertNull("side", layout.place(3, Coordinate(0, 1), true))
        assertNull("overlap", layout.place(3, Coordinate(1, 0), false))
        assertNotNull(layout.place(3, Coordinate(0, 2), true))
    }

    @Test
    fun `rotating turns about the bow or the tapped square`() {
        val layout = FleetLayout().place(1, Coordinate(2, 2), true)!!
        assertEquals(PlacedShip(4, Coordinate(2, 2), false), layout.rotate(1)?.ships?.get(1))
        val low = FleetLayout().place(0, Coordinate(0, 9), true)!!.rotate(0, Coordinate(2, 9))!!
        assertFalse(low.ships[0]!!.horizontal)
        assertTrue(low.ships[0]!!.cells.all { it.isOnBoard })
    }

    @Test
    fun `a rotation with no room changes nothing`() {
        val layout = FleetLayout().place(0, Coordinate(0, 0), true)!!.place(1, Coordinate(0, 2), true)!!
        assertNull(layout.rotate(0))
    }

    @Test
    fun `random fleets are legal`() {
        repeat(50) {
            val layout = FleetLayout.random()
            assertTrue(layout.isComplete)
            assertEquals(listOf(2, 3, 3, 4, 5), BoardReading.ships(layout.cells).map { it.size }.sorted())
        }
    }
}

class BoardReadingTest {
    private fun grid(vararg marks: Triple<Int, Int, Int>): List<Int> {
        val out = MutableList(100) { Cell.EMPTY }
        marks.forEach { (x, y, v) -> out[y * 10 + x] = v }
        return out
    }

    @Test
    fun `answers come from the board`() {
        assertTrue(BoardReading.isHit(Vectors.alice.cells, Coordinate(1, 0)))
        assertFalse(BoardReading.isHit(Vectors.alice.cells, Coordinate(2, 0)))
        assertFalse(BoardReading.isHit(Vectors.alice.cells, Coordinate(10, 0)))
    }

    @Test
    fun `overlay shows what was answered`() {
        val own = BoardReading.overlay(Vectors.alice.cells, grid(Triple(0, 0, Cell.HIT), Triple(5, 5, Cell.MISS), Triple(2, 0, Cell.PENDING)))
        assertEquals(Cell.HIT, own[0])
        assertEquals(Cell.SHIP, own[1])
        assertEquals(Cell.MISS, own[55])
        assertEquals(Cell.PENDING, own[2])
    }

    @Test
    fun `an enemy ship is sunk once both ends are closed`() {
        assertTrue(BoardReading.sunkEnemyShips(grid(Triple(3, 3, Cell.HIT), Triple(4, 3, Cell.HIT), Triple(2, 3, Cell.MISS))).isEmpty())
        val closed = grid(Triple(3, 3, Cell.HIT), Triple(4, 3, Cell.HIT), Triple(2, 3, Cell.MISS), Triple(5, 3, Cell.MISS))
        assertEquals(listOf(listOf(Coordinate(3, 3), Coordinate(4, 3))), BoardReading.sunkEnemyShips(closed))
        assertEquals(1, BoardReading.sunkEnemyShips(grid(Triple(0, 0, Cell.HIT), Triple(0, 1, Cell.HIT), Triple(0, 2, Cell.MISS))).size)
        assertEquals(1, BoardReading.sunkEnemyShips(grid(*(0 until 5).map { Triple(it, 7, Cell.HIT) }.toTypedArray())).size)
    }

    @Test
    fun `your ship is sunk when every square is hit`() {
        val incoming = grid(Triple(0, 0, Cell.HIT), Triple(1, 0, Cell.HIT), Triple(0, 2, Cell.HIT))
        assertEquals(listOf(listOf(Coordinate(0, 0), Coordinate(1, 0))), BoardReading.sunkOwnShips(Vectors.alice.cells, incoming))
    }

    @Test
    fun `coordinates read like the board`() {
        assertEquals("A1", Coordinate(0, 0).label)
        assertEquals("J10", Coordinate(9, 9).label)
    }
}
