package network.calimero.issues.core

import com.calimero.mero.app.OrgInvitation
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/**
 * A workspace invitation on Calimero 1.0: the SDK's [OrgInvitation] link payload, with the web
 * app's extra fields beside it. (Swift `TrackerInvitation`.)
 *
 * - payload: `{"invitation": "inv_…", "namespaceId": "<org>", "name": "<workspace>", "groupAlias": "<workspace>", "kind": "namespace"}`
 * - token: `base58(deflate(payload))` ([InviteCodec])
 * - link: `https://links.calimero.network/com.calimero.mero-issue-tracker/join?invitation=<token>`
 *
 * The invite token is a bearer secret the org's node minted (`POST /orgs/{org}/invites`); joining
 * redeems it (`POST /invites/{token}/redeem`). Reading takes an optional `data` envelope; the name
 * comes from `name`, then the legacy `groupName` / `groupAlias`. A link naming another app is
 * refused, and so is a pre-1.0 signed group invitation (it can't be redeemed on a 1.0 cluster).
 */
data class TrackerInvitation(
    val invitation: OrgInvitation,
    val workspaceName: String?,
) {
    /** The org the invitation admits to. */
    val namespaceId: String get() = invitation.namespaceId

    /** The shareable token. */
    fun token(): String {
        val name = workspaceName ?: invitation.name
        return InviteCodec.encode(
            buildJsonObject {
                put("invitation", invitation.token)
                put("namespaceId", invitation.namespaceId)
                invitation.contextId?.let { put("contextId", it) }
                name?.let {
                    put("name", it)
                    put("groupAlias", it)
                }
                put("kind", "namespace")
            }.toString(),
        )
    }

    /** The shareable link. */
    fun link(): String = InviteLink.invitation(token(), Tracker.PACKAGE_NAME)

    companion object {
        private val json = Json { ignoreUnknownKeys = true }

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
            val token = inner.string("invitation")?.takeIf { it.isNotBlank() } ?: return null
            val org = inner.string("namespaceId")?.takeIf { it.isNotBlank() } ?: return null
            val name = listOf("name", "groupName", "groupAlias").firstNotNullOfOrNull { inner.string(it)?.trim()?.ifEmpty { null } }
            return TrackerInvitation(OrgInvitation(org, token, inner.string("contextId"), name), name)
        }

        private fun slugMatches(link: String): Boolean {
            val path = link.substringBefore('?').split('/').map { it.lowercase() }
            return Tracker.PACKAGE_NAME.lowercase() in path
        }

        private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
    }
}
