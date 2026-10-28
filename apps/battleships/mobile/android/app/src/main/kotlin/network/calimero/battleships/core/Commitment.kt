package network.calimero.battleships.core

import kotlinx.serialization.Serializable
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * The board's commit-reveal, byte for byte the web app's (`app/src/lib/board.ts`) and the
 * contract's (`compute_commitment` in `crates/game/src/lib.rs`):
 *
 *     commitment = hex(SHA256(borsh(Vec<u8> cells) || salt))
 *
 * `borsh(Vec<u8>)` is a 4-byte little-endian length, then the bytes; the salt is 16 random bytes.
 * The cells and the salt never leave the device until [GameApi.reveal] publishes them at the end.
 * (Swift `Commitment`.)
 */
object Commitment {
    const val SALT_BYTES = 16
    private const val BYTE = 0xff
    private const val BITS = 8

    /** What `reveal_board` takes as `board_bytes`, and the hash's first part. */
    fun boardBytes(cells: List<Int>): List<Int> {
        val count = cells.size
        return listOf(count and BYTE, (count shr BITS) and BYTE, (count shr (2 * BITS)) and BYTE, (count shr (3 * BITS)) and BYTE) + cells
    }

    /** `hex(SHA256(borsh(cells) || salt))`: what `commit_board` records. */
    fun compute(
        cells: List<Int>,
        salt: List<Int>,
    ): String {
        if (salt.size != SALT_BYTES) throw BattleshipsException("A salt is $SALT_BYTES bytes.")
        val digest = MessageDigest.getInstance("SHA-256")
        digest.update(boardBytes(cells).map { it.toByte() }.toByteArray())
        digest.update(salt.map { it.toByte() }.toByteArray())
        return Hex.lower(digest.digest().map { it.toInt() and BYTE })
    }

    /** 16 bytes from the platform's secure random source. */
    fun randomSalt(): List<Int> {
        val bytes = ByteArray(SALT_BYTES)
        SecureRandom().nextBytes(bytes)
        return bytes.map { it.toInt() and BYTE }
    }
}

/** Lower-case hex, as the web app writes salts and commitments. */
object Hex {
    private const val RADIX = 16

    fun lower(bytes: List<Int>): String = bytes.joinToString("") { "%02x".format(it and 0xff) }

    fun bytes(hex: String): List<Int>? {
        val clean = hex.trim().lowercase()
        if (clean.length % 2 != 0) return null
        return clean.chunked(2).map { it.toIntOrNull(RADIX) ?: return null }
    }
}

/**
 * A placed fleet as this device keeps it: the cells, the salt (hex) and what was committed. The
 * same JSON as the web app's `StoredBoard` (`app/src/lib/boardStore.ts`). (Swift `StoredBoard`.)
 */
@Serializable
data class StoredBoard(
    val cells: List<Int>,
    val salt: String,
    val commitment: String,
    val savedAt: Double = System.currentTimeMillis().toDouble(),
) {
    val saltBytes: List<Int> get() = Hex.bytes(salt).orEmpty()

    companion object {
        /** A fresh board for [layout]: a new salt and its commitment. */
        fun sealing(
            layout: FleetLayout,
            salt: List<Int> = Commitment.randomSalt(),
        ): StoredBoard {
            val cells = layout.cells
            return StoredBoard(cells, Hex.lower(salt), Commitment.compute(cells, salt))
        }
    }
}

/**
 * Where boards live: on this device only, keyed by the player key and the match, as the web app's
 * `boardKey`. The app's store is private SharedPreferences, excluded from backup; tests use
 * [InMemoryBoardStore]. (Swift `BoardStore`.)
 */
interface BoardStore {
    fun load(
        owner: String,
        matchId: String,
    ): StoredBoard?

    /** False when the store refused it: a fleet that cannot be kept cannot answer shots. */
    fun save(
        board: StoredBoard,
        owner: String,
        matchId: String,
    ): Boolean

    fun clear(
        owner: String,
        matchId: String,
    )

    companion object {
        /** `battleships:board:v1:<owner>:<matchId>`, the web app's key. */
        fun key(
            owner: String,
            matchId: String,
        ): String = "battleships:board:v1:$owner:$matchId"
    }
}

class InMemoryBoardStore : BoardStore {
    private val boards = mutableMapOf<String, StoredBoard>()
    var refuses = false

    @Synchronized
    override fun load(
        owner: String,
        matchId: String,
    ): StoredBoard? = boards[BoardStore.key(owner, matchId)]

    @Synchronized
    override fun save(
        board: StoredBoard,
        owner: String,
        matchId: String,
    ): Boolean {
        if (refuses) return false
        boards[BoardStore.key(owner, matchId)] = board
        return true
    }

    @Synchronized
    override fun clear(
        owner: String,
        matchId: String,
    ) {
        boards.remove(BoardStore.key(owner, matchId))
    }
}
