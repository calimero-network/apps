package network.calimero.battleships.core

import kotlin.random.Random

/**
 * The contract's `board::Cell` bytes, pinned here (as the web app's `lib/board.ts` pins them) so a
 * renumbering upstream fails the commitment test instead of committing to a board the reveal can
 * never match. (Swift `Cell`.)
 */
object Cell {
    const val EMPTY: Int = 0
    const val SHIP: Int = 1
    const val HIT: Int = 2
    const val MISS: Int = 3
    const val PENDING: Int = 4
}

/** The board's fixed shape. (Swift `BoardGeometry`.) */
object BoardGeometry {
    const val SIZE = 10
    const val CELL_COUNT = SIZE * SIZE
}

/** A square on the board: [x] is the column (A–J), [y] the row (1–10). (Swift `Coordinate`.) */
data class Coordinate(
    val x: Int,
    val y: Int,
) : Comparable<Coordinate> {
    /** Row-major index into a 100-cell grid. */
    val index: Int get() = y * BoardGeometry.SIZE + x

    val isOnBoard: Boolean get() = x in 0 until BoardGeometry.SIZE && y in 0 until BoardGeometry.SIZE

    /** `A1`…`J10`, as the board's edges label it. */
    val label: String get() = "${columnLabel(x)}${y + 1}"

    override fun compareTo(other: Coordinate): Int = index.compareTo(other.index)

    internal val orthogonal: List<Coordinate>
        get() = listOf(Coordinate(x + 1, y), Coordinate(x - 1, y), Coordinate(x, y + 1), Coordinate(x, y - 1))

    internal val around: List<Coordinate>
        get() = (-1..1).flatMap { dy -> (-1..1).map { dx -> Coordinate(x + dx, y + dy) } }.filter { it != this }

    companion object {
        fun columnLabel(x: Int): String = ('A' + x).toString()

        val all: List<Coordinate> =
            (0 until BoardGeometry.SIZE).flatMap { y -> (0 until BoardGeometry.SIZE).map { x -> Coordinate(x, y) } }
    }
}

/** One kind of ship in the fleet. (Swift `ShipClass`.) */
data class ShipClass(
    val name: String,
    val length: Int,
)

/** The fleet the contract audits at the reveal: 1x5, 1x4, 2x3, 1x2 (`SHIP_TARGETS` on the web). */
object Fleet {
    val classes: List<ShipClass> =
        listOf(
            ShipClass("Carrier", 5),
            ShipClass("Battleship", 4),
            ShipClass("Cruiser", 3),
            ShipClass("Submarine", 3),
            ShipClass("Destroyer", 2),
        )

    val cellCount: Int = classes.sumOf { it.length }
}

/** A ship on the board: where its bow is and which way it points. (Swift `PlacedShip`.) */
data class PlacedShip(
    val length: Int,
    val origin: Coordinate,
    val horizontal: Boolean,
) {
    val cells: List<Coordinate>
        get() = (0 until length).map { if (horizontal) Coordinate(origin.x + it, origin.y) else Coordinate(origin.x, origin.y + it) }
}

/**
 * The fleet being laid out before it is committed: one slot per [Fleet.classes] entry, placed or
 * not. Ships stay straight, on the board, apart from each other and never touching, not even at a
 * corner, which is what the contract's audit accepts. Immutable: every change returns a new layout,
 * or null when it does not fit. (Swift `FleetLayout`.)
 */
