package network.calimero.updates.core

import com.calimero.mero.AppError
import com.calimero.mero.CalimeroError
import com.calimero.mero.ConfirmCancelled
import com.calimero.mero.ConsentStale
import com.calimero.mero.LoginRequired
import com.calimero.mero.PasskeyCancelled
import com.calimero.mero.ReleaseDeadlineError
import com.calimero.mero.UnavailableError
import com.calimero.mero.WrongNode
import com.calimero.mero.app.ContextContractCalling
import com.calimero.mero.app.MeroAppBackend
import com.calimero.mero.app.PasskeyRequired
import com.calimero.mero.app.SignedOutException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import network.calimero.updates.generated.client.UpdatesClient
import java.io.IOException

/** The client for one audience (an app instance), over the account's cluster session. */
fun updatesClient(
    backend: MeroAppBackend,
    contextId: String,
): UpdatesClient {
    // The SDK's bound contract, each request off the main thread.
    val bound = backend.contract.bound(contextId)
    return UpdatesClient(
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

/** Words a person can act on, for any failure the app sees. */
object ErrorText {
    @Suppress("CyclomaticComplexMethod")
    fun describe(error: Throwable): String =
        when (error) {
            is SignedOutException -> "You're signed out. Sign in again."
            is LoginRequired -> "Your session ended. Sign in again."
            is ConfirmCancelled, is PasskeyCancelled -> "The passkey prompt was cancelled, so nothing changed."
            is PasskeyRequired -> "This needs your passkey. Open the app again and retry."
            is WrongNode -> "That node can't serve your account right now. Sign in again to reach your cluster."
            is ReleaseDeadlineError -> "A newer node release needs approval before anything can change. Review it under Approvals."
            is ConsentStale -> "That approval request is out of date. Try again."
            is UnavailableError -> "The cluster is busy (${error.reason}). Try again in a moment."
            is AppError -> appError(error.appCode, (error.fields["message"] as? JsonPrimitive)?.contentOrNull.orEmpty())
            is CalimeroError -> error.nodeMessage.ifBlank { "The node refused this (${error.code})." }
            is SerializationException ->
                "The audience answered in a shape this app does not read. It may run a different version of Mero Updates."
            is IOException -> "The cluster can't be reached. Check your connection and try again."
            else -> error.message ?: error.toString()
        }

    /** The contract's refusals (`422 APP_ERROR {code, fields: {message}}`): `NotFound`, `Invalid` and `Forbidden`. */
    fun appError(
        code: String,
        message: String,
    ): String {
        val text = message.trim()
        if (text.isNotEmpty()) {
            val s = text.replaceFirstChar { it.uppercase() }
            return if (s.endsWith(".")) s else "$s."
        }
        return when (code) {
            "NotFound" -> "That is no longer here. It may have been deleted."
            "Forbidden" -> "Only the company's team can do that."
            "Invalid" -> "Check what you entered and try again."
            else -> "Mero Updates refused that ($code)."
        }
    }
}

sealed class UpdatesException(
    message: String,
) : Exception(message) {
    class NoApplication : UpdatesException("Mero Updates is not installed for your account yet. Try again in a moment.")

    class NotAnInvitation : UpdatesException("That is not a Mero Updates invitation link.")

    class NoAudienceContext(
        name: String,
    ) : UpdatesException("“$name” has no audience context yet. It may still be syncing — refresh in a moment.")
}

/** The contract's input limits, mirrored so a field stops where the contract would refuse. */
object Limits {
    const val TITLE = 200
    const val SUMMARY = 1000
    const val NAME = 64
    const val CATEGORY_NAME = 80
    const val EMOJI = 8
    const val COMPANY_NAME = 64
    const val MAX_ASKS = 10
}
