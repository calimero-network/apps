package network.calimero.sheets.app

import com.calimero.mero.AppError
import com.calimero.mero.CalimeroError
import com.calimero.mero.ConfirmCancelled
import com.calimero.mero.ConsentStale
import com.calimero.mero.LoginRequired
import com.calimero.mero.PasskeyCancelled
import com.calimero.mero.ReleaseDeadlineError
import com.calimero.mero.UnavailableError
import com.calimero.mero.WrongNode
import com.calimero.mero.tee.TeeTrustException
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.io.IOException

/** Calimero 1.0's errors in plain words, for sign-in and approvals. (iOS `CloudErrorText`.) */
object CloudErrorText {
    @Suppress("CyclomaticComplexMethod")
    fun describe(error: Throwable): String =
        when (error) {
            is PasskeyCancelled, is ConfirmCancelled -> "You cancelled the passkey prompt, so nothing changed."
            is LoginRequired -> "Your session ended. Sign in again."
            is WrongNode -> "This node can't serve your account right now. Try again."
            is UnavailableError -> "The cluster is busy (${error.reason}). Try again in a moment."
            is ReleaseDeadlineError ->
                if (error.release.isEmpty()) "A node release needs your approval first." else "Node release ${error.release} needs your approval first."
            is ConsentStale -> "That approval expired. Start it again."
            is AppError ->
                (error.fields["message"] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }
                    ?: error.appCode.ifEmpty { error.nodeMessage }
            is CalimeroError -> error.nodeMessage.ifBlank { error.code }
            is TeeTrustException -> "The node could not be verified: ${error.message}"
            is IOException -> "Can't reach the cluster. Check the address and try again."
            else -> error.message?.takeIf { it.isNotBlank() } ?: "Something went wrong. Try again."
        }
}
