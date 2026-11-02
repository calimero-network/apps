package network.calimero.blocks.app

import com.calimero.mero.AppError
import com.calimero.mero.CalimeroError
import com.calimero.mero.ConfirmCancelled
import com.calimero.mero.ConfirmRequired
import com.calimero.mero.ConsentStale
import com.calimero.mero.LoginRequired
import com.calimero.mero.NotFound
import com.calimero.mero.PasskeyCancelled
import com.calimero.mero.ReleaseDeadlineError
import com.calimero.mero.UnavailableError
import com.calimero.mero.WrongNode
import com.calimero.mero.app.PasskeyRequired
import com.calimero.mero.app.SignedOutException
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.io.IOException

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
        NO_RELAY("You're signed out. Sign in again to play."),
        NO_APPLICATION("Mero Blocks is not published on this cluster yet."),
        NOT_AN_INVITATION("That doesn't look like a Mero Blocks invitation link."),
        NO_WORLD_IN_INVITATION("The invitation does not reference a world."),
    }
}

object BlocksText {
    /** An error as one sentence, in the same words as iOS. */
    @Suppress("CyclomaticComplexMethod")
    fun error(error: Throwable): String =
        when (error) {
            is ConfirmCancelled, is PasskeyCancelled -> "The passkey prompt was cancelled. Nothing changed."
            is ConfirmRequired, is PasskeyRequired -> "This needs your passkey. Try again and approve it when asked."
            is ConsentStale -> "That approval is out of date. Refresh and review it again."
            is ReleaseDeadlineError -> {
                val release = if (error.release.isEmpty()) "a node release" else "node release ${error.release}"
                "Your cluster takes no new work until $release is approved. Review it under Needs your approval."
            }
            is NotFound -> "This isn't shared with you, or it was deleted."
            is LoginRequired, is SignedOutException -> "Your session ended. Sign in again."
            is WrongNode -> "This node doesn't serve your world. Try another node of the cluster."
            is UnavailableError -> "Your cluster is busy (${error.reason}). Try again shortly."
            is AppError -> appError(error)
            is CalimeroError -> error.nodeMessage.ifEmpty { error.code }
            is IOException -> "Your cluster can't be reached. Check your connection and try again."
            else -> error.message?.takeIf { it.isNotBlank() } ?: "Something went wrong talking to your cluster."
        }

    /** The world contract's typed refusals (`#[app::error]` in `logic`), in words. */
    private fun appError(error: AppError): String {
        fun field(name: String): String = (error.fields[name] as? JsonPrimitive)?.contentOrNull ?: "?"
        return when (error.appCode) {
            "TooManyEdits" -> "Too many block changes at once (at most ${field("max")}). Try again."
            "TooManyDevices" -> "Your account is already playing on ${field("max")} devices in this world."
            "BadDevice" -> "This device's name is not one the world takes."
            "Uninitialized" -> "This world is not set up yet. Try again in a moment."
            "" -> error.nodeMessage.ifEmpty { "The world refused this." }
            else -> error.nodeMessage.ifEmpty { error.appCode }
        }
    }

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
