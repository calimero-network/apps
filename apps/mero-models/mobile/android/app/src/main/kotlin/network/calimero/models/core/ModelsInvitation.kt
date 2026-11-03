package network.calimero.models.core

import com.calimero.mero.app.MeroAppBackend
import com.calimero.mero.app.OrgInvitation
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * An invitation link: kotlin-sdk's [OrgInvitation], the payload every Calimero 1.0 app shares, so a
 * link minted here opens in any client of the package. (Swift `ModelsInvitation`.)
 *
 * - payload: `{"invitation": "inv_…", "namespaceId": "<studio>", "contextId": "<scene>"}`
 * - token: `base58(deflate(payload))` ([InviteCodec])
 * - link: `https://links.calimero.network/com.calimero.mero-models/join?invitation=<token>`
 *
 * The invite token admits to the studio (the organization); `contextId` only says which scene (app
 * instance) to open afterwards.
 */
class ModelsInvitation(
    invitation: OrgInvitation,
    val contextId: String,
) {
    val invitation: OrgInvitation = invitation.copy(contextId = contextId)

    /** The studio it admits to: the organization the node minted the token for. */
    val namespaceId: String get() = invitation.namespaceId

    /** The shareable token. */
    fun token(): String = invitation.encoded()

    /** The shareable link. */
    fun link(): String = invitation.link(ModelsFormat.PACKAGE_NAME)

    companion object {
        /** Mint a link to a scene: an invite token to its studio, plus the scene to open. */
        suspend fun mint(
            backend: MeroAppBackend,
            namespaceId: String,
            contextId: String,
        ): String = ModelsInvitation(backend.createInvitation(namespaceId), contextId).link()

        /** Parse a link (https or `calimero://`), a bare token or the raw JSON. Null for anything else, and another app's link. */
        fun parse(input: String): ModelsInvitation? {
            val trimmed = input.trim()
            if (trimmed.isEmpty()) return null
            if (trimmed.startsWith("{")) return parseJson(trimmed)
            val token = InviteLink.tokenFromPasted(trimmed, ModelsFormat.PACKAGE_NAME) ?: return null
            return InviteCodec.decode(token)?.let(::parseJson)
        }

        /** The payload as JSON: an [OrgInvitation] that names a scene. The node judges the rest; a pre-1.0 signed invitation is refused. */
        fun parseJson(text: String): ModelsInvitation? {
            val invitation = OrgInvitation.decodeJson(text) ?: return null
            val contextId = invitation.contextId?.takeIf { it.isNotEmpty() } ?: return null
            return ModelsInvitation(invitation, contextId)
        }
    }
}

/** Redeeming an invitation link: confirm, join the studio, then open the scene. (Swift `InvitationModel`.) */
class InvitationModel(
    private val attempts: Int = 4,
    private val retryDelayMs: Long = 1_500,
) {
    sealed interface Stage {
        data object Idle : Stage

        data object Confirm : Stage

        data object Joining : Stage

        data class Joined(
            val namespaceId: String,
            val contextId: String,
        ) : Stage

        data class Failed(
            val message: String,
        ) : Stage
    }

    private val _stage = MutableStateFlow<Stage>(Stage.Idle)
    val stage: StateFlow<Stage> = _stage.asStateFlow()

    var invitation: ModelsInvitation? = null
        private set

    /** Read a link or a pasted code. False (and a failed stage) when it is not a Mero Models invitation. */
    fun open(raw: String): Boolean {
        val parsed = ModelsInvitation.parse(raw)
        invitation = parsed
        if (parsed == null) {
            _stage.value = Stage.Failed("This isn't a Mero Models invitation. Check the link and try again.")
            return false
        }
        _stage.value = Stage.Confirm
        return true
    }

    /** Join: redeem the invite token on the node. [backend] is read again after [didJoin], which re-reads what the account sees. */
    suspend fun accept(
        backend: () -> MeroAppBackend?,
        didJoin: suspend () -> Unit,
    ) {
        val invitation = invitation
        val current = backend()
        if (invitation == null || current == null) {
            _stage.value = Stage.Failed("Sign in to join.")
            return
        }
        _stage.value = Stage.Joining
        val namespaceId = invitation.namespaceId
        attempt { current.joinNamespace(namespaceId, invitation.invitation) }.exceptionOrNull()?.let { error ->
            val text = (error.message ?: error.toString()).lowercase()
            if (listOf("already a member", "already member", "already joined").none { it in text }) {
                _stage.value = Stage.Failed(ModelsFormat.errorText(error))
                return
            }
        }
        didJoin()
        // The scene is an app instance of the studio: membership in the org reaches it once the
        // node commits the redemption. Ask a few times.
        for (i in 0 until attempts) {
            if (i > 0) delay(retryDelayMs)
            if (inScene(backend(), invitation.contextId)) break
        }
        _stage.value = Stage.Joined(namespaceId, invitation.contextId)
    }

    /** Whether the account is in the scene now, joining it when it is open. No backend: stop trying. */
    private suspend fun inScene(
        backend: MeroAppBackend?,
        contextId: String,
    ): Boolean {
        if (backend == null) return true
        if (attempt { backend.isMember(contextId) }.getOrDefault(false)) return true
        return attempt { backend.joinContext(contextId) }.isSuccess
    }

    /** Not now, or done. */
    fun reset() {
        invitation = null
        _stage.value = Stage.Idle
    }
}
