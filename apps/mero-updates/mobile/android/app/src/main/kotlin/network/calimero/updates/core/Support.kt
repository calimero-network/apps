package network.calimero.updates.core

import com.calimero.mero.account.NoRelayException
import com.calimero.mero.app.MeroAppBackend
import com.calimero.mero.http.AuthRevokedException
import com.calimero.mero.http.NetworkException
import com.calimero.mero.relay.IntentRefusedException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import network.calimero.updates.generated.ContextContractCalling
import network.calimero.updates.generated.UpdatesClient
import java.io.IOException

/** The client for one audience, over the account's relay. */
fun updatesClient(
    backend: MeroAppBackend,
    contextId: String,
): UpdatesClient {
    // The generated client declares its own `ContextContractCalling`; the SDK's bound contract
    // has exactly its two methods.
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
    fun describe(error: Throwable): String =
        when (error) {
            is NoRelayException -> "No relay serves your account yet. Join a company with an invitation link first."
            is IntentRefusedException -> "The relay refused this (${error.status}): ${error.reason}"
            is NetworkException -> "The relay can't be reached: ${error.message}"
            is AuthRevokedException -> "Your session was revoked. Sign out and sign in again."
            is SerializationException ->
                "The audience answered in a shape this app does not read. It may run a different version of Mero Updates."
            is IOException -> "The relay can't be reached. Check your connection and try again."
            else -> error.message ?: error.toString()
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
