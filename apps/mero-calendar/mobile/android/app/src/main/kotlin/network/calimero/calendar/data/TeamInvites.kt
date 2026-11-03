package network.calimero.calendar.data

import com.calimero.mero.app.OrgInvitation
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject

/** A team invitation, read from a link or a pasted code. */
data class TeamInvitation(
    val invitation: OrgInvitation,
) {
    /** The org (team) it admits to. */
    val namespaceId: String get() = invitation.namespaceId

    /** The team's name, for the "Join …?" prompt (unsigned: a hint only). */
    val teamName: String? get() = invitation.name
}

/**
 * Team invitations on Calimero 1.0: an org invite token in the SDK's link payload ([OrgInvitation],
 * shared with swift-sdk and the iOS app), the team's name in its `name`:
 *
 * - payload `{"invitation": "inv_…", "namespaceId": "<org>", "contextId"?: "…", "name"?: "<team>"}`,
 * - token `base58(deflate(payload))` ([InviteCodec]),
 * - link `https://links.calimero.network/com.calimero.mero-calendar/join?invitation=<token>`.
 *
 * The token is a bearer secret the org's node minted (`POST /orgs/{org}/invites`); joining redeems
 * it (`POST /invites/{token}/redeem`). Reading also takes a `data` envelope and the web app's
 * `__teamName` / `teamName` / `groupName` / `groupAlias`. A pre-1.0 signed group invitation is
 * refused: a 1.0 cluster can't redeem it.
 */
object TeamInvites {
    private val json = Json { ignoreUnknownKeys = true }

    fun link(
        invitation: OrgInvitation,
        teamName: String?,
    ): String = invitation.copy(name = teamName?.trim()?.ifEmpty { null } ?: invitation.name).link(CalendarConstants.PACKAGE_NAME)

    /** Read a link (https or calimero://), a bare token or raw JSON; null when it is no invitation to this app. */
    fun parse(input: String): TeamInvitation? {
        val token = InviteLink.tokenFromPasted(input.trim(), CalendarConstants.PACKAGE_NAME) ?: return null
        val decoded = if (token.startsWith("{")) token else InviteCodec.decode(token) ?: return null
        return parseJson(decoded)
    }

    /** Read the decoded payload JSON. */
    fun parseJson(payload: String): TeamInvitation? {
        val root = runCatching { json.parseToJsonElement(payload).jsonObject }.getOrNull() ?: return null
        val o = root["data"] as? JsonObject ?: root

        fun s(key: String) =
            (o[key] as? JsonPrimitive)
                ?.takeIf { it.isString }
                ?.contentOrNull
                ?.trim()
                ?.ifEmpty { null }
        val token = s("invitation") ?: return null
        val org = s("namespaceId") ?: return null
        val name = listOf("name", "__teamName", "teamName", "groupName", "groupAlias").firstNotNullOfOrNull(::s)
        return TeamInvitation(OrgInvitation(org, token, s("contextId"), name))
    }
}
