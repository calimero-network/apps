package network.calimero.pass.core

import com.calimero.mero.app.OrgInvitation
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import java.net.URI
import java.net.URLDecoder

/**
 * An invitation: Calimero 1.0's org invite token in the SDK's link shape ([OrgInvitation]), plus
 * which vault to open. (Swift `PassInvitation`.)
 *
 * - payload: `{"invitation": "inv_…", "namespaceId": "<team org>", "name": "<team name>",
 *   "contextId"?, "kind": "namespace" | "vault", "vaultId"?, "vaultName"?}`
 * - token: `base58(deflate(payload))` ([InviteCodec])
 * - link: `https://links.calimero.network/com.calimero.mero-pass/join?invitation=<token>`
 *
 * The web app's links carry the token alone (`…?invite=inv_…`); they read as a team invite whose
 * team the node names when it is redeemed.
 *
 * The token always grants the TEAM (an org; redeemed with `POST /invites/{token}/redeem`); a vault
 * invite only says which vault to open afterwards. No vault secret travels in it, but the token
 * itself is a bearer secret until it is used up. A pre-1.0 signed invitation is refused: a 1.0
 * cluster cannot redeem it.
 */
data class PassInvitation(
    val invitation: OrgInvitation,
    val kind: Kind = Kind.TEAM,
    val teamName: String? = null,
    val vaultId: String? = null,
    val vaultName: String? = null,
    val contextId: String? = null,
    /** The web's invite-only vault form: a vault the team invitation does not open by itself. */
    val isInviteOnlyVault: Boolean = false,
) {
    enum class Kind(
        val wire: String,
    ) {
        TEAM("namespace"),
        VAULT("vault"),
    }

    /** The team (org) it admits to; empty for a web link. */
    val namespaceId: String get() = invitation.namespaceId

    /** What to call it in a prompt: the vault for a vault invite, else the team. */
    val title: String
        get() =
            when {
                kind == Kind.VAULT && !vaultName.isNullOrEmpty() -> vaultName
                !teamName.isNullOrEmpty() -> teamName
                else -> "a team"
            }

    fun token(): String {
        val base = OrgInvitation(namespaceId, invitation.token, contextId?.nullIfBlank(), teamName?.nullIfBlank()).toJson()
        val payload =
            base.toMutableMap().apply {
                put("kind", JsonPrimitive(kind.wire))
                vaultId?.nullIfBlank()?.let { put("vaultId", JsonPrimitive(it)) }
                vaultName?.nullIfBlank()?.let { put("vaultName", JsonPrimitive(it)) }
                if (isInviteOnlyVault) put("inviteOnly", JsonPrimitive(true))
            }
        return InviteCodec.encode(JsonObject(payload).toString())
    }

    fun link(): String = InviteLink.invitation(token(), PassConstants.PACKAGE_NAME)

    companion object {
        /** The query parameter the web app's links carry the token in. */
        const val WEB_PARAM = "invite"

        private val json = Json { ignoreUnknownKeys = true }
        private val bareToken = Regex("^[A-Za-z0-9]+$")

        /** A link (https or `calimero://`), a bare token, or raw JSON. Null when it holds no invitation, and for another app's link. */
        fun parse(input: String): PassInvitation? {
            val trimmed = input.trim()
            if (trimmed.isEmpty()) return null
            if (trimmed.startsWith("{")) return parseJson(trimmed)
            webToken(trimmed)?.let { return PassInvitation(OrgInvitation("", it)) }
            val token = if (bareToken.matches(trimmed)) trimmed else tokenFromLink(trimmed) ?: return null
            return InviteCodec.decode(token)?.let(::parseJson)
        }

        /** The web app's `?invite=inv_…` (an http(s) link), or a bare `inv_…` token. */
        internal fun webToken(raw: String): String? {
            if (raw.startsWith("inv_") && raw.none { it.isWhitespace() || it == '/' || it == '?' }) return raw
            val uri = runCatching { URI(raw) }.getOrNull() ?: return null
            if (uri.scheme?.lowercase() !in setOf("http", "https")) return null
            return uri.rawQuery
                ?.split('&')
                ?.firstOrNull { it.substringBefore('=') == WEB_PARAM }
                ?.substringAfter('=', "")
                ?.let { URLDecoder.decode(it, "UTF-8") }
                ?.nullIfBlank()
        }

        /** Another app's link is refused: its path must name this app's slug. */
        private fun tokenFromLink(raw: String): String? = InviteLink.tokenFromPasted(raw, PassConstants.PACKAGE_NAME)

        /** The payload, under an optional `data` envelope, including the web's older `room*` names. */
        fun parseJson(text: String): PassInvitation? {
            val root = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull() ?: return null
            val inner = root["data"] as? JsonObject ?: root
            val base = OrgInvitation.decodeJson(inner.toString()) ?: return null
            val rawKind = inner.string("kind")
            return PassInvitation(
                invitation = base,
                kind = if (rawKind == "vault" || rawKind == "room") Kind.VAULT else Kind.TEAM,
                teamName = (base.name ?: inner.string("groupName") ?: inner.string("groupAlias"))?.nullIfBlank(),
                vaultId = (inner.string("vaultId") ?: inner.string("roomId"))?.nullIfBlank(),
                vaultName = (inner.string("vaultName") ?: inner.string("roomName"))?.nullIfBlank(),
                contextId = base.contextId?.nullIfBlank(),
                isInviteOnlyVault = (inner["inviteOnly"] as? JsonPrimitive)?.booleanOrNull ?: false,
            )
        }

        private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
    }
}
