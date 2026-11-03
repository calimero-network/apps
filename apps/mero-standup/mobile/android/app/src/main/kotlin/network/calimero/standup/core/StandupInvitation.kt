package network.calimero.standup.core

import com.calimero.mero.app.OrgInvitation
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * A team invitation on Calimero 1.0: the SDK's [OrgInvitation] link payload, naming the team (app
 * instance) to open (iOS `StandupInvitation`):
 *
 * - payload: JSON `{"invitation": "inv_…", "namespaceId": "<org>", "contextId": "<app instance>", "name"?: "<team>"}`
 * - token: `base58(deflate(payload))` ([InviteCodec], byte-compatible with fflate + bs58)
 * - link: `https://links.calimero.network/com.calimero.mero-standup/join?invitation=<token>`
 *
 * The invite token is a bearer secret the org's node minted; joining redeems it
 * (`POST /invites/{token}/redeem`). A pre-1.0 signed group invitation (an object under
 * `invitation`) is refused: a 1.0 cluster can't redeem it.
 */
class StandupInvitation(
    invitation: OrgInvitation,
    contextId: String? = null,
) {
    /** The team (app instance) to open once joined. */
    val contextId: String = contextId ?: invitation.contextId.orEmpty()

    /** The org invitation (its token is a bearer secret: whoever holds it may join). */
    val invitation: OrgInvitation = invitation.copy(contextId = this.contextId)

    /** The org it admits to. */
    val namespaceId: String get() = invitation.namespaceId

    /** The team's name, for the "Join …?" prompt. Unsigned: a hint only. */
    val name: String? get() = invitation.name

    /** The shareable link. */
    fun link(): String = invitation.link(PACKAGE_NAME)

    companion object {
        /** The registry package, which is also the links' slug (`APP_SLUG`). */
        const val PACKAGE_NAME = "com.calimero.mero-standup"

        /** Read a link (https or `calimero://`) or a bare token. Null when it is not a Mero Standup invitation. */
        fun parse(input: String): StandupInvitation? {
            val token = InviteLink.tokenFromPasted(input.trim(), PACKAGE_NAME) ?: return null
            val json = InviteCodec.decode(token) ?: return null
            return parseJson(json)
        }

        /** Read the decoded payload: token, org, team, and the name (`name`, then the legacy `teamName`). */
        fun parseJson(json: String): StandupInvitation? {
            val root = runCatching { Json.parseToJsonElement(json) as? JsonObject }.getOrNull() ?: return null

            fun s(key: String) =
                (root[key] as? JsonPrimitive)
                    ?.takeIf { it.isString }
                    ?.contentOrNull
                    ?.trim()
                    ?.ifEmpty { null }
            val token = s("invitation") ?: return null
            val org = s("namespaceId") ?: return null
            val contextId = s("contextId") ?: return null
            return StandupInvitation(OrgInvitation(org, token, contextId, s("name") ?: s("teamName")))
        }
    }
}
