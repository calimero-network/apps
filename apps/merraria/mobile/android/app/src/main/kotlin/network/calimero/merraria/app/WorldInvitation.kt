package network.calimero.merraria.app

import com.calimero.mero.app.OrgInvitation
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * An invitation to one world: kotlin-sdk's [OrgInvitation] (the link payload every Calimero 1.0 app
 * shares), plus the world's team when it has one:
 *
 * - payload: JSON `{"invitation": "inv_…", "namespaceId": "…", "contextId"?: "…", "name"?: "…", "groupId"?: "…"}`
 * - token: `base58(deflate(payload))` ([InviteCodec])
 * - link: `https://links.calimero.network/com.calimero.merraria/join?invitation=<token>`
 *
 * The invite token admits to the world's organization (one per world); [contextId] is the world's
 * app instance and [groupId] the team it lives in (worlds made by an earlier build). Both are
 * optional: an invitation without them opens the organization's first world. (Swift `WorldInvitation`.)
 */
data class WorldInvitation(
    val invitation: OrgInvitation,
    val groupId: String?,
) {
    /** The organization the invitation admits to: the one the node minted the token for. */
    val namespaceId: String get() = invitation.namespaceId
    val worldName: String? get() = invitation.name
    val contextId: String? get() = invitation.contextId

    /** The shareable token. */
    fun token(): String {
        val fields = LinkedHashMap<String, JsonElement>(invitation.toJson())
        groupId?.let { fields["groupId"] = JsonPrimitive(it) }
        return InviteCodec.encode(JsonObject(fields).toString())
    }

    /** The shareable link. */
    fun link(): String = InviteLink.invitation(token(), MerrariaConstants.PACKAGE_NAME)

    companion object {
        /** [invitation] naming the world [contextId] called [worldName], in team [groupId]. */
        fun of(
            invitation: OrgInvitation,
            worldName: String?,
            contextId: String?,
            groupId: String?,
        ): WorldInvitation =
            WorldInvitation(
                invitation.copy(contextId = contextId ?: invitation.contextId, name = worldName ?: invitation.name),
                groupId,
            )

        /**
         * A pasted link, a deep link or a bare token; null when it is not a Merraria invitation
         * (another app's link is refused: redeeming it would join that app's organization).
         */
        fun parse(input: String): WorldInvitation? {
            val token = InviteLink.tokenFromPasted(input.trim(), MerrariaConstants.PACKAGE_NAME) ?: return null
            val json = InviteCodec.decode(token) ?: return null
            return parseJson(json)
        }

        /** The decoded payload. Only an [OrgInvitation] (an `inv_…` token and its organization) is an invitation; a pre-1.0 signed one is not. */
        fun parseJson(json: String): WorldInvitation? {
            val invitation = OrgInvitation.decodeJson(json) ?: return null
            val root = runCatching { Json.parseToJsonElement(json) as? JsonObject }.getOrNull()

            fun text(value: String?): String? = value?.trim()?.takeIf { it.isNotEmpty() }
            val groupId = text((root?.get("groupId") as? JsonPrimitive)?.contentOrNull)
            return WorldInvitation(invitation.copy(contextId = text(invitation.contextId), name = text(invitation.name)), groupId)
        }
    }
}
