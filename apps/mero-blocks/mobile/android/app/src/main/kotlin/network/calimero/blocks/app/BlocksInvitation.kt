package network.calimero.blocks.app

import com.calimero.mero.admin.SignedGroupOpenInvitation
import com.calimero.mero.invite.AppInvitation
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * An invitation to one world, in the web app's form (`app/src/net/inviteCodec.ts`), so a link made
 * on the phone opens in the browser and the other way round:
 *
 * - payload: JSON `{"invitation": <SignedGroupOpenInvitation>, "groupAlias": "…", "contextId": "…", "groupId": "…"}`
 * - token: `base58(deflate(payload))` ([InviteCodec])
 * - link: `https://links.calimero.network/com.calimero.mero-blocks/join?invitation=<token>`
 *
 * A world is its own namespace, so the namespace invitation admits to exactly that world; `contextId`
 * and `groupId` say which context to enter once in. (Swift `BlocksInvitation`.)
 */
data class BlocksInvitation(
    val invitation: SignedGroupOpenInvitation,
    val name: String?,
    val contextId: String?,
    val groupId: String?,
) {
    val namespaceId: String get() = AppInvitation(invitation).namespaceId

    /** The shareable token. The signed invitation is passed through exactly as core sent it. */
    fun token(): String {
        val fields = linkedMapOf<String, JsonElement>("invitation" to invitation.raw)
        name?.let { fields["groupAlias"] = JsonPrimitive(it) }
        contextId?.let { fields["contextId"] = JsonPrimitive(it) }
        groupId?.let { fields["groupId"] = JsonPrimitive(it) }
        return InviteCodec.encode(JsonObject(fields).toString())
    }

    /** The shareable link. */
    fun link(): String = InviteLink.invitation(token(), BlocksConstants.PACKAGE_NAME)

    companion object {
        /**
         * A pasted link, a deep link or a bare token; null when it is not a Mero Blocks invitation
         * (another app's link is refused: redeeming it would join that app's namespace).
         */
        fun parse(input: String): BlocksInvitation? {
            val token = InviteLink.tokenFromPasted(input, BlocksConstants.PACKAGE_NAME) ?: return null
            val json = InviteCodec.decode(token) ?: return null
            return parseJson(json)
        }

        /** The wrapped form the web app mints, or a bare signed invitation (which carries no world ids). */
        fun parseJson(json: String): BlocksInvitation? {
            val app = AppInvitation.decodeJson(json) ?: return null
            val root = runCatching { Json.parseToJsonElement(json) as? JsonObject }.getOrNull()
            val inner = root?.get("data") as? JsonObject ?: root

            fun text(key: String): String? = (inner?.get(key) as? JsonPrimitive)?.contentOrNull?.trim()?.takeIf { it.isNotEmpty() }
            return BlocksInvitation(app.invitation, app.name, text("contextId"), text("groupId"))
        }
    }
}
