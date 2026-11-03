package network.calimero.forum.core

import com.calimero.mero.app.OrgInvitation
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import java.net.URLDecoder

/**
 * An invitation on Calimero 1.0: the SDK's [OrgInvitation] link payload, plus the forum's own
 * fields beside it (which the SDK's decoder ignores). (Swift `ForumInvitation`.)
 *
 * - payload: `{"invitation": "inv_…", "namespaceId": "<org>", "contextId"?, "name": "<space name>",
 *   "kind": "namespace" | "forum", "forumId", "forumName"}`
 * - token: `base58(deflate(payload))` ([InviteCodec])
 * - link: `https://links.calimero.network/com.calimero.mero-forum/join?invitation=<token>`
 *
 * The web app's own link (`…?invite=inv_…&forum=<app id>`) parses too. The invite token always
 * admits to the ORG (the space; its forums are its app instances); `forumId` / `contextId` only say
 * where to land afterwards. A pre-1.0 signed group invitation is refused.
 */
data class ForumInvitation(
    val invitation: OrgInvitation,
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

    /** The org (space) it admits to; empty for a web link until it is redeemed. */
    val namespaceId: String get() = invitation.namespaceId

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
                put("invitation", invitation.token)
                put("namespaceId", namespaceId)
                contextId?.nullIfBlank()?.let { put("contextId", it) }
                spaceName?.nullIfBlank()?.let { put("name", it) }
                put("kind", kind.wire)
                forumId?.let { put("forumId", it) }
                forumName?.nullIfBlank()?.let { put("forumName", it) }
            }.toString(),
        )

    /** The shareable link. */
    fun link(): String = InviteLink.invitation(token(), ForumConstants.PACKAGE_NAME)

    companion object {
        /**
         * Parse a link (https or `calimero://`), the web app's `?invite=` link, a bare token or raw
         * JSON. Null when it holds no forum invitation, and for another app's link.
         */
        fun parse(input: String): ForumInvitation? {
            val trimmed = input.trim()
            if (trimmed.isEmpty()) return null
            if (trimmed.startsWith("{")) return parseJson(trimmed)
            webLink(trimmed)?.let { return it }
            val token = legacyToken(trimmed) ?: InviteLink.tokenFromPasted(trimmed, ForumConstants.PACKAGE_NAME) ?: return null
            return InviteCodec.decode(token)?.let(::parseJson)
        }

        /** The web app's Calimero 1.0 link: `…?invite=inv_…`, plus `&forum=<app id>` for a forum. */
        private fun webLink(raw: String): ForumInvitation? {
            val params = query(raw) ?: return null
            val token = params["invite"]?.takeIf { it.startsWith("inv_") } ?: return null
            val forum = params["forum"]?.nullIfBlank()
            return ForumInvitation(
                OrgInvitation("", token, forum),
                kind = if (forum == null) Kind.SPACE else Kind.FORUM,
                forumId = forum,
                contextId = forum,
            )
        }

        /** `…?invite=<code>`: what this app's web build shared before platform links. */
        private fun legacyToken(raw: String): String? {
            if ("invitation=" in raw) return null
            return query(raw)?.get("invite")
        }

        private fun query(raw: String): Map<String, String>? {
            if ('?' !in raw) return null
            return raw
                .substringAfter('?')
                .substringBefore('#')
                .split('&')
                .mapNotNull { pair ->
                    val key = pair.substringBefore('=', "")
                    val value = pair.substringAfter('=', "")
                    if (key.isEmpty() || value.isEmpty()) null else key to URLDecoder.decode(value, "UTF-8")
                }.toMap()
        }

        /**
         * Parse the decoded payload JSON: the token from the string `invitation`, the org from
         * `namespaceId`. A pre-1.0 signed invitation (an object under `invitation`) is refused.
         */
        fun parseJson(json: String): ForumInvitation? {
            val root = runCatching { Json.parseToJsonElement(json) as? JsonObject }.getOrNull() ?: return null
            val inner = root["data"] as? JsonObject ?: root

            fun text(key: String) = (inner[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull?.nullIfBlank()
            val token = text("invitation") ?: return null
            val org = text("namespaceId") ?: return null
            val name = listOf("name", "groupName", "groupAlias", "spaceName").firstNotNullOfOrNull(::text)
            val contextId = text("contextId")
            return ForumInvitation(
                OrgInvitation(org, token, contextId, name),
                kind = if (text("kind") == "forum") Kind.FORUM else Kind.SPACE,
                spaceName = name,
                forumId = text("forumId"),
                forumName = text("forumName"),
                contextId = contextId,
            )
        }
    }
}
