package network.calimero.chess.app

import com.calimero.mero.app.OrgInvitation
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * An invitation to one table, as the Kotlin SDK's [OrgInvitation] link payload, so a link made on
 * the phone opens in the browser and the other way round:
 *
 * - payload: JSON `{"invitation": "inv_…", "namespaceId": "<org>", "contextId": "<table>", "name": "<club, optional>"}`
 * - token: `base58(deflate(payload))` ([InviteCodec])
 * - link: `https://links.calimero.network/com.calimero.mero-chess/join?invitation=<token>`
 *
 * On Calimero 1.0 the invitation is an org invite token (`POST /orgs/{org}/invites`), redeemed with
 * `POST /invites/{token}/redeem`. It admits to the ORG (one link lets someone into every table in
 * it); the context id says which app instance (table) to open once in. A bearer secret: anyone
 * holding the link can join until it expires. Pre-1.0 signed group invitations are refused.
 * (Swift `ChessInvitation`.)
 */
data class ChessInvitation(
    /** The invite, with [contextId] set. */
    val invitation: OrgInvitation,
    val namespaceId: String,
    val contextId: String,
) {
    /** The shareable link. */
    fun link(): String = invitation.copy(namespaceId = namespaceId, contextId = contextId).link(ChessConstants.PACKAGE_NAME)

    companion object {
        /** The invitation for [contextId], built from an invite the node minted for [namespaceId]. */
        fun of(
            minted: OrgInvitation,
            namespaceId: String,
            contextId: String,
        ): ChessInvitation = ChessInvitation(minted.copy(namespaceId = namespaceId, contextId = contextId), namespaceId, contextId)

        /**
         * A pasted link, a deep link or a bare token; null when it is not a Mero Chess invitation
         * (another app's link is refused: redeeming it would join that app's org).
         */
        fun parse(input: String): ChessInvitation? {
            val token = InviteLink.tokenFromPasted(input.trim(), ChessConstants.PACKAGE_NAME) ?: return null
            val json = InviteCodec.decode(token) ?: return null
            return parseJson(json)
        }

        /** The decoded payload: the token from the string `invitation`, the org from `namespaceId`, the table from `contextId`. */
        fun parseJson(json: String): ChessInvitation? {
            val fields = runCatching { Json.parseToJsonElement(json) as? JsonObject }.getOrNull() ?: return null
            val namespaceId = fields.text("namespaceId") ?: return null
            val contextId = fields.text("contextId") ?: return null
            val token = fields.text("invitation") ?: return null
            return of(OrgInvitation(namespaceId, token, name = fields.text("name")), namespaceId, contextId)
        }

        private fun JsonObject.text(key: String): String? =
            (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull?.takeIf { it.isNotEmpty() }
    }
}
