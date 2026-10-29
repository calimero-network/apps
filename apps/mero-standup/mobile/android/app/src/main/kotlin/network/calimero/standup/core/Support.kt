package network.calimero.standup.core

import com.calimero.mero.account.NoRelayException
import com.calimero.mero.app.MeroAppBackend
import com.calimero.mero.http.AuthRevokedException
import com.calimero.mero.http.NetworkException
import com.calimero.mero.relay.IntentRefusedException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import network.calimero.standup.generated.ContextContractCalling
import network.calimero.standup.generated.StandupClient
import java.io.IOException

/** The client for one team, over the account's relay. */
fun standupClient(
    backend: MeroAppBackend,
    contextId: String,
): StandupClient {
    // The generated client declares its own `ContextContractCalling`; the SDK's bound contract
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

/** Words a person can act on, for any failure the app sees. */
object ErrorText {
    fun describe(error: Throwable): String =
        when (error) {
            is NoRelayException -> "No relay serves your account yet. Join a team with an invitation link first."
            is IntentRefusedException -> "The relay refused this (${error.status}): ${error.reason}"
            is NetworkException -> "The relay can't be reached: ${error.message}"
            is AuthRevokedException -> "Your session was revoked. Sign out and sign in again."
            is SerializationException ->
                "The team answered in a shape this app does not read. It may run a different version of Mero Standup."
            is IOException -> "The relay can't be reached. Check your connection and try again."
            else -> error.message ?: error.toString()
        }
}
