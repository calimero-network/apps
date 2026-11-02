package network.calimero.updates.core

import com.calimero.mero.app.OrgInvitation
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import java.net.URI
import java.net.URLDecoder

/**
 * A company or audience invitation: Calimero 1.0's org invite token in the SDK's link shape
 * ([OrgInvitation]), plus where to land. (Swift `UpdatesInvitation`.)
 *
 * - payload: JSON `{"invitation": "inv_…", "namespaceId": <org>, "contextId"?, "name"?: <company name>,
 *   "kind": "namespace"|"audience", "audienceId"?, "audienceName"?}`
 * - token: `base58(deflate(payload))` ([InviteCodec], byte-compatible with fflate + bs58)
 * - link: `https://links.calimero.network/com.calimero.mero-updates/join?invitation=<token>`
 *
 * The grant is always the org (audiences are open teams, reachable by every company member):
 * redeeming the token (`POST /invites/{token}/redeem`) joins the org it belongs to; `audienceId` /
 * `contextId` only say where to land. A pre-1.0 signed invitation is refused (a 1.0 cluster cannot
 * redeem it).
 */
class UpdatesInvitation(
    /** The org invite token. */
    val invitation: OrgInvitation,
    val kind: Kind,
    /** The org (company) it admits to. */
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

    /** The SDK's [OrgInvitation] JSON with this app's landing fields beside it. */
    fun payload(): String {
        val base = OrgInvitation(namespaceId, invitation.token, contextId?.ifBlank { null }, companyName?.ifBlank { null }).toJson()
        val extra =
            buildMap {
                put("kind", JsonPrimitive(kind.wire))
                audienceId?.ifBlank { null }?.let { put("audienceId", JsonPrimitive(it)) }
                audienceName?.ifBlank { null }?.let { put("audienceName", JsonPrimitive(it)) }
            }
        return JsonObject(base + extra).toString()
    }

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
            val candidate = legacyCode(trimmed) ?: trimmed
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

        /** Read the decoded payload (under an optional `data` envelope). A 0.x payload (a signed object as `invitation`) is refused. */
        fun parseJson(json: String): UpdatesInvitation? {
            val parsed = runCatching { Json.parseToJsonElement(json) as? JsonObject }.getOrNull() ?: return null
            val root = parsed["data"] as? JsonObject ?: parsed
            val base = OrgInvitation.decodeJson(root.toString()) ?: return null
            val audienceId = root.string("audienceId")?.ifBlank { null }
            val contextId = base.contextId?.ifBlank { null }
            val kind =
                if (root.string("kind") == "audience" || (audienceId != null && contextId != null)) Kind.AUDIENCE else Kind.NAMESPACE
            return UpdatesInvitation(
                invitation = base,
                kind = kind,
                namespaceId = base.namespaceId,
                companyName = (base.name ?: root.string("groupAlias"))?.ifBlank { null },
                audienceId = audienceId,
                contextId = contextId,
                audienceName = root.string("audienceName")?.ifBlank { null },
            )
        }

        private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
    }
}
