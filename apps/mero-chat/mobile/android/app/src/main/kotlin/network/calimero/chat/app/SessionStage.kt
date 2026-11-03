package network.calimero.chat.app

/** Where sign-in stands, as the screens need it. */
sealed interface SessionStage {
    /** Not signed in. [error] is why the last attempt failed, in words. */
    data class SignedOut(
        val error: String? = null,
    ) : SessionStage

    /** Restoring a stored session, or a sign-in is running. */
    data object Connecting : SessionStage

    /** Signed in on a Calimero 1.0 cluster. */
    data class SignedIn(
        val account: String,
        /** The node the session talks to. */
        val node: String?,
        /** A development node (`merod local`, mock attestation). */
        val development: Boolean,
    ) : SessionStage
}
