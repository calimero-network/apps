package network.calimero.forum.core

import com.calimero.mero.admin.SignedGroupOpenInvitation
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import java.net.URLDecoder

/**
 * An invitation in the web app's format (`app/src/lib/inviteCodec.ts`), so a link minted on
 * either side opens on the other. (Swift `ForumInvitation`.)
 *
 * - payload: `{"invitation": <SignedGroupOpenInvitation>, "kind": "namespace" | "forum",
 *   "groupId", "groupAlias": "<space name>", "forumId", "forumName", "contextId"}`
 * - token: `base58(deflate(payload))` ([InviteCodec])
 * - link: `https://links.calimero.network/com.calimero.mero-forum/join?invitation=<token>`
 *
 * The signed invitation always grants the NAMESPACE (forum access is inherited from it);
 * `forumId` / `contextId` only say where to land afterwards.
 */
data class ForumInvitation(
    val invitation: SignedGroupOpenInvitation,
    val kind: Kind = Kind.SPACE,
    val spaceName: String? = null,
    val forumId: String? = null,
    val forumName: String? = null,
    val contextId: String? = null,
) {
    enum class Kind(
        val wire: String,
    ) {
        SPACE("namespace"),
        FORUM("forum"),
    }

    /** The namespace it admits to: the hex of its SIGNED `group_id`, never a field beside it. */
    val namespaceId: String
        get() {
            val raw = invitation.invitation.raw["group_id"] ?: invitation.invitation.raw["groupId"]
            return when (raw) {
                is JsonArray -> raw.mapNotNull { (it as? JsonPrimitive)?.intOrNull }.joinToString("") { "%02x".format(it and BYTE_MASK) }
                is JsonPrimitive -> raw.contentOrNull.orEmpty().lowercase()
                else -> ""
            }
        }

    /** What to call it in a prompt: the forum for a forum invite, else the space. */
    val title: String
        get() =
            when {
                kind == Kind.FORUM && !forumName.isNullOrEmpty() -> forumName
                !spaceName.isNullOrEmpty() -> spaceName
                else -> "a space"
            }

    /** The shareable token. */
    fun token(): String =
        InviteCodec.encode(
            buildJsonObject {
                put("invitation", invitation.raw)
                put("kind", kind.wire)
                put("groupId", namespaceId)
                spaceName?.nullIfBlank()?.let { put("groupAlias", it) }
                forumId?.let { put("forumId", it) }
                forumName?.nullIfBlank()?.let { put("forumName", it) }
                contextId?.let { put("contextId", it) }
            }.toString(),
        )

    /** The shareable link. */
    fun link(): String = InviteLink.invitation(token(), ForumConstants.PACKAGE_NAME)

    companion object {
        private const val BYTE_MASK = 0xff
        private val json = Json { ignoreUnknownKeys = true }

        /**
         * Parse a link (https or `calimero://`), the web app's old `?invite=` link, a bare token
         * or raw JSON. Null when it holds no forum invitation, and for another app's link.
         */
        fun parse(input: String): ForumInvitation? {
            val trimmed = input.trim()
            if (trimmed.isEmpty()) return null
            if (trimmed.startsWith("{")) return parseJson(trimmed)
            val token = legacyToken(trimmed) ?: tokenFromLink(trimmed) ?: return null
            return InviteCodec.decode(token)?.let(::parseJson)
        }

        /** As the Swift SDK's `token(fromPasted:expectedSlug:)`: another app's link is refused. */
        private fun tokenFromLink(raw: String): String? {
            val lower = raw.lowercase()
            val isLink = lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("calimero://")
            if (isLink) {
                val segments = raw.substringBefore('?').split('/').map { it.lowercase() }
                if (ForumConstants.PACKAGE_NAME !in segments) return null
            }
            return InviteLink.tokenFromPasted(raw)
        }

        /** `…?invite=<code>`: what this app's web build shared before platform links. */
        private fun legacyToken(raw: String): String? {
            if (!raw.contains('?') || raw.contains("invitation=")) return null
            val pair = raw.substringAfter('?').split('&').firstOrNull { it.substringBefore('=') == "invite" } ?: return null
            val value = pair.substringAfter('=', "")
            return value.ifEmpty { null }?.let { URLDecoder.decode(it, Charsets.UTF_8.name()) }
        }

        /** Parse the decoded payload JSON (the web's `parsePayload`). */
        fun parseJson(text: String): ForumInvitation? {
            val root = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull() ?: return null
            val inner = root["data"] as? JsonObject ?: root
            val wrapped = inner["invitation"] as? JsonObject
            return when {
                wrapped != null && isEnvelope(wrapped) ->
                    ForumInvitation(
                        invitation = signed(wrapped),
                        kind = if (inner.string("kind") == "forum") Kind.FORUM else Kind.SPACE,
                        spaceName = (inner.string("groupName") ?: inner.string("groupAlias"))?.nullIfBlank(),
                        forumId = inner.string("forumId")?.nullIfBlank(),
                        forumName = inner.string("forumName")?.nullIfBlank(),
                        contextId = inner.string("contextId")?.nullIfBlank(),
                    )
                isEnvelope(inner) -> ForumInvitation(signed(inner))
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
