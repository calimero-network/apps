package network.calimero.chat.data

import com.calimero.mero.account.InvitationNotClaimableException
import com.calimero.mero.account.JoinException
import com.calimero.mero.account.JoinStep
import com.calimero.mero.account.NoRelayException
import com.calimero.mero.account.NotForAccountException
import com.calimero.mero.http.ErrorKind
import com.calimero.mero.http.classifyError
import com.calimero.mero.relay.IntentRefusedException

/**
 * What to tell a person about [error], in words they can act on. The SDK's own refusals keep the
 * reason the relay or node gave, because that reason is usually the only useful part.
 */
@Suppress("CyclomaticComplexMethod")
fun describeChatError(error: Throwable): String =
    when (error) {
        is ChatNotReadyException -> error.message.orEmpty()
        is NoRelayException ->
            "No relay serves your account yet. Join a workspace from an invitation link, or create one."
        is NotForAccountException -> "That needs a node of your own; it is not available for a Calimero account."
        is IntentRefusedException ->
            if (error.retryable) {
                "The relay turned that down (${error.reason}). Try again."
            } else {
                "The relay turned that down: ${error.reason}"
            }
        is JoinException -> describeJoinFailure(error)
        is InvitationNotClaimableException ->
            if (error.notHosted) {
                "No one could join with an invitation yet: the cloud is not hosting this workspace. Try again in a moment."
            } else {
                "No relay the cloud knows for this workspace would let an invitee in, so an invitation would not work."
            }
        else -> describeTransportError(error)
    }

private fun describeJoinFailure(error: JoinException): String =
    when (error.step) {
        JoinStep.NO_CREDENTIAL -> "Sign in with your Calimero account first, then open the invitation again."
        JoinStep.ADMITTERS_LOOKUP -> "Couldn't ask the Calimero cloud who can let you in. Check your connection and try again."
        JoinStep.NO_NODES -> "No one is hosting this workspace right now, so there is nobody to let you in. Try again later."
        JoinStep.NOT_INVITED -> "This invitation doesn't name anyone who can let you in any more. Ask for a new link."
        JoinStep.INVITED_UNREACHABLE, JoinStep.NO_RELAY_URL ->
            "The relay that can let you in isn't reachable yet. Try again in a moment."
        JoinStep.SIGN -> "Couldn't sign the join on this device: ${error.message}"
        JoinStep.ADMIT -> "The relay refused the join: ${error.message}"
    }

private fun describeTransportError(error: Throwable): String {
    val c = classifyError(error)
    return when (c.kind) {
        ErrorKind.UNREACHABLE -> "Can't reach your relay. Check your connection and try again."
        ErrorKind.UNAUTHORIZED -> "Your relay session lapsed. Sign out and sign in again if this keeps happening."
        ErrorKind.FORBIDDEN -> "Not allowed: ${c.message}"
        ErrorKind.NOT_FOUND -> "Not found on your relay yet. It may still be syncing; try again shortly."
        ErrorKind.UNAVAILABLE, ErrorKind.RATE_LIMITED -> "Your relay is busy right now. Try again shortly."
        else -> c.message.ifEmpty { error.toString() }
    }
}
