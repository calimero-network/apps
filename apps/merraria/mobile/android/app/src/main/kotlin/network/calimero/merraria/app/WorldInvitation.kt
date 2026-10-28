package network.calimero.merraria.app

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
 * - link: `https://links.calimero.network/com.calimero.merraria/join?invitation=<token>`
 *
 * The invitation admits to the world's namespace (one namespace per world); [groupId] is the open
 * subgroup the world lives in and [contextId] the world itself. Both are optional on the wire, as on
 * the web: an invitation without them opens the namespace's first world. (Swift `WorldInvitation`.)
 */
data class WorldInvitation(
    val invitation: SignedGroupOpenInvitation,
    val worldName: String?,
    val contextId: String?,
    val groupId: String?,
) {
    /** The namespace the invitation admits to. */
    val namespaceId: String get() = AppInvitation(invitation).namespaceId

    /** The shareable token. The signed invitation is passed through exactly as core sent it. */
    fun token(): String {
        val fields = linkedMapOf<String, JsonElement>("invitation" to invitation.raw)
        worldName?.let { fields["groupAlias"] = JsonPrimitive(it) }
        contextId?.let { fields["contextId"] = JsonPrimitive(it) }
        groupId?.let { fields["groupId"] = JsonPrimitive(it) }
        return InviteCodec.encode(JsonObject(fields).toString())
    }

    /** The shareable link. */
    fun link(): String = InviteLink.invitation(token(), MerrariaConstants.PACKAGE_NAME)

    companion object {
        /**
         * A pasted link, a deep link or a bare token; null when it is not a Merraria invitation
         * (another app's link is refused: redeeming it would join that app's namespace).
         */
        fun parse(input: String): WorldInvitation? {
            val token = InviteLink.tokenFromPasted(input, MerrariaConstants.PACKAGE_NAME) ?: return null
            val json = InviteCodec.decode(token) ?: return null
            return parseJson(json)
        }

        /** The decoded payload: the wrapped form or a bare signed invitation, as the web's `decodeInvite`. */
        fun parseJson(json: String): WorldInvitation? {
            val app = AppInvitation.decodeJson(json) ?: return null
            val root = runCatching { Json.parseToJsonElement(json) as? JsonObject }.getOrNull()
            val inner = root?.get("data") as? JsonObject ?: root

            fun text(key: String): String? = (inner?.get(key) as? JsonPrimitive)?.contentOrNull?.trim()?.takeIf { it.isNotEmpty() }
            return WorldInvitation(app.invitation, app.name, text("contextId"), text("groupId"))
        }
    }
}
