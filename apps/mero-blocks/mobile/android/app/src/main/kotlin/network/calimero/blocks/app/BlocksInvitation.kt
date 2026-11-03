package network.calimero.blocks.app

import com.calimero.mero.app.OrgInvitation
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * An invitation to one world: the SDK's [OrgInvitation] (the link payload every Calimero 1.0 app
 * shares), plus the world's team for links from the earlier 1.0 build. (Swift `BlocksInvitation`.)
 *
 * - payload: JSON `{"invitation": "inv_…", "namespaceId": "…", "contextId": "…", "name": "…", "groupId"?: "…"}`
 * - token: `base58(deflate(payload))` ([InviteCodec])
 * - link: `https://links.calimero.network/com.calimero.mero-blocks/join?invitation=<token>`
 *
 * A world is its own organization (one per world), so the invite token admits to exactly that
 * world; `contextId` (its app instance) says what to enter once in.
 *
 * The web app's own link (`<frontend>/?invite=inv_…`) is read too: it names no world, so the
 * organization's first world opens once the token is redeemed.
 */
class BlocksInvitation(
    invitation: OrgInvitation,
    name: String?,
    contextId: String?,
    val groupId: String?,
) {
    val invitation: OrgInvitation = OrgInvitation(invitation.namespaceId, invitation.token, contextId ?: invitation.contextId, name ?: invitation.name)

    /** The world's organization: the one the node minted the token for. */
    val namespaceId: String get() = invitation.namespaceId
    val name: String? get() = invitation.name
    val contextId: String? get() = invitation.contextId
    val id: String get() = contextId ?: namespaceId

    /** The shareable token. */
    fun token(): String {
        val payload = invitation.toJson()
        return InviteCodec.encode(JsonObject(if (groupId == null) payload else payload + ("groupId" to JsonPrimitive(groupId))).toString())
    }

    /** The shareable link. */
    fun link(): String = InviteLink.invitation(token(), BlocksConstants.PACKAGE_NAME)

    companion object {
        /**
         * A pasted link, a deep link or a bare token; null when it is not a Mero Blocks invitation
         * (another app's link is refused: redeeming it would join that app's organization).
         */
        fun parse(input: String): BlocksInvitation? {
            parseWebLink(input)?.let { return it }
            val token = InviteLink.tokenFromPasted(input, BlocksConstants.PACKAGE_NAME) ?: return null
            val json = InviteCodec.decode(token) ?: return null
            return parseJson(json)
        }

        /**
         * The decoded payload. Only an [OrgInvitation] (an `inv_…` token and its organization) is an
         * invitation; a pre-1.0 signed one is not. A link without `contextId` opens the world's first
         * app instance.
         */
        fun parseJson(json: String): BlocksInvitation? {
            val invitation = OrgInvitation.decodeJson(json) ?: return null
            val root = runCatching { Json.parseToJsonElement(json) as? JsonObject }.getOrNull()

            fun trimmed(value: String?): String? = value?.trim()?.takeIf { it.isNotEmpty() }
            val groupId = (root?.get("groupId") as? JsonPrimitive)?.contentOrNull
            return BlocksInvitation(invitation, trimmed(invitation.name), trimmed(invitation.contextId), trimmed(groupId))
        }

        /** The web frontend's link, `?invite=inv_…`: a token with no organization named, learnt by redeeming it. */
        fun parseWebLink(input: String): BlocksInvitation? {
            val trimmed = input.trim()
            if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) return null
            val token =
                trimmed
                    .substringAfter('?', "")
                    .substringBefore('#')
                    .split('&')
                    .map { it.split('=', limit = 2) }
                    .firstOrNull { it.size == 2 && it[0] == "invite" }
                    ?.let { java.net.URLDecoder.decode(it[1], "UTF-8") }
                    ?.takeIf { it.startsWith("inv_") } ?: return null
            return BlocksInvitation(OrgInvitation("", token), null, null, null)
        }
    }
}
