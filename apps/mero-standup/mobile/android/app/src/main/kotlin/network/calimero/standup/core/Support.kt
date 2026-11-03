package network.calimero.standup.core

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
import com.calimero.mero.app.MeroAppBackend
import com.calimero.mero.app.PasskeyRequired
import com.calimero.mero.app.SignedOutException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonPrimitive
import network.calimero.standup.contract.ContextContractCalling
import network.calimero.standup.contract.StandupAppCode
import network.calimero.standup.contract.StandupClient
import java.io.IOException

/** The client for one team (app instance), over the account's cluster session. */
fun standupClient(
    backend: MeroAppBackend,
    contextId: String,
): StandupClient {
    // The contract client declares its own `ContextContractCalling`; the SDK's bound contract
    // has exactly its two methods.
    val bound = backend.contract.bound(contextId)
    return StandupClient(
        object : ContextContractCalling {
            override suspend fun query(
                method: String,
                argsJson: String,
            ): String = withContext(Dispatchers.IO) { bound.query(method, argsJson) }

            override suspend fun execute(
                method: String,
                argsJson: String,
            ): String = withContext(Dispatchers.IO) { bound.execute(method, argsJson) }
        },
    )
}

/** Words a person can act on, for any failure the app sees. (iOS `ErrorText`.) */
object ErrorText {
    @Suppress("CyclomaticComplexMethod")
    fun describe(error: Throwable): String =
        when (error) {
            is AppError -> app(error)
            is SignedOutException -> "You're signed out. Sign in again to reach your team."
            is ConfirmCancelled, is PasskeyCancelled -> "The passkey prompt was cancelled."
            is PasskeyRequired, is ConfirmRequired -> "This needs your passkey. Sign in again and retry."
            is LoginRequired -> "Your session ended. Sign in again."
            is WrongNode -> "This node can't serve your account right now. Try again shortly."
            is ReleaseDeadlineError -> "A newer node release needs approval before anything can change. Review it under Teams."
            is ConsentStale -> "That approval request is out of date. Try again."
            is NotFound -> "This team isn't available to you (yet)."
            is UnavailableError -> "Your cluster is unavailable right now (${error.reason}). Try again shortly."
            is CalimeroError -> "The node refused this (${error.status}): ${error.nodeMessage.ifEmpty { error.code }}"
            is SerializationException ->
                "The team answered in a shape this app does not read. It may run a different version of Mero Standup."
            is IOException -> "Your cluster can't be reached. Check your connection and try again."
            else -> error.message ?: error.toString()
        }

    /** The standup contract's refusals (`APP_ERROR` with its `{ code, fields }`). */
    fun app(error: AppError): String {
        fun field(name: String) = (error.fields[name] as? JsonPrimitive)?.content.orEmpty()
        val label = field("field").replaceFirstChar { it.uppercase() }.ifEmpty { "That field" }
        return when (StandupAppCode.of(error.appCode)) {
            StandupAppCode.NOT_A_DATE -> "${field("day").ifEmpty { "That" }} isn't a day."
            StandupAppCode.TOO_LONG -> {
                val limit = field("limit")
                "$label is too long${if (limit.isEmpty()) "" else " (at most $limit characters)"}."
            }
            StandupAppCode.EMPTY -> "$label can't be empty."
            StandupAppCode.TOO_MANY -> "Too many ${field("field").ifEmpty { "items" }}."
            StandupAppCode.NO_UPDATE -> "You haven't posted an update for that day."
            StandupAppCode.NO_SUCH_UPDATE -> "That update no longer exists."
            StandupAppCode.NO_BLOCKER -> "That update has no blocker to help with."
            StandupAppCode.OWN_BLOCKER -> "You can't offer help with your own blocker."
            StandupAppCode.NO_HELP -> "You haven't offered help there."
            StandupAppCode.NO_SUCH_DECISION -> "That decision no longer exists."
            StandupAppCode.ALREADY_SUPERSEDED -> "That decision was already replaced by a newer one."
            null -> error.nodeMessage.ifEmpty { error.appCode }
        }
    }
}
