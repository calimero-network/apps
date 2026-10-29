package network.calimero.vote.core

import com.calimero.mero.admin.SignedGroupOpenInvitation
import com.calimero.mero.app.MeroAppBackend
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/**
 * An invitation in the web app's format (`app/src/utils/invitation.ts`), so a link minted on
 * either side opens on the other. (Swift `VoteInvitation`.)
 *
 * - payload: `{"invitation": <SignedGroupOpenInvitation>, "namespaceId": "<hex>", "contextId": "<hex>"}`
 * - token: `base58(deflate(payload))` ([InviteCodec])
 * - link: `https://links.calimero.network/com.calimero.mero-vote/join?invitation=<token>`
 *
 * The signed invitation grants the NAMESPACE; `contextId` says which voting group in it to open.
 */
data class VoteInvitation(
    val invitation: SignedGroupOpenInvitation,
    val contextId: String,
) {
    /** The namespace it admits to: the hex of its SIGNED `group_id`, never the field beside it. */
    val namespaceId: String
        get() {
            val inner = invitation.raw["invitation"] as? JsonObject
            val raw = inner?.get("group_id") ?: inner?.get("groupId")
            return when (raw) {
                is JsonArray -> raw.mapNotNull { (it as? JsonPrimitive)?.intOrNull }.joinToString("") { "%02x".format(it and BYTE_MASK) }
                is JsonPrimitive -> raw.contentOrNull.orEmpty().lowercase()
                else -> ""
            }
        }

    fun token(): String =
        InviteCodec.encode(
            buildJsonObject {
                put("contextId", contextId)
                put("invitation", invitation.raw)
                put("namespaceId", namespaceId)
            }.toString(),
        )

    fun link(): String = InviteLink.invitation(token(), VoteConstants.PACKAGE_NAME)

    companion object {
        private const val BYTE_MASK = 0xff
        private val json = Json { ignoreUnknownKeys = true }

        /**
         * Parse a link (https or `calimero://`), a bare token or raw JSON. Null when it holds no
         * Mero Vote invitation, including another app's link.
         */
        fun parse(input: String): VoteInvitation? {
            val trimmed = input.trim()
            if (trimmed.isEmpty()) return null
            if (trimmed.startsWith("{")) return parseJson(trimmed)
            val token = tokenFromLink(trimmed) ?: return null
            return InviteCodec.decode(token)?.let(::parseJson)
        }

        /** As the Swift SDK's `token(fromPasted:expectedSlug:)`: another app's link is refused. */
        private fun tokenFromLink(raw: String): String? {
            val lower = raw.lowercase()
            val isLink = lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("calimero://")
            if (isLink) {
                val segments = raw.substringBefore('?').split('/').map { it.lowercase() }
                if (VoteConstants.PACKAGE_NAME !in segments) return null
            }
            return InviteLink.tokenFromPasted(raw)
        }

        /** The web's `parseInvitationPayload`: both ids present, the invitation the signed envelope. */
        fun parseJson(text: String): VoteInvitation? {
            val root = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull() ?: return null
            val contextId = root.string("contextId")?.nullIfBlank() ?: return null
            root.string("namespaceId")?.nullIfBlank() ?: return null
            val wrapped = root["invitation"] as? JsonObject ?: return null
            if (wrapped["inviter_signature"] == null) return null
            return VoteInvitation(SignedGroupOpenInvitation(wrapped), contextId)
        }

        private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
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
        _stage.value = Stage.Joining
        attempt { current.joinNamespace(invitation.namespaceId, invitation.invitation) }.exceptionOrNull()?.let { error ->
            val text = (error.message ?: error.toString()).lowercase()
            if (listOf("already a member", "already member", "already joined").none { it in text }) {
                _stage.value = Stage.Failed(VoteErrorText.describe(error))
                return
            }
        }
        didJoin()
        // The group's context is directly in the namespace; membership arrives with the
        // namespace's, but ask for it in case it has not projected yet.
        for (i in 0 until attempts) {
            if (i > 0) delay(retryDelayMs)
            val now = backend() ?: break
            if (attempt { now.isMember(invitation.contextId) }.getOrDefault(false)) break
            if (attempt { now.joinContext(invitation.contextId) }.isSuccess) break
        }
        val workspace =
            attempt { backend()?.listNamespaces() }
                .getOrNull()
                ?.firstOrNull { it.id == invitation.namespaceId }
                ?.name
                ?.nullIfBlank() ?: "Workspace"
        _stage.value = Stage.Joined(GroupRef(invitation.namespaceId, workspace, invitation.contextId))
    }

    fun reset() {
        invitation = null
        _stage.value = Stage.Idle
    }
}
