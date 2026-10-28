package network.calimero.issues.core

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

/**
 * A workspace invitation in the web app's form (`app/src/utils/invitePayload.ts`):
 *
 * - payload: `{"invitation": <SignedGroupOpenInvitation>, "groupAlias": "<name>", "groupId": "<hex>", "kind": "namespace"}`
 * - token: `base58(deflate(payload))` ([InviteCodec])
 * - link: `https://links.calimero.network/com.calimero.mero-issue-tracker/join?invitation=<token>`
 *
 * Reading takes the wrapped payload or a bare signed invitation, under an optional `data`
 * envelope, with `groupName` preferred over `groupAlias`. The namespace is always read from the
 * signed body, never from the unsigned `groupId` hint. A link naming another app is refused:
 * redeeming it would join that app's namespace.
 */
data class TrackerInvitation(
    val invitation: SignedGroupOpenInvitation,
    val workspaceName: String?,
) {
    /** The namespace the invitation admits to: the hex of its signed `group_id`. */
    val namespaceId: String get() = groupIdOf(invitation).orEmpty()

    /** The shareable token. */
    fun token(): String =
        InviteCodec.encode(
            buildJsonObject {
                put("invitation", invitation.raw)
                workspaceName?.takeIf { it.isNotEmpty() }?.let { put("groupAlias", it) }
                put("groupId", namespaceId)
                put("kind", "namespace")
            }.toString(),
        )

    /** The shareable link. */
    fun link(): String = InviteLink.invitation(token(), Tracker.PACKAGE_NAME)

    companion object {
        private val json = Json { ignoreUnknownKeys = true }
        private const val BYTE_MASK = 0xff

        /** Read a link (https or `calimero://`) or a bare token; null when it holds no tracker invitation. */
        fun parse(input: String): TrackerInvitation? {
            val trimmed = input.trim()
            val lower = trimmed.lowercase()
            val isLink = lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("calimero://")
            if (isLink && !slugMatches(trimmed)) return null
            val token = InviteLink.tokenFromPasted(trimmed) ?: return null
            val decoded = InviteCodec.decode(token) ?: return null
            return parseJson(decoded)
        }

        /** Read the decoded payload JSON. */
        fun parseJson(text: String): TrackerInvitation? {
            val root = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull() ?: return null
            val inner = root["data"] as? JsonObject ?: root
            val wrapped = inner["invitation"] as? JsonObject
            return when {
                wrapped != null && isSigned(wrapped) -> {
                    val name = listOf("groupName", "groupAlias").firstNotNullOfOrNull { inner.string(it)?.trim()?.ifEmpty { null } }
                    TrackerInvitation(signed(wrapped), name)
                }
                isSigned(inner) -> TrackerInvitation(signed(inner), null)
                else -> null
            }
        }

        private fun slugMatches(link: String): Boolean {
            val path = link.substringBefore('?').split('/').map { it.lowercase() }
            return Tracker.PACKAGE_NAME.lowercase() in path
        }

        private fun isSigned(obj: JsonObject): Boolean =
            obj["invitation"] is JsonObject && (obj.string("inviter_signature") != null || obj.string("inviterSignature") != null)

        private fun signed(obj: JsonObject): SignedGroupOpenInvitation {
            if (obj["inviter_signature"] != null) return SignedGroupOpenInvitation(obj)
            val renamed = obj.toMutableMap()
            renamed["inviter_signature"] = renamed.remove("inviterSignature")!!
            return SignedGroupOpenInvitation(JsonObject(renamed))
        }

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
    }
}
