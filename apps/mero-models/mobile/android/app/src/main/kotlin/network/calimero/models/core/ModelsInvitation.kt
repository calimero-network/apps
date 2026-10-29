package network.calimero.models.core

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
 * An invitation in the web app's format (`app/src/utils/invitation.ts`), so a link minted on either
 * side opens on the other. (Swift `ModelsInvitation`.)
 *
 * - payload: `{"invitation": <SignedGroupOpenInvitation>, "namespaceId": "<studio>", "contextId": "<scene>"}`
 * - token: `base58(deflate(payload))` ([InviteCodec])
 * - link: `https://links.calimero.network/com.calimero.mero-models/join?invitation=<token>`
 *
 * The signed invitation grants the studio (the namespace); `contextId` only says which scene to open.
 */
data class ModelsInvitation(
    val invitation: SignedGroupOpenInvitation,
    /** The payload's own `namespaceId`, used only when the signed id is unreadable. */
    val payloadNamespaceId: String,
    val contextId: String,
) {
    /** The studio it admits to: the hex of its SIGNED `group_id`, so a tampered wrapper cannot redirect a join. */
    val namespaceId: String
        get() {
            val raw = invitation.invitation.raw["group_id"] ?: invitation.invitation.raw["groupId"]
            val signed =
                when (raw) {
                    is JsonArray -> raw.mapNotNull { (it as? JsonPrimitive)?.intOrNull }.joinToString("") { "%02x".format(it and BYTE_MASK) }
                    is JsonPrimitive -> raw.contentOrNull.orEmpty().lowercase()
                    else -> ""
                }
            return signed.ifEmpty { payloadNamespaceId }
        }

    /** The shareable token. */
    fun token(): String =
        InviteCodec.encode(
            buildJsonObject {
                put("contextId", contextId)
                put("invitation", invitation.raw)
                put("namespaceId", namespaceId)
            }.toString(),
        )

    /** The shareable link, the only form the web app offers. */
    fun link(): String = InviteLink.invitation(token(), ModelsFormat.PACKAGE_NAME)

    companion object {
        private const val BYTE_MASK = 0xff
        private val json = Json { ignoreUnknownKeys = true }

        /** Mint a link to a scene: an invitation to its studio, signed with this device's key, plus the scene to open. */
        suspend fun mint(
            backend: MeroAppBackend,
            namespaceId: String,
            contextId: String,
        ): String = ModelsInvitation(backend.createInvitation(namespaceId), namespaceId, contextId).link()

        /** Parse a link (https or `calimero://`), a bare token or the raw JSON. Null for anything else, and another app's link. */
        fun parse(input: String): ModelsInvitation? {
            val trimmed = input.trim()
            if (trimmed.isEmpty()) return null
            if (trimmed.startsWith("{")) return parseJson(trimmed)
            val token = tokenFromLink(trimmed) ?: return null
            return InviteCodec.decode(token)?.let(::parseJson)
        }

        /** The SDK's `tokenFromPasted` has no expected-app check: another app's link is refused here. */
        private fun tokenFromLink(raw: String): String? {
            val lower = raw.lowercase()
            val isLink = lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("calimero://")
            if (isLink) {
                val segments = raw.substringBefore('?').split('/').map { it.lowercase() }
                if (ModelsFormat.PACKAGE_NAME !in segments) return null
            }
            return InviteLink.tokenFromPasted(raw)
        }

        /** The web's `parseInvitationPayload`: both ids, and an envelope carrying `inviter_signature`. */
        @Suppress("ReturnCount")
        fun parseJson(text: String): ModelsInvitation? {
            val root = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull() ?: return null
            val namespaceId = root.string("namespaceId")?.takeIf { it.isNotEmpty() } ?: return null
            val contextId = root.string("contextId")?.takeIf { it.isNotEmpty() } ?: return null
            val envelope = root["invitation"] as? JsonObject ?: return null
            if (envelope["inviter_signature"] == null) return null
            return ModelsInvitation(SignedGroupOpenInvitation(envelope), namespaceId, contextId)
        }

        private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
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
        val namespaceId = invitation.namespaceId
        attempt { current.joinNamespace(namespaceId, invitation.invitation) }.exceptionOrNull()?.let { error ->
            val text = (error.message ?: error.toString()).lowercase()
            if (listOf("already a member", "already member", "already joined").none { it in text }) {
                _stage.value = Stage.Failed(ModelsFormat.errorText(error))
                return
            }
        }
        didJoin()
        // The scene sits in the studio's root group: membership follows the studio's once peers
        // apply it. Ask a few times, joining if it is open.
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
