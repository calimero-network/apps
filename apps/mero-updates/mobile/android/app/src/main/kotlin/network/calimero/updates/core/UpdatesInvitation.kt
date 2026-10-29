package network.calimero.updates.core

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
import java.net.URI
import java.net.URLDecoder

/**
 * A company or audience invitation in the web app's format (`app/src/lib/inviteCodec.ts` +
 * `inviteLink.ts`), so a link minted on a phone opens in the browser and the other way round:
 *
 * - payload: JSON `{"invitation": <SignedGroupOpenInvitation>, "kind": "namespace"|"audience",
 *   "groupId": <namespace>, "groupAlias": <company name>, "audienceId"?, "contextId"?, "audienceName"?}`
 * - token: `base58(deflate(payload))` ([InviteCodec], byte-compatible with fflate + bs58)
 * - link: `https://links.calimero.network/com.calimero.mero-updates/join?invitation=<token>`
 *
 * The grant is always the namespace (audiences are open subgroups, reachable by every company
 * member); `audienceId` / `contextId` only say where to land.
 */
class UpdatesInvitation(
    /** The signed envelope, carried through verbatim (re-modelling it breaks its signature). */
    val invitation: SignedGroupOpenInvitation,
    val kind: Kind,
    /** The namespace (company) it admits to, read from inside the signed invitation. */
    val namespaceId: String,
    val companyName: String? = null,
    val audienceId: String? = null,
    val contextId: String? = null,
    val audienceName: String? = null,
) {
    enum class Kind(
        val wire: String,
    ) {
        NAMESPACE("namespace"),
        AUDIENCE("audience"),
    }

    /** The payload JSON the web app's `encodeInvite` writes. */
    fun payload(): String =
        buildJsonObject {
            put("invitation", invitation.raw)
            put("kind", kind.wire)
            put("groupId", namespaceId)
            companyName?.let { put("groupAlias", it) }
            audienceId?.let { put("audienceId", it) }
            contextId?.let { put("contextId", it) }
            audienceName?.let { put("audienceName", it) }
        }.toString()

    /** The shareable link. */
    fun link(): String = InviteLink.invitation(InviteCodec.encode(payload()), PACKAGE_NAME)

    /** Where the link lands, for the invite sheet. */
    val scope: String
        get() =
            when (kind) {
                Kind.NAMESPACE -> "Whole company" + (companyName?.let { " · $it" } ?: "")
                Kind.AUDIENCE -> "Opens ${audienceName ?: "an audience"}"
            }

    companion object {
        /** The registry package, which is also the links' slug (`APP_SLUG`). */
        const val PACKAGE_NAME = "com.calimero.mero-updates"

        /**
         * Read a link (https or `calimero://`, current or the older `?invite=`) or a bare token.
         * Null when it is not a Mero Updates invitation, including another app's link.
         */
        fun parse(input: String): UpdatesInvitation? {
            val trimmed = input.trim()
            if (trimmed.isEmpty()) return null
            val legacy = legacyCode(trimmed)
            val candidate = legacy ?: trimmed
            val lower = candidate.lowercase()
            val isLink = lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("calimero://")
            if (isLink) {
                val segments = candidate.substringBefore('?').split('/').map { it.lowercase() }
                if (PACKAGE_NAME !in segments) return null
            }
            val token = InviteLink.tokenFromPasted(candidate) ?: return null
            val json = InviteCodec.decode(token) ?: return null
            return parseJson(json)
        }

        /** The web app's links before the platform format: `…?invite=<code>`. */
        private fun legacyCode(input: String): String? {
            val query = runCatching { URI(input).rawQuery }.getOrNull() ?: return null
            return query
                .split('&')
                .firstOrNull { it.startsWith("invite=") }
                ?.substringAfter('=')
                ?.let { URLDecoder.decode(it, "UTF-8") }
                ?.ifEmpty { null }
        }

        /** Read the decoded payload: checks the envelope is signed and leaves its fields to the node. */
        fun parseJson(json: String): UpdatesInvitation? {
            val parsed = runCatching { Json.parseToJsonElement(json) as? JsonObject }.getOrNull() ?: return null
            val root = parsed["data"] as? JsonObject ?: parsed
            val inner = root["invitation"]
            val fields: JsonObject
            val signedObject: JsonObject
            when {
                inner is JsonObject && isSigned(inner) -> {
                    fields = root
                    signedObject = inner
                }
                isSigned(root) -> {
                    fields = JsonObject(emptyMap())
                    signedObject = root
                }
                else -> return null
            }
            val signed = SignedGroupOpenInvitation(snakeSignature(signedObject))
            val chainNamespace =
                (fields["chain"] as? JsonArray)
                    ?.mapNotNull { it as? JsonObject }
                    ?.firstOrNull { it.string("kind") == "namespace" }
                    ?.let { it["invitation"] as? JsonObject }
                    ?.takeIf { isSigned(it) }
                    ?.let { hex(SignedGroupOpenInvitation(snakeSignature(it)).invitation.groupId) }
            val namespaceId =
                listOfNotNull(chainNamespace, hex(signed.invitation.groupId), fields.string("groupId"))
                    .firstOrNull { it.isNotEmpty() } ?: return null
            val audienceId = fields.string("audienceId")?.ifBlank { null }
            val contextId = fields.string("contextId")?.ifBlank { null }
            val kind =
                if (fields.string("kind") == "audience" || (audienceId != null && contextId != null)) Kind.AUDIENCE else Kind.NAMESPACE
            return UpdatesInvitation(
                invitation = signed,
                kind = kind,
                namespaceId = namespaceId,
                companyName = (fields.string("groupAlias") ?: fields.string("groupName"))?.ifBlank { null },
                audienceId = audienceId,
                contextId = contextId,
                audienceName = fields.string("audienceName")?.ifBlank { null },
            )
        }

        private fun isSigned(o: JsonObject): Boolean =
            o["invitation"] is JsonObject && (o.string("inviter_signature") != null || o.string("inviterSignature") != null)

        /** Accept the camelCase spelling some nodes write. */
        private fun snakeSignature(o: JsonObject): JsonObject {
            if (o["inviter_signature"] != null) return o
            val camel = o["inviterSignature"] ?: return o
            return JsonObject(o.filterKeys { it != "inviterSignature" } + ("inviter_signature" to camel))
        }

        internal fun hex(bytes: List<Int>): String = bytes.joinToString("") { "%02x".format(it and 0xFF) }

        private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
    }
}
