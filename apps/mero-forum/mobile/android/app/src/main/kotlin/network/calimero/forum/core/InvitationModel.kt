package network.calimero.forum.core

import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Where a redeemed invitation lands: a space, or one forum in it. */
data class InvitationDestination(
    val namespaceId: String,
    val spaceName: String,
    val forum: ForumRef?,
)

/**
 * Redeeming an invitation link: confirm, join the space, and (for a forum invite) join the forum,
 * then say where to go. (Swift `InvitationModel`.)
 */
class InvitationModel(
    private val forumAttempts: Int = 4,
    private val forumRetryDelayMs: Long = 1_500,
) {
    sealed interface Stage {
        data object Idle : Stage

        data class Confirm(
            val title: String,
            val isForum: Boolean,
        ) : Stage

        data class Joining(
            val title: String,
        ) : Stage

        data class Joined(
            val destination: InvitationDestination,
        ) : Stage

        data class Failed(
            val message: String,
        ) : Stage
    }

    private val _stage = MutableStateFlow<Stage>(Stage.Idle)
    val stage: StateFlow<Stage> = _stage.asStateFlow()

    var invitation: ForumInvitation? = null
        private set

    /** Read a link or a pasted code. False (and a failed stage) when it is not a Mero Forum invitation. */
    fun open(raw: String): Boolean {
        val parsed = ForumInvitation.parse(raw)
        invitation = parsed
        if (parsed == null) {
            _stage.value = Stage.Failed("This isn't a Mero Forum invitation. Check the link and try again.")
            return false
        }
        _stage.value = Stage.Confirm(parsed.title, parsed.kind == ForumInvitation.Kind.FORUM)
        return true
    }

    /** Join. [backend] is read again after [didJoin], which may hand the session the admitting relay. */
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
        _stage.value = Stage.Joining(invitation.title)
        val namespaceId = invitation.namespaceId
        val joined = attempt { current.joinNamespace(namespaceId, invitation.invitation) }
        joined.exceptionOrNull()?.let { error ->
            val text = (error.message ?: error.toString()).lowercase()
            val already = listOf("already a member", "already member", "already joined").any { it in text }
            if (!already) {
                _stage.value = Stage.Failed(ForumErrorText.describe(error))
                return
            }
        }
        didJoin()
        val spaceName = invitation.spaceName ?: "Space"
        val contextId = invitation.contextId
        val forumId = invitation.forumId
        val forum =
            if (invitation.kind == ForumInvitation.Kind.FORUM && contextId != null && forumId != null) {
                ForumRef(namespaceId, spaceName, forumId, invitation.forumName ?: "Forum", contextId)
                    .takeIf { joinForum(contextId, backend) }
            } else {
                null
            }
        _stage.value = Stage.Joined(InvitationDestination(namespaceId, spaceName, forum))
    }

    private suspend fun joinForum(
        contextId: String,
        backend: () -> MeroAppBackend?,
    ): Boolean {
        repeat(forumAttempts) { attemptIndex ->
            if (attemptIndex > 0) delay(forumRetryDelayMs)
            val current = backend() ?: return false
            if (attempt { current.isMember(contextId) }.getOrDefault(false)) return true
            if (attempt { current.joinContext(contextId) }.isSuccess) return true
        }
        return false
    }

    /** Not now, or done. */
    fun reset() {
        invitation = null
        _stage.value = Stage.Idle
    }
}
