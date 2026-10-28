package network.calimero.battleships.core

import com.calimero.mero.admin.SignedGroupOpenInvitation
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put

/**
 * A lobby invitation in the web app's format (`app/src/utils/invitation.ts`), so a link minted on
 * either side opens on the other. (Swift `LobbyInvitation`.)
 *
 * - payload: the recursive shape the web reader takes,
 *   `{"invitations": [{"groupId": "<namespace hex>", "invitation": <SignedGroupOpenInvitation>,
 *   "groupAlias": "<lobby name>"}], "__lobbyName": "<lobby name>", "__inviterKey": "<player key>"}`;
 *   the single `{"invitation": {…}, "inviter_signature": …}` shape is read too
 * - token: `base58(deflate(payload))` ([InviteCodec])
 * - link: `https://links.calimero.network/com.calimero.battleships/join?invitation=<token>`
 */
data class LobbyInvitation(
    val invitation: SignedGroupOpenInvitation,
    val lobbyName: String? = null,
    /** The inviter's player key, so the joiner has someone to challenge straight away. */
    val inviterKey: String? = null,
) {
    /** The namespace it admits to: the hex of its SIGNED `group_id`, never a field beside it. */
    val namespaceId: String
        get() {
            val inner = invitation.raw["invitation"] as? JsonObject ?: return ""
            return when (val raw = inner["group_id"] ?: inner["groupId"]) {
                is JsonArray -> raw.mapNotNull { (it as? JsonPrimitive)?.intOrNull }.joinToString("") { "%02x".format(it and BYTE_MASK) }
                is JsonPrimitive -> raw.contentOrNull.orEmpty().lowercase()
                else -> ""
            }
        }

    val title: String get() = lobbyName?.takeIf { it.isNotEmpty() } ?: "a lobby"

    fun token(): String {
        val name = lobbyName?.trim()?.takeIf { it.isNotEmpty() }
        val payload =
            buildJsonObject {
                put(
                    "invitations",
                    buildJsonArray {
                        add(
                            buildJsonObject {
                                put("groupId", namespaceId)
                                put("invitation", invitation.raw)
                                name?.let { put("groupAlias", it) }
                            },
                        )
                    },
                )
                name?.let { put(LOBBY_NAME_KEY, it) }
                inviterKey?.takeIf { isKey(it) }?.let { put(INVITER_KEY_KEY, it) }
            }
        return InviteCodec.encode(payload.toString())
    }

    fun link(): String = InviteLink.invitation(token(), Battleships.PACKAGE_NAME)

    companion object {
        private const val BYTE_MASK = 0xff
        private const val KEY_LENGTH = 64
        internal const val LOBBY_NAME_KEY = "__lobbyName"
        internal const val INVITER_KEY_KEY = "__inviterKey"
        private val json = Json { ignoreUnknownKeys = true }

        /** A link (https or `calimero://`), a bare token or raw JSON. Null for anything else and other apps' links. */
        fun parse(input: String): LobbyInvitation? {
            val trimmed = input.trim()
            if (trimmed.isEmpty()) return null
            if (trimmed.startsWith("{")) return parseJson(trimmed)
            val token = tokenFromLink(trimmed) ?: return null
            return InviteCodec.decode(token)?.let(::parseJson)
        }

        /** As the Swift SDK's `token(fromPasted:expectedSlug:)`: another app's link is refused. */
        private fun tokenFromLink(raw: String): String? {
            val lower = raw.lowercase()
            val isLink = lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("calimero://")
            if (isLink) {
                val segments = raw.substringBefore('?').split('/').map { it.lowercase() }
                if (Battleships.PACKAGE_NAME !in segments) return null
            }
            return InviteLink.tokenFromPasted(raw)
        }

        fun parseJson(text: String): LobbyInvitation? {
            val root = runCatching { json.parseToJsonElement(text) as? JsonObject }.getOrNull() ?: return null
            val name = root[LOBBY_NAME_KEY].stringOrNull()?.trim()
            val key = root[INVITER_KEY_KEY].stringOrNull()?.takeIf { isKey(it) }
            val list = root["invitations"] as? JsonArray
            val first = list?.firstOrNull() as? JsonObject
            val (signed, alias) =
                when {
                    first != null -> (first["invitation"] as? JsonObject) to first["groupAlias"].stringOrNull()
                    isEnvelope(root) -> root to root["groupAlias"].stringOrNull()
                    else -> return null
                }
            if (signed == null || !isEnvelope(signed)) return null
            val title = listOfNotNull(name, alias).firstOrNull { it.isNotEmpty() }
            return LobbyInvitation(signed(signed), title, key)
        }

        private fun isEnvelope(obj: JsonObject): Boolean =
            obj["invitation"] is JsonObject && (obj["inviter_signature"].stringOrNull() != null || obj["inviterSignature"].stringOrNull() != null)

        /** The envelope verbatim, with a camelCase signature key renamed to core's spelling. */
        private fun signed(obj: JsonObject): SignedGroupOpenInvitation {
            val camel = obj["inviterSignature"]
            if (obj["inviter_signature"] != null || camel == null) return SignedGroupOpenInvitation(obj)
            return SignedGroupOpenInvitation(JsonObject(obj.filterKeys { it != "inviterSignature" } + ("inviter_signature" to camel)))
        }

        internal fun isKey(value: String): Boolean {
            val trimmed = value.trim()
            return trimmed.length == KEY_LENGTH && trimmed.all { it.isDigit() || it.lowercaseChar() in 'a'..'f' }
        }
    }
}
