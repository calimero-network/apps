package network.calimero.battleships.core

import com.calimero.mero.AppError
import com.calimero.mero.ConfirmCancelled
import com.calimero.mero.ConfirmRequired
import com.calimero.mero.ConsentStale
import com.calimero.mero.LoginRequired
import com.calimero.mero.NotFound
import com.calimero.mero.NotLeader
import com.calimero.mero.PasskeyCancelled
import com.calimero.mero.ReleaseDeadlineError
import com.calimero.mero.UnavailableError
import com.calimero.mero.WrongNode
import com.calimero.mero.app.AppNamespace
import com.calimero.mero.app.MeroAppBackend
import com.calimero.mero.app.PasskeyRequired
import com.calimero.mero.app.SignedOutException
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/** Constants shared with the web app and the bundle. (Swift `Battleships`.) */
object Battleships {
    /** The registry package and invitation-link slug (`PACKAGE` on the web). */
    const val PACKAGE_NAME = "com.calimero.battleships"

    /**
     * How often an open match is re-read: a safety net beside the event stream (a dropped event
     * must not stall a match). A lobby polls at twice this.
     */
    const val POLL_INTERVAL_MS = 5_000L
}

/** Why an action was refused before it reached the node, in words a person can act on. */
class BattleshipsException(
    message: String,
) : Exception(message)

/**
 * What the screens run on: the session's [MeroAppBackend] (Calimero 1.0's `CalimeroAppBackend`),
 * or the demo's. A lobby is an organization with one app instance of the package in it; every
 * match is rows in that instance, keyed by match id. (Swift `BattleshipsBackend`.)
 */
typealias BattleshipsBackend = MeroAppBackend

// ---- Errors in words --------------------------------------------------------------------------

/**
 * Errors as a person reads them: offline, signed out, the cluster busy, or what the contract
 * refused, by its `APP_ERROR` code (the web app's `messageOf`). (Swift `ErrorText`.)
 */
object ErrorText {
    private const val OFFLINE = "You're offline. Check your connection and try again."

    /** The contract's refusals in words, by error code. */
    val appErrors: Map<String, String> =
        mapOf(
            "NotFound" to "That match does not exist in this lobby.",
            "Invalid" to "That is not allowed here.",
            "Forbidden" to "You cannot do that in this match.",
            "Finished" to "This match is already finished.",
            "MatchIdCollision" to "Match id already exists. Try again.",
            "AlreadyCommitted" to "Your fleet is already deployed.",
            "CommitmentMismatch" to "That board does not match the fleet you deployed.",
        )

    @Suppress("ReturnCount", "CyclomaticComplexMethod")
    fun describe(
        error: Throwable,
        fallback: String = "Something went wrong. Try again.",
    ): String =
        when (error) {
            is BattleshipsException -> error.message ?: fallback
            is AppError -> appMessage(error.appCode, error.fields) ?: fallback
            is ConfirmCancelled, is PasskeyCancelled -> "You dismissed the passkey sheet, so nothing changed."
            is ConfirmRequired, is PasskeyRequired -> "Approve this with your passkey to continue."
            is SignedOutException, is LoginRequired -> "Your session ended. Sign in again."
            is WrongNode, is NotLeader, is UnavailableError -> "The cluster is busy. Try again in a moment."
            is ReleaseDeadlineError -> "A node update is waiting for approval. Open Approvals to review it."
            is ConsentStale -> "That approval expired. Start it again."
            is NotFound -> "That's no longer there, or you're not in it."
            is UnknownHostException, is SocketTimeoutException, is java.net.ConnectException, is IOException -> OFFLINE
            else -> fallback
        }

    /** One line for an `APP_ERROR`: its `message` field when it carries one, else the code's words. */
    fun appMessage(
        code: String,
        fields: JsonObject = JsonObject(emptyMap()),
    ): String? {
        val message = fields["message"].stringOrNull()?.trim()
        if (!message.isNullOrEmpty()) {
            val sentence = message.replaceFirstChar { it.uppercase() }
            return if (sentence.endsWith(".")) sentence else "$sentence."
        }
        return appErrors[code]
    }

    /** Whether the contract refused because the match is over. */
    fun isFinished(error: Throwable): Boolean = (error as? AppError)?.appCode == "Finished"

    /** Whether a shot was refused because the opponent has not placed a fleet yet. */
    fun isOpponentNotReady(error: Throwable): Boolean {
        val app = error as? AppError ?: return false
        return app.appCode == "Invalid" &&
            "place ships" in
            app.fields["message"]
                .stringOrNull()
                .orEmpty()
                .lowercase()
    }
}

/** How a person is shown: a short handle from their key, until a name is known. (Swift `Names`.) */
object Names {
    private const val PREFIX = 6
    private const val SUFFIX = 4

    fun short(key: String): String = if (key.length <= PREFIX + SUFFIX) key else "${key.take(PREFIX)}…${key.takeLast(SUFFIX)}"

    /** "You", the name they set in the lobby's organization, or "Player 3fa2c1". */
    fun player(
        key: String,
        me: String?,
        names: Map<String, String> = emptyMap(),
    ): String =
        when {
            me != null && key.equals(me, ignoreCase = true) -> "You"
            !names[key]?.trim().isNullOrEmpty() -> names.getValue(key).trim()
            else -> "Player ${key.take(PREFIX)}"
        }

    fun lobby(namespace: AppNamespace): String = namespace.name?.trim()?.takeIf { it.isNotEmpty() } ?: "Lobby ${namespace.id.take(PREFIX)}"
}

/** Where a screen's first load stands. */
sealed interface LoadPhase {
    data object Loading : LoadPhase

    data object Loaded : LoadPhase

    data class Failed(
        val message: String,
    ) : LoadPhase
}

/**
 * A match as the lobby lists it and the match screen opens it: the lobby's app instance and the
 * match's id in it. (Swift `MatchRef`.)
 */
data class MatchRef(
    val namespaceId: String,
    val appId: String,
    val matchId: String,
    val opponent: String,
)

internal fun JsonElement?.stringOrNull(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

internal fun JsonElement.primitiveContent(): String? = runCatching { jsonPrimitive.contentOrNull }.getOrNull()
