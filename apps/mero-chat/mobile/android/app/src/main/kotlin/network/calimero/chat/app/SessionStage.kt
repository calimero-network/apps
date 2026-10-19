package network.calimero.chat.app

import com.calimero.mero.compose.MeroAuthState

/** Where sign-in stands, as the screens need it. Derived from the SDK's [MeroAuthState]. */
sealed interface SessionStage {
    /** Not signed in. [error] is a failed sign-in; [cancelled] a declined one (not an error). */
    data class SignedOut(
        val error: String? = null,
        val cancelled: Boolean = false,
    ) : SessionStage

    /** Not signed in yet, and waiting on the wallet's answer or a restore. */
    data object Connecting : SessionStage

    /**
     * Signed in with a certified device key.
     *
     * - [relayUrl] null: no relay serves the account yet — normal for a new account until it
     *   redeems an invitation.
     * - [live] false with a relay: writes work (warrants carry their own authority) but the
     *   relay's attestation, and with it reads by query and live events, is not there yet.
     */
    data class SignedIn(
        val account: String,
        val relayUrl: String?,
        val live: Boolean,
        val note: String?,
        /** (Re)connecting to the relay right now — after a restore or a join. */
        val connecting: Boolean = false,
    ) : SessionStage {
        val hasRelay: Boolean get() = relayUrl != null
    }
}

fun sessionStage(state: MeroAuthState): SessionStage {
    val account = state.account
    return when {
        // Signed in stays signed in while the client reconnects (after a join, say): the screens
        // must not be torn down for it.
        state.isAuthenticated && account != null ->
            SessionStage.SignedIn(account, state.relayUrl, live = state.sessionReady, note = state.relayNote, connecting = state.isLoading)
        state.isLoading -> SessionStage.Connecting
        else -> SessionStage.SignedOut(error = state.error, cancelled = state.cancelled)
    }
}
