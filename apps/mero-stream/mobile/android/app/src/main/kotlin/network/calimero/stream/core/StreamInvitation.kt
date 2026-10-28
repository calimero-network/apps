package network.calimero.stream.core

import com.calimero.mero.admin.SignedGroupOpenInvitation
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put

/**
 * An invitation in the web app's format (`app/src/lib/inviteCodec.ts` and `inviteLink.ts`), so a
 * link minted on a phone opens in the browser and the other way round (identical to the iOS type):
 *
 * - payload: JSON `{invitation, kind: "namespace" | "room", groupId, groupAlias?, roomId?, contextId?, roomName?}`
 * - token: `base58(deflate(payload))`
 * - link: `https://links.calimero.network/com.calimero.mero-stream/join?invitation=<token>`
 */
class StreamInvitation(
    /** The signed envelope, carried through verbatim (re-modelling it breaks its signature). */
    val invitation: SignedGroupOpenInvitation,
    val kind: Kind,
    /** The namespace (stream) it admits to. */
    val namespaceId: String,
    val namespaceName: String? = null,
    val roomId: String? = null,
    val contextId: String? = null,
    val roomName: String? = null,
) {
    enum class Kind(
        val wire: String,
    ) {
        NAMESPACE("namespace"),
        ROOM("room"),
    }

    /** Whether it drops the person into one call. */
    val opensRoom: Boolean get() = kind == Kind.ROOM && roomId != null && contextId != null

    /** The payload JSON the web app's `encodeInvite` writes. */
    fun payload(): String =
        buildJsonObject {
            put("invitation", invitation.raw)
            put("kind", kind.wire)
            put("groupId", namespaceId)
            namespaceName?.let { put("groupAlias", it) }
            roomId?.let { put("roomId", it) }
            contextId?.let { put("contextId", it) }
            roomName?.let { put("roomName", it) }
        }.toString()

    /** The shareable link. */
    fun link(): String = InviteLink.invitation(InviteCodec.encode(payload()), PACKAGE_NAME)

    companion object {
        /** The registry package, which is also the links' slug (`APP_SLUG`). */
        const val PACKAGE_NAME = "com.calimero.mero-stream"

        /**
         * Read a link (https, `calimero://`, the older `?invite=` form) or a bare token. Null when it
         * is not a Mero Stream invitation, including another app's link: the SDK's
         * `tokenFromPasted` does not check the slug, so this does.
         */
        fun parse(input: String): StreamInvitation? {
            val trimmed = input.trim()
            val lower = trimmed.lowercase()
            val isLink = lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("calimero://")
            var token: String? = null
            if (isLink) {
                val segments = trimmed.substringBefore('?').split('/').map { it.lowercase() }
                if (PACKAGE_NAME !in segments) return null
                token = queryValue(trimmed, "invitation") ?: queryValue(trimmed, "invite")
            }
            val raw = token ?: InviteLink.tokenFromPasted(trimmed) ?: return null
            val json = InviteCodec.decode(raw) ?: return null
            return parseJson(json)
        }

        /** Read the decoded payload, as the web's `decodeInvite` does. */
        @Suppress("ReturnCount")
        fun parseJson(json: String): StreamInvitation? {
            var root = runCatching { Json.parseToJsonElement(json) as? JsonObject }.getOrNull() ?: return null
            (root["data"] as? JsonObject)?.let { root = it }
            val wrapped = root["invitation"] as? JsonObject
            val (envelope, bare) =
                when {
                    wrapped != null && isSigned(wrapped) -> wrapped to false
                    isSigned(root) -> root to true
                    else -> return null
                }
            val signed = SignedGroupOpenInvitation(envelope)
            val signedGroup = signed.invitation.groupId.joinToString("") { "%02x".format(it and 0xFF) }
            if (bare) {
                if (signedGroup.isEmpty()) return null
                return StreamInvitation(signed, Kind.NAMESPACE, signedGroup)
            }
            var namespaceId = signedGroup.ifEmpty { root.string("groupId").orEmpty() }
            (root["chain"] as? JsonArray)
                ?.mapNotNull { it as? JsonObject }
                ?.firstOrNull { it.string("kind") == "namespace" }
                ?.string("groupId")
                ?.takeIf { it.isNotEmpty() }
                ?.let { namespaceId = it }
            if (namespaceId.isEmpty()) return null
            return StreamInvitation(
                invitation = signed,
                kind = if (root.string("kind") == "room") Kind.ROOM else Kind.NAMESPACE,
                namespaceId = namespaceId,
                namespaceName = root.string("groupAlias") ?: root.string("groupName"),
                roomId = root.string("roomId"),
                contextId = root.string("contextId"),
                roomName = root.string("roomName"),
            )
        }

        private fun isSigned(value: JsonObject): Boolean =
            (value["inviter_signature"] != null || value["inviterSignature"] != null) && value["invitation"] is JsonObject

        private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

        private fun queryValue(
            link: String,
            name: String,
        ): String? {
            val query = link.substringAfter('?', "")
            for (pair in query.split('&')) {
                val parts = pair.split('=', limit = 2)
                if (parts.size == 2 && parts[0] == name) return java.net.URLDecoder.decode(parts[1], "UTF-8")
            }
            return null
        }
    }
}
