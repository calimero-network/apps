package network.calimero.standup.core

import com.calimero.mero.admin.SignedGroupOpenInvitation
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put

/**
 * A team invitation in the web app's format (`app/src/utils/invitation.ts`), so a link minted on a
 * phone opens in the browser and the other way round:
 *
 * - payload: JSON `{"invitation": <SignedGroupOpenInvitation>, "namespaceId": "…", "contextId": "…"}`
 * - token: `base58(deflate(payload))` ([InviteCodec], byte-compatible with fflate + bs58)
 * - link: `https://links.calimero.network/com.calimero.mero-standup/join?invitation=<token>`
 */
class StandupInvitation(
    /** The signed envelope, carried through verbatim (re-modelling it breaks its signature). */
    val invitation: SignedGroupOpenInvitation,
    /** The namespace it admits to. */
    val namespaceId: String,
    /** The team (context) to open once joined. */
    val contextId: String,
) {
    /** The payload JSON the web app's `serializeInvitationPayload` writes. */
    fun payload(): String =
        buildJsonObject {
            put("invitation", invitation.raw)
            put("namespaceId", namespaceId)
            put("contextId", contextId)
        }.toString()

    /** The shareable link. */
    fun link(): String = InviteLink.invitation(InviteCodec.encode(payload()), PACKAGE_NAME)

    companion object {
        /** The registry package, which is also the links' slug (`APP_SLUG`). */
        const val PACKAGE_NAME = "com.calimero.mero-standup"

        /**
         * Read a link (https or `calimero://`) or a bare token. Null when it is not a Mero Standup
         * invitation, including another app's link.
         */
        fun parse(input: String): StandupInvitation? {
            val trimmed = input.trim()
            val lower = trimmed.lowercase()
            val isLink = lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("calimero://")
            if (isLink) {
                val segments = trimmed.substringBefore('?').split('/').map { it.lowercase() }
                if (PACKAGE_NAME !in segments) return null
            }
            val token = InviteLink.tokenFromPasted(trimmed) ?: return null
            val json = InviteCodec.decode(token) ?: return null
            return parseJson(json)
        }

        /** Read the decoded payload: checks the envelope is signed and leaves its fields to the node. */
        fun parseJson(json: String): StandupInvitation? {
            val root = runCatching { Json.parseToJsonElement(json) as? JsonObject }.getOrNull()
            val namespaceId = root?.string("namespaceId")?.ifEmpty { null }
            val contextId = root?.string("contextId")?.ifEmpty { null }
            val envelope = (root?.get("invitation") as? JsonObject)?.takeIf { it["inviter_signature"] != null }
            if (namespaceId == null || contextId == null || envelope == null) return null
            return StandupInvitation(SignedGroupOpenInvitation(envelope), namespaceId, contextId)
        }

        private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
    }
}
