package network.calimero.merraria.app

import com.calimero.mero.app.MeroAppBackend
import com.calimero.mero.http.HttpException
import network.calimero.merraria.generated.MerrariaClient
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
    fun randomSeed(): ULong = Random.nextLong(1, MAX_RANDOM_SEED + 1).toULong()

    /** A seed typed by the player, as the web app reads it: `abs(floor(n))`, else [fallback]. */
    fun seed(
        text: String,
        fallback: ULong,
    ): ULong {
        val value = text.trim().toDoubleOrNull()?.takeIf { it.isFinite() } ?: return fallback
        val whole = abs(floor(value))
        return if (whole >= 1 && whole < MAX_SEED) whole.toLong().toULong() else fallback
    }

    fun clampZoom(value: Double): Double = value.coerceIn(MIN_ZOOM, MAX_ZOOM)
}

/** Seconds since the epoch: every `now` the contract takes (the web app's `nowSecs`). */
fun nowSeconds(): ULong = (System.currentTimeMillis() / 1000).toULong()

class MerrariaException(
    val kind: Kind,
) : Exception(kind.message) {
    enum class Kind(
        val message: String,
    ) {
        NO_RELAY("Your account has no relay yet. Join a world from an invitation link first."),
        NO_APPLICATION("Merraria is still being looked up in the app registry. Try again in a moment."),
        NOT_AN_INVITATION("That is not a Merraria invitation link."),
        NO_WORLD("The invitation does not name a world, and none was found in it yet. Try again in a moment."),
        NO_NAMESPACE("This world's namespace is not known on this device yet. Refresh the list and try again."),
    }
}

/** Player-facing copy shared by both platforms. (Swift `MerrariaText`.) */
object MerrariaText {
    /** An error as one readable sentence. */
    fun error(error: Throwable): String {
        if (error is HttpException) {
            val body = error.bodyText.take(200)
            return if (body.isBlank()) error.message.orEmpty() else "${error.message} ($body)"
        }
        return error.message?.takeIf { it.isNotBlank() } ?: error.toString()
    }

    /** `ab12…cd34` for an id. */
    fun shortId(id: String): String = if (id.length <= 12) id else "${id.take(6)}…${id.takeLast(4)}"

    fun players(count: Int): String = if (count == 1) "1 player" else "$count players"
}

/** [MerrariaClient] for [contextId] in the account's backend. */
fun MeroAppBackend.merraria(contextId: String): MerrariaClient = MerrariaClient(contract.bound(contextId))
