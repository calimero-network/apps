package network.calimero.vote.core

import com.calimero.mero.app.MeroAppBackend
import com.calimero.mero.app.OrgInvitation
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.net.URI
import java.net.URLDecoder

/**
 * An invitation: Calimero 1.0's org invite token. Two link shapes open it (Swift `VoteInvitation`):
 *
 * - the SDK's (what this app mints, [OrgInvitation]):
 *   `https://links.calimero.network/com.calimero.mero-vote/join?invitation=<base58(deflate(payload))>`,
 *   payload `{"invitation": "inv_…", "namespaceId": "<org>", "contextId": "<app instance>"}`;
 * - the web app's: its own address with `?invite=inv_…` (the token alone).
 *
 * The token grants the ORG (redeemed with `POST /invites/{token}/redeem`, which joins the org it
 * belongs to); [contextId], when the link names one, says which voting group in it to open once
 * joined, and otherwise the org's first one opens. A pre-1.0 signed invitation is refused: a 1.0
 * cluster cannot redeem it.
 */
data class VoteInvitation(
    val invitation: OrgInvitation,
    /** The voting group to open after joining; null for a web link. */
    val contextId: String?,
) {
    /** The org it admits to; empty for a web link (the node names it when it is redeemed). */
    val namespaceId: String get() = invitation.namespaceId

    fun token(): String = invitation.copy(contextId = contextId).encoded()

    fun link(): String = InviteLink.invitation(token(), VoteConstants.PACKAGE_NAME)

    companion object {
        /** The query parameter the web app's links carry the token in. */
        const val WEB_PARAM = "invite"

        /**
         * Parse a link (https or `calimero://`), a bare code, a bare `inv_…` token or raw JSON. Null
         * when it holds no Mero Vote invitation, including another app's link.
         */
        fun parse(input: String): VoteInvitation? {
            val trimmed = input.trim()
            if (trimmed.isEmpty()) return null
            if (trimmed.startsWith("{")) return parseJson(trimmed)
            if (trimmed.startsWith("inv_") && trimmed.none { it.isWhitespace() || it == '/' || it == '?' }) {
                return VoteInvitation(OrgInvitation("", trimmed), null)
            }
            webToken(trimmed)?.let { return VoteInvitation(OrgInvitation("", it), null) }
            val token = tokenFromLink(trimmed) ?: return null
            return InviteCodec.decode(token)?.let(::parseJson)
        }

        /** The web app's `?invite=inv_…`, from an http(s) link. */
        internal fun webToken(raw: String): String? {
            val uri = runCatching { URI(raw) }.getOrNull() ?: return null
            if (uri.scheme?.lowercase() !in setOf("http", "https")) return null
            return uri.rawQuery
                ?.split('&')
                ?.firstOrNull { it.substringBefore('=') == WEB_PARAM }
                ?.substringAfter('=', "")
                ?.let { URLDecoder.decode(it, "UTF-8") }
                ?.nullIfBlank()
        }

        /** As the Swift SDK's `token(fromPasted:expectedSlug:)`: another app's link is refused. */
        private fun tokenFromLink(raw: String): String? = InviteLink.tokenFromPasted(raw, VoteConstants.PACKAGE_NAME)

        /** The SDK payload: the org and an invite token present (a 0.x signed envelope is refused). */
        fun parseJson(text: String): VoteInvitation? {
            val invitation = OrgInvitation.decodeJson(text) ?: return null
            return VoteInvitation(invitation, invitation.contextId?.nullIfBlank())
        }
    }
}

/**
 * Redeeming an invitation link: confirm, join the workspace, open the voting group.
 * (Swift `InvitationModel`; the web's `useJoinFromInvitation`.)
 */
class InvitationModel(
    private val attempts: Int = 4,
    private val retryDelayMs: Long = 1_500,
) {
    sealed interface Stage {
        data object Idle : Stage

        data object Confirm : Stage

        data object Joining : Stage

        data class Joined(
            val group: GroupRef,
        ) : Stage

        /** Joined a workspace that has no voting group yet. */
        data class JoinedWorkspace(
            val workspace: String,
        ) : Stage

        data class Failed(
            val message: String,
        ) : Stage
    }

    private val _stage = MutableStateFlow<Stage>(Stage.Idle)
    val stage: StateFlow<Stage> = _stage.asStateFlow()

    var invitation: VoteInvitation? = null
        private set

    /** Read a link or a pasted code. False (and a failed stage) when it is not a Mero Vote invitation. */
    fun open(raw: String): Boolean {
        val parsed = VoteInvitation.parse(raw)
        invitation = parsed
        if (parsed == null) {
            _stage.value = Stage.Failed("This isn't a Mero Vote invitation. Check the link and try again.")
            return false
        }
        _stage.value = Stage.Confirm
        return true
    }

    /** Join (`POST /invites/{token}/redeem`). [backend] is read again after [didJoin]. */
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
        var org = invitation.namespaceId
        val joined = attempt { current.joinNamespace(org, invitation.invitation) }
        joined
            .getOrNull()
            ?.namespaceId
            ?.takeIf { it.isNotEmpty() }
            ?.let { org = it }
        joined.exceptionOrNull()?.let { error ->
            val text = (error.message ?: error.toString()).lowercase()
            if (listOf("already a member", "already member", "already joined").none { it in text }) {
                _stage.value = Stage.Failed(VoteErrorText.describe(error))
                return
            }
        }
        didJoin()
        if (org.isEmpty()) {
            _stage.value = Stage.JoinedWorkspace("Workspace")
            return
        }
        // On 1.0 the org's members reach its org-wide app instances at once; the retries cover a
        // node that has not caught up yet.
        var contextId = invitation.contextId
        for (i in 0 until attempts) {
            if (i > 0) delay(retryDelayMs)
            val now = backend() ?: break
            val known = contextId
            if (known != null) {
                if (attempt { now.isMember(known) }.getOrDefault(false)) break
                if (attempt { now.joinContext(known) }.isSuccess) break
            } else {
                val first = attempt { now.listContexts(org) }.getOrNull()?.firstOrNull()
                if (first != null) {
                    contextId = first
                    break
                }
            }
        }
        val workspace =
            attempt { backend()?.listNamespaces() }
                .getOrNull()
                ?.firstOrNull { it.id == org }
                ?.name
                ?.nullIfBlank() ?: invitation.invitation.name?.nullIfBlank() ?: "Workspace"
        val opened = contextId
        _stage.value =
            if (opened == null) Stage.JoinedWorkspace(workspace) else Stage.Joined(GroupRef(org, workspace, opened))
    }

    fun reset() {
        invitation = null
        _stage.value = Stage.Idle
    }
}
