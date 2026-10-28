package network.calimero.calendar.data

import com.calimero.mero.account.NoRelayException
import java.io.IOException

/** A failure in words a person can act on: "Couldn't <doing>. <why>". */
object ErrorText {
    /** [doing] completes "Couldn't …", e.g. "load your teams". */
    fun of(
        error: Throwable,
        doing: String,
    ): String {
        if (error is NoRelayException) return "Your account isn't on a relay yet. Open an invitation link to join a team."
        val message = error.message?.trim().orEmpty()
        return when {
            error is IOException && isOffline(message) -> "You're offline. Couldn't $doing."
            message.contains("owner", ignoreCase = true) && (message.contains("only", ignoreCase = true) || message.contains("not", ignoreCase = true)) ->
                "Only the event's owner can change it."
            message.isEmpty() -> "Couldn't $doing."
            else -> "Couldn't $doing. $message"
        }
    }

    private fun isOffline(message: String): Boolean =
        listOf("Unable to resolve host", "Failed to connect", "Network is unreachable", "timeout", "No address associated").any {
            message.contains(it, ignoreCase = true)
        }
}
