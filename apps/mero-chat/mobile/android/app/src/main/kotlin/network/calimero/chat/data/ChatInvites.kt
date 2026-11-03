package network.calimero.chat.data

import com.calimero.mero.app.OrgInvitation
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** A workspace invitation, read from a link or a pasted code. */
data class ChatInvitation(
    /** The org (workspace) it admits to; `""` for the web app's link, which carries the token only. */
    val namespaceId: String,
    /** The org invite token and what the link says about it. */
    val invitation: OrgInvitation,
    /** The workspace's name, when the inviter put it in the payload (unsigned: a hint only). */
    val workspaceName: String?,
)

/**
 * Workspace invitations on Calimero 1.0: an org invite token (`POST /orgs/{org}/invites`, a passkey
 * step-up to mint), redeemed with `POST /invites/{token}/redeem`. (Swift `ChatInvitation`.)
 *
 * - payload: kotlin-sdk's [OrgInvitation], `{"invitation": "inv_…", "namespaceId": "<org>", "name"?: "<workspace>"}`
 *   (a `{data: …}` wrapper and the web's `groupName` / `groupAlias` name keys are read too),
 * - token: `base58(deflate(payload))` ([InviteCodec]),
 * - link: `https://links.calimero.network/com.calimero.chat/join?invitation=<token>` ([InviteLink]).
 *
 * The web app (#730) shares its own link instead, `https://<its origin>/?invite=inv_…`: the token
 * alone. Those, and a bare `inv_…` token, parse too, with no org: the node names it on redemption.
 * A 0.x signed group invitation is refused, since a 1.0 cluster cannot redeem it.
 */
object ChatInvites {
    /** The package the web app's links name (`APP_SLUG`). */
    const val APP_SLUG = "com.calimero.chat"

    /** The shareable link for [invitation]. */
    fun link(
        invitation: OrgInvitation,
        workspaceName: String?,
    ): String = invitation.copy(name = workspaceName?.ifEmpty { null } ?: invitation.name).link(APP_SLUG)

    /** Read a link (https or calimero://), a bare token, the web app's `?invite=` link; null when it is none of them. */
    fun parse(input: String): ChatInvitation? = parseLink(input) ?: webToken(input)?.let { ChatInvitation("", OrgInvitation("", it), null) }

    private fun parseLink(input: String): ChatInvitation? {
        val json = InviteLink.tokenFromPasted(input, APP_SLUG)?.let { InviteCodec.decode(it) } ?: return null
        val root = runCatching { chatJson.parseToJsonElement(json).jsonObject }.getOrNull() ?: return null
        val inner = root["data"] as? JsonObject ?: root
        val invitation = OrgInvitation.decodeJson(inner.toString()) ?: return null
        val name = (listOf(invitation.name) + NAME_KEYS.map { inner.string(it) }).firstNotNullOfOrNull { it?.trim()?.ifEmpty { null } }
        return ChatInvitation(invitation.namespaceId, invitation.copy(name = name), name)
    }

    /** The token of the web app's link (`?invite=inv_…`), or a bare `inv_…` token. */
    fun webToken(input: String): String? {
        val trimmed = input.trim()
        if (trimmed.contains("://")) {
            return trimmed
                .toHttpUrlOrNull()
                ?.queryParameter("invite")
                ?.trim()
                ?.takeIf { it.startsWith(TOKEN_PREFIX) }
        }
        return trimmed.takeIf { it.startsWith(TOKEN_PREFIX) && it.all { c -> c.isLetterOrDigit() || c in "_-." } }
    }

    private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

    private const val TOKEN_PREFIX = "inv_"

    /** Where older payloads name their workspace. */
    private val NAME_KEYS = listOf("groupName", "groupAlias", "spaceName")
}

/** Accounts as the contract writes them. */
object ChatIdentity {
    /**
     * How the contract names an account: on the component runtime the caller is the node's account
     * id as it is (`sender`, reaction and profile identities); v1 used base58 `UserId`s. Null for none.
     */
    fun userIdOf(account: String?): String? = account?.trim()?.ifEmpty { null }

    /** A short form of an id, for someone with no profile yet. */
    fun short(userId: String): String = if (userId.length <= SHORT_LEN) userId else userId.take(SHORT_LEN) + "…"

    private const val SHORT_LEN = 8
}
