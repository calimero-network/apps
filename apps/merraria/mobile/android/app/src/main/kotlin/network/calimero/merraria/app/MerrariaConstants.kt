package network.calimero.merraria.app

import com.calimero.mero.AppError
import com.calimero.mero.CalimeroError
import com.calimero.mero.ConfirmCancelled
import com.calimero.mero.ConsentStale
import com.calimero.mero.LoginRequired
import com.calimero.mero.NotFound
import com.calimero.mero.PasskeyCancelled
import com.calimero.mero.ReleaseDeadlineError
import com.calimero.mero.TrapError
import com.calimero.mero.UnavailableError
import com.calimero.mero.WrongNode
import com.calimero.mero.app.MeroAppBackend
import com.calimero.mero.app.PasskeyRequired
import com.calimero.mero.app.SignedOutException
import com.calimero.mero.tee.TeeTrustException
import network.calimero.merraria.contract.MerrariaRefusal
import network.calimero.merraria.generated.MerrariaClient
import java.io.IOException
import kotlin.math.abs
import kotlin.math.floor
import kotlin.random.Random

/** App-wide constants. Same values as the iOS app's `MerrariaConstants`. */
object MerrariaConstants {
    /** The contract's package, which is also the invitation links' slug (`logic/Cargo.toml`). */
    const val PACKAGE_NAME = "com.calimero.merraria"

    // The web app's defaults (`app/src/ui/landing.ts`).
    const val DEFAULT_WORLD_NAME = "surface"
    const val DEFAULT_PLAYER_NAME = "Player"
    const val MAX_WORLD_NAME = 24
    const val MAX_PLAYER_NAME = 16

    /** The game's view scale on a phone: tiles a thumb can hit (the web's 0.6–1.6 range). */
    const val DEFAULT_ZOOM = 1.3
    const val MIN_ZOOM = 0.6
    const val MAX_ZOOM = 1.6

    private const val MAX_RANDOM_SEED = 999_999L
    private const val MAX_SEED = 4_294_967_295.0

    /** A seed for a new world: positive, small enough for the engine's 32-bit noise. */
    fun randomSeed(): UInt = Random.nextLong(1, MAX_RANDOM_SEED + 1).toUInt()

    /** A seed typed by the player, as the web app reads it: `abs(floor(n))`, else [fallback]. */
    fun seed(
        text: String,
        fallback: UInt,
    ): UInt {
        val value = text.trim().toDoubleOrNull()?.takeIf { it.isFinite() } ?: return fallback
        val whole = abs(floor(value))
        return if (whole >= 1 && whole < MAX_SEED) whole.toLong().toUInt() else fallback
    }

    fun clampZoom(value: Double): Double = value.coerceIn(MIN_ZOOM, MAX_ZOOM)
}

/** Seconds since the epoch: every `now` the contract takes, a u32 (the web app's `nowSecs`). */
fun nowSeconds(): UInt = u32(System.currentTimeMillis() / 1000.0)

/** A page's `now` (seconds, a JSON number) as the contract's u32: whole seconds, clamped. */
fun u32(seconds: Double): UInt =
    when {
        !seconds.isFinite() || seconds <= 0 -> 0u
        seconds >= UInt.MAX_VALUE.toDouble() -> UInt.MAX_VALUE
        else -> seconds.toLong().toUInt()
    }

class MerrariaException(
    val kind: Kind,
) : Exception(kind.message) {
    enum class Kind(
        val message: String,
    ) {
        SIGNED_OUT("You're signed out. Sign in again to play."),
        NO_APPLICATION("Merraria is not published on this cluster yet."),
        NOT_AN_INVITATION("That is not a Merraria invitation link."),
        NO_WORLD("The invitation does not name a world, and none was found in it yet. Try again in a moment."),
        NO_NAMESPACE("This world's organization is not known on this device yet. Refresh the list and try again."),
    }
}

/** Player-facing copy shared by both platforms. (Swift `MerrariaText`.) */
object MerrariaText {
    /** An error as one readable sentence: the node's typed errors and the contract's refusals in words. */
    @Suppress("CyclomaticComplexMethod")
    fun error(error: Throwable): String =
        when (error) {
            is ReleaseDeadlineError -> {
                val release = if (error.release.isEmpty()) "a node release" else "node release ${error.release}"
                "Your cluster takes no new work until $release is approved. Review it under Needs your approval."
            }
            is NotFound -> "This isn't shared with you, or it was deleted."
            is LoginRequired -> "Your session ended. Sign in again."
            is SignedOutException -> "You're signed out. Sign in again to play."
            is WrongNode -> "This node doesn't serve your world. Try another node of the cluster."
            is UnavailableError -> "Your cluster is busy (${error.reason}). Try again shortly."
            is TrapError -> "The world stopped that action (${error.kind.ifEmpty { "trap" }}). Try again."
            is AppError -> MerrariaRefusal.message(error.appCode, error.fields) ?: error.nodeMessage.ifEmpty { error.appCode }
            is ConsentStale -> "That approval is out of date. Refresh and review it again."
            is ConfirmCancelled, is PasskeyCancelled -> "Cancelled. Nothing was sent."
            is PasskeyRequired -> "This needs your passkey. Keep the app open and try again."
            is TeeTrustException -> "The node did not prove it runs attested Calimero software, so nothing was sent."
            is CalimeroError -> error.nodeMessage.ifEmpty { error.code }
            is IOException -> "Can't reach your cluster. Check your connection and try again."
            else -> error.message?.takeIf { it.isNotBlank() } ?: error.toString()
        }

    /** `ab12…cd34` for an id. */
    fun shortId(id: String): String = if (id.length <= 12) id else "${id.take(6)}…${id.takeLast(4)}"

    fun players(count: Int): String = if (count == 1) "1 player" else "$count players"
}

/** [MerrariaClient] for [contextId] in the account's backend. */
fun MeroAppBackend.merraria(contextId: String): MerrariaClient = MerrariaClient(this, contextId)
