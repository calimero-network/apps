package network.calimero.kombat.app

import com.calimero.mero.app.OrgInvitation
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink

/**
 * An invitation to one arena: kotlin-sdk's [OrgInvitation] (the link payload every Calimero 1.0 app
 * shares):
 *
 * - payload: JSON `{"invitation": "inv_…", "namespaceId": "…", "contextId": "…"}`
 * - token: `base58(deflate(payload))` ([InviteCodec])
 * - link: `https://links.calimero.network/com.calimero.mero-kombat/join?invitation=<token>`
 *
 * The invite token admits to the ORGANIZATION (one link lets someone into every arena in it); the app
 * instance id says which arena to open once in. (Swift `KombatInvitation`.)
 */
data class KombatInvitation(
    val invitation: OrgInvitation,
    val contextId: String,
) {
    /** The organization it admits to: the one the node minted the token for. */
    val namespaceId: String get() = invitation.namespaceId

    /** The shareable link. */
    fun link(): String = invitation.copy(contextId = contextId).link(KombatConstants.PACKAGE_NAME)

    companion object {
        /** [invitation] naming the arena [contextId]. */
        fun of(
            invitation: OrgInvitation,
            contextId: String,
        ): KombatInvitation = KombatInvitation(invitation.copy(contextId = contextId), contextId)

        /**
         * A pasted link, a deep link or a bare token; null when it is not a Mero Kombat invitation
         * (another app's link is refused: redeeming it would join that app's organization).
         */
        fun parse(input: String): KombatInvitation? {
            val token = InviteLink.tokenFromPasted(input.trim(), KombatConstants.PACKAGE_NAME) ?: return null
            val json = InviteCodec.decode(token) ?: return null
            return parseJson(json)
        }

        /** The decoded payload: an [OrgInvitation] that names the arena. A pre-1.0 signed invitation is refused. */
        fun parseJson(json: String): KombatInvitation? {
            val invitation = OrgInvitation.decodeJson(json) ?: return null
            val contextId = invitation.contextId?.takeIf { it.isNotEmpty() } ?: return null
            return KombatInvitation(invitation, contextId)
        }
    }
}
