package network.calimero.crm.core

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
import kotlinx.serialization.json.put

/**
 * A workspace invitation in the web app's format (`app/src/utils/invitePayload.ts` and
 * `invitation.ts`), so a link minted on a phone opens in the browser and the other way round:
 *
 * - payload: `{"invitation": <SignedGroupOpenInvitation>, "groupAlias": "<workspace>", "groupId": "<hex>", "kind": "namespace"}`
 * - token: `base58(deflate(payload))` ([InviteCodec])
 * - link: `https://links.calimero.network/com.calimero.mero-crm/join?invitation=<token>`
 *
 * Decoding takes what the web's `parseInvitePayload` takes: the wrapped payload or a bare signed
 * invitation, under an optional `data` envelope, `groupName` or `groupAlias`, the signature under
 * either spelling. Another app's link is refused, since redeeming it would join that app's namespace.
 */
class CrmInvitation(
    /** The signed envelope, carried through verbatim (re-modelling it breaks its signature). */
    val invitation: SignedGroupOpenInvitation,
    val workspaceName: String?,
    /** The namespace it admits to: the signed `group_id`, else the payload's unsigned hint. */
    val namespaceId: String = groupIdOf(invitation).orEmpty(),
) {
    /** The payload JSON. */
    fun payload(): String =
        buildJsonObject {
            put("invitation", invitation.raw)
            workspaceName?.trim()?.takeIf { it.isNotEmpty() }?.let { put("groupAlias", it) }
            put("groupId", namespaceId)
            put("kind", "namespace")
        }.toString()

    /** The shareable token. */
    fun token(): String = InviteCodec.encode(payload())

    /** The shareable link. */
    fun link(): String = InviteLink.invitation(token(), PACKAGE_NAME)

    companion object {
        /** The registry package, which is also the links' slug (`APP_SLUG`). */
        const val PACKAGE_NAME = "com.calimero.mero-crm"

        /**
         * Read a pasted link (https or `calimero://`) or a bare token. Null when it is not a Mero CRM
         * invitation, including another app's link: the SDK's `tokenFromPasted` does not check the
         * app, so the link's slug is checked here.
         */
        fun parse(input: String): CrmInvitation? {
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

        /** Read the decoded payload JSON. */
        fun parseJson(json: String): CrmInvitation? {
            val root = runCatching { Json.parseToJsonElement(json) as? JsonObject }.getOrNull() ?: return null
            val inner = root["data"] as? JsonObject ?: root
            val wrapped = (inner["invitation"] as? JsonObject)?.takeIf { isSigned(it) }
            return when {
                wrapped != null -> {
                    val signed = SignedGroupOpenInvitation(normalized(wrapped))
                    val name = listOf("groupAlias", "groupName").firstNotNullOfOrNull { inner.string(it)?.trim()?.ifEmpty { null } }
                    val id = groupIdOf(signed) ?: inner.string("groupId")?.lowercase()?.ifEmpty { null }
                    id?.let { CrmInvitation(signed, name, it) }
                }
                isSigned(inner) -> {
                    val signed = SignedGroupOpenInvitation(normalized(inner))
                    groupIdOf(signed)?.let { CrmInvitation(signed, null, it) }
                }
                else -> null
            }
        }

        /** A signature and an inner invitation object (the web's `isSignedInvitation`). */
        private fun isSigned(obj: JsonObject): Boolean =
            obj["invitation"] is JsonObject && (obj.string("inviter_signature") != null || obj.string("inviterSignature") != null)

        private fun normalized(obj: JsonObject): JsonObject {
            if (obj["inviter_signature"] != null) return obj
            val camel = obj["inviterSignature"] ?: return obj
            return JsonObject(obj.filterKeys { it != "inviterSignature" } + ("inviter_signature" to camel))
        }

        /** The invited group, which for a workspace invitation is the namespace: bytes to hex. */
        private fun groupIdOf(signed: SignedGroupOpenInvitation): String? {
            val raw = signed.invitation.raw["group_id"] ?: signed.invitation.raw["groupId"]
            return when (raw) {
                is JsonArray -> {
                    val bytes = raw.mapNotNull { (it as? JsonPrimitive)?.intOrNull }
                    if (bytes.size == raw.size && bytes.isNotEmpty()) bytes.joinToString("") { "%02x".format(it and BYTE_MASK) } else null
                }
                is JsonPrimitive -> raw.contentOrNull?.ifEmpty { null }?.lowercase()
                else -> null
            }
        }

        private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

        private const val BYTE_MASK = 0xff
    }
}
