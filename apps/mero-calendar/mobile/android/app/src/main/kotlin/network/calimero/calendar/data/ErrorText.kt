package network.calimero.calendar.data

import com.calimero.mero.AppError
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
import kotlinx.serialization.json.JsonPrimitive
import network.calimero.calendar.contract.CalendarAppCode
import java.io.IOException

/** A failure in words a person can act on: "Couldn't <doing>. <why>". (iOS `ErrorText`.) */
object ErrorText {
    /** [doing] completes "Couldn't …", e.g. "load your teams". */
    fun of(
        error: Throwable,
        doing: String,
    ): String {
        if (error is AppError) return app(error)
        cluster(error)?.let { return it }
        val message = error.message?.trim().orEmpty()
        return when {
            error is IOException && isOffline(message) -> "You're offline. Couldn't $doing."
            message.isEmpty() -> "Couldn't $doing."
            else -> "Couldn't $doing. ${message.take(MAX_DETAIL)}"
        }
    }

    /** The calendar contract's refusals (`APP_ERROR` with its `{ code, fields }`). */
    fun app(error: AppError): String =
        when (CalendarAppCode.of(error.appCode)) {
            CalendarAppCode.NOT_FOUND -> "That event no longer exists. It may have been deleted."
            CalendarAppCode.FORBIDDEN -> "Only the event's owner can change it."
            CalendarAppCode.INVALID -> {
                val detail = (error.fields["message"] as? JsonPrimitive)?.content.orEmpty()
                if (detail.isEmpty()) "That isn't valid." else "That isn't valid: $detail."
            }
            CalendarAppCode.LINK_EXISTS -> "A booking link already exists for this token."
            CalendarAppCode.ALREADY_BOOKED -> "This link already booked a meeting. Reschedule it instead."
            CalendarAppCode.LINK_CANCELLED -> "This link's meeting was cancelled. Ask for a new link."
            CalendarAppCode.LINK_EXPIRED -> "This booking link has expired."
            CalendarAppCode.NOT_BOOKED -> "This link has no booked meeting."
            CalendarAppCode.SLOT_UNAVAILABLE -> "That time isn't available."
            null -> error.nodeMessage.ifEmpty { "The calendar refused that." }
        }

    /** The Calimero 1.0 node's typed errors, in words. */
    private fun cluster(error: Throwable): String? =
        when (error) {
            is SignedOutException -> "You're signed out. Sign in again."
            is ConfirmCancelled, is PasskeyCancelled -> "The passkey prompt was cancelled."
            is PasskeyRequired, is ConfirmRequired -> "This needs your passkey. Sign in again and retry."
            is LoginRequired -> "Your session ended. Sign in again."
            is WrongNode -> "This node can't serve your account right now. Try again shortly."
            is ReleaseDeadlineError -> "A newer node release needs approval before anything can change. Review it under Your teams."
            is ConsentStale -> "That approval request is out of date. Try again."
            is NotFound -> "This isn't available to you (yet)."
            is UnavailableError -> "Your cluster is unavailable right now (${error.reason}). Try again shortly."
            else -> null
        }

    private fun isOffline(message: String): Boolean =
        listOf("Unable to resolve host", "Failed to connect", "Network is unreachable", "timeout", "No address associated").any {
            message.contains(it, ignoreCase = true)
        }

    private const val MAX_DETAIL = 160
}
