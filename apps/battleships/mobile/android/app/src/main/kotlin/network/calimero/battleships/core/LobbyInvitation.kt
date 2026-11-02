package network.calimero.battleships.core

import com.calimero.mero.app.OrgInvitation
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * A lobby invitation: Calimero 1.0's org invite token in the SDK's link shape ([OrgInvitation]),
 * plus the inviter's account. (Swift `LobbyInvitation`.)
 *
 * - payload: `{"invitation": "inv_…", "namespaceId": "<org>", "name": "<lobby name>",
 *   "__lobbyName": "<lobby name>", "__inviterKey": "<account>"}`; the SDK reads the first three
 *   and ignores the rest
 * - token: `base58(deflate(payload))` ([InviteCodec])
 * - link: `https://links.calimero.network/com.calimero.battleships/join?invitation=<token>`
 *
 * The token is a bearer secret the org's node minted (`POST /orgs/{org}/invites`); redeeming it
 * (`POST /invites/{token}/redeem`) is what admits, so a wrapper naming another org cannot redirect
 * a join: the node joins the org the token belongs to.
 */
data class LobbyInvitation(
    val invitation: OrgInvitation,
    val lobbyName: String? = null,
    /** The inviter's account, so the joiner has someone to challenge straight away. */
    val inviterKey: String? = null,
) {
    /** The org (lobby) it admits to. */
    val namespaceId: String get() = invitation.namespaceId

    val title: String get() = lobbyName?.takeIf { it.isNotEmpty() } ?: "a lobby"

    fun token(): String {
        val name = lobbyName?.trim()?.takeIf { it.isNotEmpty() }
        val base = invitation.copy(name = name)
        val payload = base.toJson().toMutableMap()
        name?.let { payload[LOBBY_NAME_KEY] = JsonPrimitive(it) }
        inviterKey?.takeIf { isKey(it) }?.let { payload[INVITER_KEY_KEY] = JsonPrimitive(it) }
        return InviteCodec.encode(JsonObject(payload).toString())
    }

    fun link(): String = InviteLink.invitation(token(), Battleships.PACKAGE_NAME)

    companion object {
        private const val MAX_KEY = 128
        internal const val LOBBY_NAME_KEY = "__lobbyName"
        internal const val INVITER_KEY_KEY = "__inviterKey"
        private val json = Json { ignoreUnknownKeys = true }

        /**
         * A link (https or `calimero://`), a bare token or raw JSON. Null when it holds no lobby
         * invitation, and for another app's link. Pre-1.0 signed invitations are not read: a 1.0
         * cluster cannot redeem them.
         */
        fun parse(input: String): LobbyInvitation? {
            val trimmed = input.trim()
            if (trimmed.isEmpty()) return null
            if (trimmed.startsWith("{")) return parseJson(trimmed)
            val token = InviteLink.tokenFromPasted(trimmed, Battleships.PACKAGE_NAME) ?: return null
            return InviteCodec.decode(token)?.let(::parseJson)
        }

        fun parseJson(text: String): LobbyInvitation? {
            val root = runCatching { json.parseToJsonElement(text) as? JsonObject }.getOrNull() ?: return null
            val base = OrgInvitation.decodeJson(text) ?: return null
            val name = listOfNotNull(root[LOBBY_NAME_KEY].stringOrNull(), base.name).map { it.trim() }.firstOrNull { it.isNotEmpty() }
            val key = root[INVITER_KEY_KEY].stringOrNull()?.takeIf { isKey(it) }
            return LobbyInvitation(base, name, key)
        }

        /** Whether [value] can be a player: an account id (opaque on 1.0; no spaces, at most 128). */
        internal fun isKey(value: String): Boolean {
            val trimmed = value.trim()
            return trimmed.isNotEmpty() && trimmed.length <= MAX_KEY && trimmed.none { it.isWhitespace() }
        }
    }
}