data class FleetLayout(
    val ships: List<PlacedShip?> = List(Fleet.classes.size) { null },
) {
    init {
        require(ships.size == Fleet.classes.size)
    }

    val isComplete: Boolean get() = ships.all { it != null }
    val placedCount: Int get() = ships.count { it != null }
    val nextUnplaced: Int? get() = ships.indexOfFirst { it == null }.takeIf { it >= 0 }

    /** The slot whose ship covers [cell]. */
    fun shipIndex(cell: Coordinate): Int? = ships.indexOfFirst { it?.cells?.contains(cell) == true }.takeIf { it >= 0 }

    /** Whether [ship] fits: on the board, and clear of every other ship by at least one square. */
    fun fits(
        ship: PlacedShip,
        ignoring: Int? = null,
    ): Boolean {
        if (!ship.cells.all { it.isOnBoard }) return false
        val taken =
            ships
                .withIndex()
                .filter { it.index != ignoring }
                .flatMap { it.value?.cells.orEmpty() }
                .toSet()
        return ship.cells.all { cell -> cell !in taken && cell.around.none { it in taken } }
    }

    /**
     * Slot [index] with its bow at [cell] (or as near as it can go without running off the edge);
     * null when it does not fit there.
     */
    fun place(
        index: Int,
        cell: Coordinate,
        horizontal: Boolean,
    ): FleetLayout? {
        val length = Fleet.classes[index].length
        val maxStart = BoardGeometry.SIZE - length
        val origin = if (horizontal) Coordinate(minOf(cell.x, maxStart), cell.y) else Coordinate(cell.x, minOf(cell.y, maxStart))
        val ship = PlacedShip(length, origin, horizontal)
        if (!fits(ship, index)) return null
        return copy(ships = ships.toMutableList().also { it[index] = ship })
    }

    /** Slot [index] turned a quarter, about its bow or the tapped [pivot]; null when neither fits. */
    fun rotate(
        index: Int,
        pivot: Coordinate? = null,
    ): FleetLayout? {
        val ship = ships[index] ?: return null
        val turned = !ship.horizontal
        for (origin in listOfNotNull(ship.origin, pivot)) {
            val candidate = PlacedShip(ship.length, origin, turned)
            if (fits(candidate, index)) return copy(ships = ships.toMutableList().also { it[index] = candidate })
        }
        // Slide it back along the new axis so a ship near the edge can still turn.
        return place(index, pivot ?: ship.origin, turned)
    }

    fun remove(index: Int): FleetLayout = copy(ships = ships.toMutableList().also { it[index] = null })

    /** The 100 pristine cells (water or ship), row-major: what is committed and revealed. */
    val cells: List<Int>
        get() {
            val out = MutableList(BoardGeometry.CELL_COUNT) { Cell.EMPTY }
            ships.filterNotNull().forEach { ship -> ship.cells.forEach { out[it.index] = Cell.SHIP } }
            return out
        }

    companion object {
        private const val TRIES = 200

        /** A legal fleet laid out at random, biggest ships first. */
        @Suppress("NestedBlockDepth")
        fun random(random: Random = Random.Default): FleetLayout {
            while (true) {
                var layout = FleetLayout()
                var stuck = false
                for (index in Fleet.classes.indices) {
                    var placed: FleetLayout? = null
                    var tries = 0
                    while (placed == null && tries < TRIES) {
                        tries++
                        val cell = Coordinate(random.nextInt(BoardGeometry.SIZE), random.nextInt(BoardGeometry.SIZE))
                        placed = layout.place(index, cell, random.nextBoolean())
                    }
                    if (placed == null) {
                        stuck = true
                        break
                    }
                    layout = placed
                }
                if (!stuck) return layout
            }
        }
    }
}

/** Reading the grids the contract returns. (Swift `BoardReading`.) */
object BoardReading {
    /**
     * "Your waters": the pristine cells with the opponent's answered shots laid over them
     * (`overlayOwnBoard` on the web): a cell shows what was ANSWERED, never what the device would answer.
     */
    fun overlay(
        cells: List<Int>,
        incoming: List<Int>,
    ): List<Int> =
        cells.mapIndexed { index, cell ->
            val shot = incoming.getOrElse(index) { Cell.EMPTY }
            if (shot == Cell.HIT || shot == Cell.MISS || shot == Cell.PENDING) shot else cell
        }

    /** What this device answers to a shot at [cell]: whether a ship is there. */
    fun isHit(
        cells: List<Int>,
        cell: Coordinate,
    ): Boolean = cell.isOnBoard && cells.getOrNull(cell.index) == Cell.SHIP

    /** The ships in a set of pristine cells. Ships never touch, so every connected run is one ship. */
    fun ships(cells: List<Int>): List<List<Coordinate>> = clusters(cells) { it == Cell.SHIP }

    /** The ships of your own fleet the opponent has sunk: every square answered as a hit. */
    fun sunkOwnShips(
        cells: List<Int>,
        incoming: List<Int>,
    ): List<List<Coordinate>> = ships(cells).filter { ship -> ship.all { incoming.getOrNull(it.index) == Cell.HIT } }

    /**
     * The opponent's ships your shots have certainly sunk. Ships never touch, so a run of hits is one
     * ship, and it is whole once both squares past its ends are misses or off the board (all four
     * sides for a single hit), or once it is as long as the longest ship.
     */
    fun sunkEnemyShips(shots: List<Int>): List<List<Coordinate>> {
        val longest = Fleet.classes.maxOf { it.length }

        fun closed(cell: Coordinate) = !cell.isOnBoard || shots[cell.index] == Cell.MISS
        return clusters(shots) { it == Cell.HIT }.filter { run ->
            if (run.size >= longest) return@filter true
            val first = run.first()
            val last = run.last()
            if (run.size == 1) return@filter first.orthogonal.all(::closed)
            val horizontal = first.y == last.y
            val before = if (horizontal) Coordinate(first.x - 1, first.y) else Coordinate(first.x, first.y - 1)
            val after = if (horizontal) Coordinate(last.x + 1, last.y) else Coordinate(last.x, last.y + 1)
            closed(before) && closed(after)
        }
    }

    @Suppress("NestedBlockDepth")
    private fun clusters(
        grid: List<Int>,
        matches: (Int) -> Boolean,
    ): List<List<Coordinate>> {
        if (grid.size < BoardGeometry.CELL_COUNT) return emptyList()
        val seen = mutableSetOf<Coordinate>()
        val out = mutableListOf<List<Coordinate>>()
        for (start in Coordinate.all) {
            if (!matches(grid[start.index]) || start in seen) continue
            val run = mutableListOf<Coordinate>()
            val stack = ArrayDeque(listOf(start))
            seen += start
            while (stack.isNotEmpty()) {
                val cell = stack.removeLast()
                run += cell
                for (next in cell.orthogonal) {
                    if (next.isOnBoard && next !in seen && matches(grid[next.index])) {
                        seen += next
                        stack += next
                    }
                }
            }
            out += run.sorted()
        }
        return out
    }
}
