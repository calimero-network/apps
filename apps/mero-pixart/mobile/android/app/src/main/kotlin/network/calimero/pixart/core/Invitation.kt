package network.calimero.pixart.core

import com.calimero.mero.app.MeroAppBackend
import com.calimero.mero.app.OrgInvitation
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.coroutines.cancellation.CancellationException

/**
 * A team invitation: kotlin-sdk's [OrgInvitation], the link payload every Calimero 1.0 app shares,
 * with the team's name to show as its `name`:
 *
 * - payload: `{"invitation": "inv_…", "namespaceId": "<team>", "name"?: "<team name>"}`
 * - token: `base58(deflate(payload))` ([com.calimero.mero.invite.InviteCodec])
 * - link: `https://links.calimero.network/com.calimero.mero-pixart/join?invitation=<token>`
 *
 * A PixArt team is a Calimero organization. A pre-1.0 signed invitation is refused (a 1.0
 * cluster cannot redeem it). (Swift `PixartInvitation`.)
 */
data class PixartInvitation(
    val invitation: OrgInvitation,
) {
    /** The team (organization) it admits to: the one the node minted the token for. */
    val namespaceId: String get() = invitation.namespaceId
    val teamName: String? get() = invitation.name?.trim()?.ifEmpty { null }

    val title: String get() = teamName ?: "a team"

    /** The shareable link. */
    fun link(): String = invitation.link(PixartFormat.PACKAGE_NAME)

    companion object {
        /** [invitation] with [teamName] as its name when one is given. */
        fun of(
            invitation: OrgInvitation,
            teamName: String? = null,
        ): PixartInvitation = PixartInvitation(invitation.copy(name = teamName?.trim()?.ifEmpty { null } ?: invitation.name?.trim()?.ifEmpty { null }))

        /** A link (https or `calimero://`), a bare token, or raw JSON; null when it holds no invitation, and for another app's link. */
        fun parse(input: String): PixartInvitation? {
            val trimmed = input.trim()
            if (trimmed.isEmpty()) return null
            if (trimmed.startsWith("{")) return parseJson(trimmed)
            return OrgInvitation.parse(trimmed, PixartFormat.PACKAGE_NAME)?.let(::PixartInvitation)
        }

        /** The decoded payload: an [OrgInvitation]. */
        fun parseJson(text: String): PixartInvitation? = OrgInvitation.decodeJson(text)?.let(::PixartInvitation)
    }
}

/** Redeeming an invitation link: confirm, join the team, then open it. (Swift `InvitationModel`; the web's `InvitationPrompt`.) */
class InvitationModel {
    sealed interface Stage {
        data object Idle : Stage

        data class Confirm(
            val title: String,
        ) : Stage

        data class Joining(
            val title: String,
        ) : Stage

        data class Joined(
            val teamId: String,
            val name: String,
        ) : Stage

        data class Failed(
            val message: String,
        ) : Stage
    }

    private val _stage = MutableStateFlow<Stage>(Stage.Idle)
    val stage: StateFlow<Stage> = _stage.asStateFlow()

    var invitation: PixartInvitation? = null
        private set

    /** Read a link. False (and a failed stage) when it is not a Mero PixArt invitation. */
    fun open(raw: String): Boolean {
        val parsed = PixartInvitation.parse(raw)
        invitation = parsed
        if (parsed == null) {
            _stage.value = Stage.Failed("This isn't a Mero PixArt invitation. Check the link and try again.")
            return false
        }
        _stage.value = Stage.Confirm(parsed.title)
        return true
    }

    /** Join the team: redeem the invite token on the node. [didJoin] re-reads what the account sees. */
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
        try {
            current.joinNamespace(invitation.namespaceId, invitation.invitation)
        } catch (e: CancellationException) {
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            val text = (e.message ?: e.toString()).lowercase()
            if (listOf("already a member", "already member", "already joined").none { it in text }) {
                _stage.value = Stage.Failed(PixartFormat.errorText(e))
                return
            }
        }
        didJoin()
        _stage.value = Stage.Joined(invitation.namespaceId, invitation.teamName ?: "Team")
    }

    fun reset() {
        invitation = null
        _stage.value = Stage.Idle
    }
}
