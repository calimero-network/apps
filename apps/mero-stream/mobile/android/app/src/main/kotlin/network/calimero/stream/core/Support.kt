package network.calimero.stream.core

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
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.io.IOException

/** Words a person can act on, for any failure the app sees (same copy as iOS). */
object ErrorText {
    @Suppress("CyclomaticComplexMethod")
    fun describe(error: Throwable): String =
        when (error) {
            is StreamException -> error.message.orEmpty()
            is ConfirmCancelled, is PasskeyCancelled -> "The passkey prompt was cancelled. Nothing changed."
            is ConfirmRequired, is PasskeyRequired -> "This needs your passkey. Try again and approve it when asked."
            is ConsentStale -> "That approval is out of date. Refresh and review it again."
            is ReleaseDeadlineError -> {
                val release = if (error.release.isEmpty()) "a node release" else "node release ${error.release}"
                "Your cluster takes no new work until $release is approved. Review it under Needs your approval."
            }
            is NotFound -> "This isn't shared with you, or it was deleted."
            is LoginRequired, is SignedOutException -> "Your session ended. Sign in again."
            is WrongNode -> "This node doesn't serve your stream. Try another node of the cluster."
            is UnavailableError -> "Your cluster is busy (${error.reason}). Try again shortly."
            is AppError -> appError(error)
            is CalimeroError -> error.nodeMessage.ifEmpty { error.code }
            is SerializationException ->
                "The room answered in a shape this app does not read. It may run a different version of Mero Stream."
            is IOException -> "Your cluster can't be reached. Check your connection and try again."
            else -> error.message ?: error.toString()
        }

    /** The room contract's typed refusals (`#[app::error]` in `logic`), in words. */
    private fun appError(error: AppError): String {
        fun field(name: String): String = (error.fields[name] as? JsonPrimitive)?.contentOrNull ?: "?"
        return when (error.appCode) {
            "NotJoined" -> "Join the room before you take part in its call."
            "NotOwner" -> "Only the person who created this room can do that."
            "ZeroDimension", "DimensionTooLarge" -> "The camera picture has a size the room does not take."
            "RawTooLarge", "ChunkTooLarge" -> "A frame was too large for the room (limit ${field("max")} bytes)."
            "RawLengthMismatch", "EmptyChunk" -> "The room refused a frame of the wrong length."
            "BadBase64", "CodecRequired" -> "The room refused a malformed frame."
            "" -> error.nodeMessage.ifEmpty { "The room refused this." }
            else -> error.nodeMessage.ifEmpty { error.appCode }
        }
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
            StreamException("This session can't carry live media yet: it is not connected to the cluster. Sign out and in again.")
    }
}
