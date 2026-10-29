package network.calimero.pixart.core

import com.calimero.mero.admin.SignedGroupOpenInvitation
import com.calimero.mero.app.MeroAppBackend
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink
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
import kotlin.coroutines.cancellation.CancellationException

/**
 * A team invitation in the web app's format (`utils/invitation.ts`, `InviteModal`, `InvitationPrompt`), so
 * a link minted on either side opens on the other. (Swift `PixartInvitation`.)
 *
 * - payload: `{"invitation": <SignedGroupOpenInvitation>, "groupName"?: …, "__teamName"?: "<team name>"}`
 * - token: `base58(deflate(payload))` ([InviteCodec])
 * - link: `https://links.calimero.network/com.calimero.mero-pixart/join?invitation=<token>`
 */
data class PixartInvitation(
    val invitation: SignedGroupOpenInvitation,
    val teamName: String? = null,
) {
    /** The team it admits to: the hex of its SIGNED `group_id`. */
    val namespaceId: String
        get() =
            when (val raw = invitation.invitation.raw["group_id"] ?: invitation.invitation.raw["groupId"]) {
                is JsonArray -> raw.mapNotNull { (it as? JsonPrimitive)?.intOrNull }.joinToString("") { "%02x".format(it and BYTE_MASK) }
                is JsonPrimitive -> raw.contentOrNull.orEmpty().lowercase()
                else -> ""
            }

    val title: String get() = teamName ?: "a team"

    /** The shareable link. */
    fun link(): String {
        val token =
            InviteCodec.encode(
                buildJsonObject {
                    put("invitation", invitation.raw)
                    teamName?.trim()?.takeIf { it.isNotEmpty() }?.let { put("__teamName", it) }
                }.toString(),
            )
        return InviteLink.invitation(token, PixartFormat.PACKAGE_NAME)
    }

    companion object {
        private const val BYTE_MASK = 0xff
        private val json = Json { ignoreUnknownKeys = true }

        /** A link (https or `calimero://`), a bare token, or raw JSON; null when it holds no invitation, and for another app's link. */
        fun parse(input: String): PixartInvitation? {
            val trimmed = input.trim()
            if (trimmed.isEmpty()) return null
            if (trimmed.startsWith("{")) return parseJson(trimmed)
            val token = tokenFromLink(trimmed) ?: return null
            return InviteCodec.decode(token)?.let(::parseJson)
        }

        /** The SDK's `tokenFromPasted` has no expected-app check, so another app's link is refused here. */
        private fun tokenFromLink(raw: String): String? {
            val lower = raw.lowercase()
            val isLink = lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("calimero://")
            if (isLink) {
                val segments = raw.substringBefore('?').split('/').map { it.lowercase() }
                if (PixartFormat.PACKAGE_NAME !in segments) return null
            }
            return InviteLink.tokenFromPasted(raw)
        }

        /** The decoded payload (the web's `parseTeamInvitation`). */
        fun parseJson(text: String): PixartInvitation? {
            val root = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull() ?: return null
            val name = (root.string("__teamName") ?: root.string("groupName"))?.trim()?.takeIf { it.isNotEmpty() }
            val wrapped = root["invitation"] as? JsonObject
            return when {
                wrapped != null && isEnvelope(wrapped) -> PixartInvitation(signed(wrapped), name)
                isEnvelope(root) -> PixartInvitation(signed(root), name)
                else -> null
            }
        }

        private fun isEnvelope(obj: JsonObject): Boolean =
            obj["invitation"] is JsonObject && (obj.string("inviter_signature") != null || obj.string("inviterSignature") != null)

        /** The envelope verbatim, with a camelCase signature key renamed to core's spelling. */
        private fun signed(obj: JsonObject): SignedGroupOpenInvitation {
            val camel = obj["inviterSignature"]
            if (obj["inviter_signature"] != null || camel == null) return SignedGroupOpenInvitation(obj)
            return SignedGroupOpenInvitation(JsonObject(obj.filterKeys { it != "inviterSignature" } + ("inviter_signature" to camel)))
        }

        private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
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

    /** Join the team. [didJoin] may hand the session the admitting relay. */
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
