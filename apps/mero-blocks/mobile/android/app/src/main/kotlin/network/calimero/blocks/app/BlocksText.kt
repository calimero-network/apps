package network.calimero.blocks.app

/** The app's fixed values, shared with the web app and the contract's bundle. (Swift `BlocksConstants`.) */
object BlocksConstants {
    /** The bundle's package id (`logic/Cargo.toml`), which is also the invitation link slug. */
    const val PACKAGE_NAME = "com.calimero.mero-blocks"

    /** What a new world is called when the field is left empty (the web app's default). */
    const val DEFAULT_WORLD_NAME = "overworld"

    /** The web app's limits on the two names. */
    const val WORLD_NAME_MAX = 24
    const val PLAYER_NAME_MAX = 16

    /** What a player is called until they pick a name (the web app's default). */
    const val DEFAULT_PLAYER_NAME = "Player"

    /** Seeds are read by the clients as unsigned 32-bit integers (`logic` `init` docs). */
    val SEED_RANGE: ULongRange = 1uL..4_294_967_295uL

    /** Look sensitivity: the game multiplies its drag-to-look speed by this. */
    const val SENSITIVITY_MIN = 0.3
    const val SENSITIVITY_MAX = 3.0
    const val DEFAULT_SENSITIVITY = 1.0
}

/** (Swift `BlocksError`.) */
class BlocksException(
    val kind: Kind,
) : Exception(kind.message) {
    enum class Kind(
        val message: String,
    ) {
        NO_RELAY("Your account has no relay yet. Join a world from an invitation to get one."),
        NO_APPLICATION("Mero Blocks is not published for this account's relay yet."),
        NOT_AN_INVITATION("That doesn't look like a Mero Blocks invitation link."),
        NO_WORLD_IN_INVITATION("The invitation does not reference a world."),
    }
}

object BlocksText {
    /** An error as one sentence. A contract refusal is already written for a player, so it is shown as it came. */
    fun error(error: Throwable): String = error.message?.takeIf { it.isNotBlank() } ?: "Something went wrong talking to the relay."

    /** A readable short form of an id nobody named. */
    fun shortId(id: String): String = if (id.length > 12) "${id.take(6)}…${id.takeLast(4)}" else id

    /** "Nobody playing", "3 playing". */
    fun online(count: Int?): String? =
        when (count) {
            null -> null
            0 -> "Nobody playing"
            else -> "$count playing"
        }

    /** A trimmed player name, never empty, at most the web app's 16 characters. */
    fun playerName(raw: String): String = raw.trim().ifEmpty { BlocksConstants.DEFAULT_PLAYER_NAME }.take(BlocksConstants.PLAYER_NAME_MAX)

    /** A trimmed world name, never empty, at most the web app's 24 characters. */
    fun worldName(raw: String): String = raw.trim().ifEmpty { BlocksConstants.DEFAULT_WORLD_NAME }.take(BlocksConstants.WORLD_NAME_MAX)

    /** The seed typed into the field, or null for "pick one" (empty or not a number in range). */
    fun seed(raw: String): ULong? = raw.trim().toULongOrNull()?.takeIf { it in BlocksConstants.SEED_RANGE }

    fun sensitivity(value: Double): Double = value.coerceIn(BlocksConstants.SENSITIVITY_MIN, BlocksConstants.SENSITIVITY_MAX)
}

internal fun nowSeconds(): ULong = (System.currentTimeMillis() / 1000).toULong()
