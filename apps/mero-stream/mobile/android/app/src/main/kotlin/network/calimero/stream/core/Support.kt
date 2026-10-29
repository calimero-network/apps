package network.calimero.stream.core

import com.calimero.mero.account.NoRelayException
import com.calimero.mero.app.MeroAppBackend
import com.calimero.mero.http.AuthRevokedException
import com.calimero.mero.http.NetworkException
import com.calimero.mero.relay.IntentRefusedException
import kotlinx.serialization.SerializationException
import network.calimero.stream.generated.StreamClient
import java.io.IOException

/**
 * The generated client for one room's call context, over the account's relay. The client is
 * generated against the SDK's own `ContextContractCalling` (`--transport-import`), so the bound
 * contract goes straight in.
 */
fun streamClient(
    backend: MeroAppBackend,
    contextId: String,
): StreamClient = StreamClient(backend.contract.bound(contextId))

/** Words a person can act on, for any failure the app sees (same copy as iOS). */
object ErrorText {
    fun describe(error: Throwable): String =
        when (error) {
            is StreamException -> error.message.orEmpty()
            is NoRelayException -> "No relay serves your account yet. Join a stream with an invitation link first."
            is IntentRefusedException -> "The relay refused this (${error.status}): ${error.reason}"
            is NetworkException -> "The relay can't be reached: ${error.message}"
            is AuthRevokedException -> "Your session was revoked. Sign out and sign in again."
            is SerializationException ->
                "The room answered in a shape this app does not read. It may run a different version of Mero Stream."
            is IOException -> "The relay can't be reached. Check your connection and try again."
            else -> error.message ?: error.toString()
        }
}

/** The app's own failures, with their copy. */
class StreamException(
    message: String,
) : Exception(message) {
    companion object {
        fun noApplication() = StreamException("Mero Stream is not installed for your account yet. Try again in a moment.")

        fun notAnInvitation() = StreamException("That is not a Mero Stream invitation link.")

        fun noRoomContext(name: String) = StreamException("“$name” has no call yet. It may still be replicating; refresh in a moment.")

        fun noPresence() =
            StreamException("This session can't carry live media yet: your relay has no event connection. Sign out and in again.")
    }
}
