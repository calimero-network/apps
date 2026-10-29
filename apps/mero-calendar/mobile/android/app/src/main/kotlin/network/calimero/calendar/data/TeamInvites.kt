package network.calimero.calendar.data

import com.calimero.mero.admin.SignedGroupOpenInvitation
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/** A team invitation, read from a link or a pasted code. */
data class TeamInvitation(
    /** The namespace (team) it admits to, 64 hex. */
    val namespaceId: String,
    /** The signed envelope, verbatim: re-encoding it any other way breaks its signature. */
    val invitation: SignedGroupOpenInvitation,
    /** The team's name, when the inviter put it in the payload. */
    val teamName: String?,
)

/**
 * Invitation links in the web app's format (`app/src/utils/invitation.ts` + `TeamsPage`), so a
 * link minted on either side opens on the other:
 *
 * - payload `{"invitation": <SignedGroupOpenInvitation>, "__teamName": "<team>"}`,
 * - token `base58(deflate(payload))` ([InviteCodec]),
 * - link `https://links.calimero.network/com.calimero.mero-calendar/join?invitation=<token>`.
 */
object TeamInvites {
    private val json = Json { ignoreUnknownKeys = true }

    fun payload(
        invitation: SignedGroupOpenInvitation,
        teamName: String?,
    ): String =
        buildJsonObject {
            put("invitation", invitation.raw)
            teamName?.trim()?.takeIf { it.isNotEmpty() }?.let { put("__teamName", it) }
        }.toString()

    fun link(
        invitation: SignedGroupOpenInvitation,
        teamName: String?,
    ): String = InviteLink.invitation(InviteCodec.encode(payload(invitation, teamName)), CalendarConstants.PACKAGE_NAME)

    /** Read a link (https or calimero://), a bare token or raw JSON; null when it is no invitation to this app. */
    fun parse(input: String): TeamInvitation? {
        val trimmed = input.trim()
        if (isForeignLink(trimmed)) return null
        val root = decodeRoot(trimmed) ?: return null
        val outer = root["invitation"] as? JsonObject ?: root
        val inner = outer["invitation"] as? JsonObject ?: return null
        val namespaceId = groupIdOf(inner) ?: return null
        val name =
            listOf("__teamName", "groupName", "groupAlias")
                .firstNotNullOfOrNull { (root[it] as? JsonPrimitive)?.contentOrNull?.trim()?.ifEmpty { null } }
        return TeamInvitation(namespaceId, SignedGroupOpenInvitation(outer), name)
    }

    /** The payload object behind a link, a bare token or raw JSON. */
    private fun decodeRoot(input: String): JsonObject? {
        val token = InviteLink.tokenFromPasted(input) ?: return null
        val decoded = if (token.startsWith("{")) token else InviteCodec.decode(token)
        return decoded?.let { runCatching { json.parseToJsonElement(it).jsonObject }.getOrNull() }
    }

    /** A link whose path names another app: its invitation would join that app's namespace. */
    private fun isForeignLink(input: String): Boolean {
        val lower = input.lowercase()
        if (!lower.startsWith("http") && !lower.startsWith("calimero://")) return false
        val path = lower.substringBefore('?')
        return !path.contains(CalendarConstants.PACKAGE_NAME)
    }

    private fun groupIdOf(inner: JsonObject): String? =
        when (val raw = inner["group_id"] ?: inner["groupId"]) {
            is JsonArray -> {
                val bytes = raw.mapNotNull { (it as? JsonPrimitive)?.intOrNull }
                if (bytes.size == raw.size && bytes.isNotEmpty()) bytes.joinToString("") { "%02x".format(it and 0xff) } else null
            }
            is JsonPrimitive -> raw.contentOrNull?.ifEmpty { null }?.lowercase()
            else -> null
        }
}
