package network.calimero.chat.data

import com.calimero.mero.AppError
import com.calimero.mero.CalimeroError
import com.calimero.mero.ConfirmCancelled
import com.calimero.mero.ConfirmRequired
import com.calimero.mero.ConsentStale
import com.calimero.mero.DirectoryError
import com.calimero.mero.LoginRequired
import com.calimero.mero.NotFound
import com.calimero.mero.PasskeyCancelled
import com.calimero.mero.ReleaseDeadlineError
import com.calimero.mero.UnavailableError
import com.calimero.mero.WrongNode
import com.calimero.mero.app.PasskeyRequired
import com.calimero.mero.app.SignedOutException
import com.calimero.mero.tee.TeeTrustException
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.io.IOException
import java.net.UnknownHostException

/**
 * What to tell a person about [error], in words they can act on: the node's typed 1.0 errors, and
 * the contract's `APP_ERROR` codes (`Invalid`, `Forbidden`, `NotFound`, `Banned`), which carry v1's
 * text in `message`. (Swift `ChatErrorText`.)
 */
@Suppress("CyclomaticComplexMethod")
fun describeChatError(error: Throwable): String =
    when (error) {
        is ChatNotReadyException -> error.message.orEmpty()
        is ConfirmCancelled, is PasskeyCancelled -> "You dismissed the passkey prompt, so nothing changed."
        is ConfirmRequired, is PasskeyRequired -> "That needs your passkey. Open the app and try again."
        is LoginRequired, is SignedOutException -> "Your session ended. Sign in again."
        is ReleaseDeadlineError -> "A newer node release needs approval before anything can change. Review it under Approvals."
        is ConsentStale -> "That approval request is out of date. Try again."
        is NotFound -> "This isn't available to you (yet)."
        is WrongNode -> "This node runs a release your account hasn't approved. Try another node of the cluster."
        is UnavailableError -> "Your cluster can't be reached right now. Try again shortly."
        is AppError -> appErrorText(error.appCode, (error.fields["message"] as? JsonPrimitive)?.contentOrNull)
        is CalimeroError -> error.nodeMessage.ifEmpty { error.code }
        is DirectoryError -> "No cluster called \"${error.cluster}\" was found. Check the name, or paste a node address."
        is TeeTrustException -> "The node could not be verified: ${error.message}"
        is UnknownHostException -> "You're offline. Check your connection and try again."
        is IOException -> "Your cluster can't be reached. Check your connection and try again."
        else -> error.message ?: error.toString()
    }

/** The contract's refusal: its own words when it sent them, else words for the code. */
fun appErrorText(
    code: String,
    message: String?,
): String {
    if (!message.isNullOrEmpty()) return message
    return when (code) {
        "Forbidden" -> "You can't do that in this channel."
        "Banned" -> "You've been removed from this channel."
        "NotFound" -> "That message no longer exists."
        "Invalid", "" -> "The channel refused that request."
        else -> code
    }
}
