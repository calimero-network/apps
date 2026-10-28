package network.calimero.chess.app

import com.calimero.mero.admin.SignedGroupOpenInvitation
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * An invitation to one table, in the web app's form (`app/src/utils/invitation.ts`), so a link made
 * on the phone opens in the browser and the other way round:
 *
 * - payload: JSON `{"invitation": <SignedGroupOpenInvitation>, "namespaceId": "…", "contextId": "…"}`
 * - token: `base58(deflate(payload))` ([InviteCodec])
 * - link: `https://links.calimero.network/com.calimero.mero-chess/join?invitation=<token>`
 *
 * The invitation admits to the NAMESPACE (one link lets someone into every table in it); the
 * context id says which table to open once in. (Swift `ChessInvitation`.)
 */
data class ChessInvitation(
    val invitation: SignedGroupOpenInvitation,
    val namespaceId: String,
    val contextId: String,
) {
    /** The shareable link. The signed invitation is passed through exactly as core sent it. */
    fun link(): String {
        val payload =
            JsonObject(
                mapOf(
                    "invitation" to invitation.raw,
                    "namespaceId" to JsonPrimitive(namespaceId),
                    "contextId" to JsonPrimitive(contextId),
                ),
            )
        return InviteLink.invitation(InviteCodec.encode(payload.toString()), ChessConstants.PACKAGE_NAME)
    }

    companion object {
        /**
         * A pasted link, a deep link or a bare token; null when it is not a Mero Chess invitation
         * (another app's link is refused: redeeming it would join that app's namespace).
         */
        fun parse(input: String): ChessInvitation? {
            val trimmed = input.trim()
            val lower = trimmed.lowercase()
            val isLink = lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("calimero://")
            if (isLink && !slugMatches(trimmed)) return null
            val token = InviteLink.tokenFromPasted(trimmed) ?: return null
            val json = InviteCodec.decode(token) ?: return null
            return parseJson(json)
        }

        /** The decoded payload, checked as the web app's `parseInvitationPayload` checks it. */
        fun parseJson(json: String): ChessInvitation? {
            val fields = runCatching { Json.parseToJsonElement(json) as? JsonObject }.getOrNull()
            val namespaceId = fields?.text("namespaceId")
            val contextId = fields?.text("contextId")
            val signed = fields?.get("invitation") as? JsonObject
            val signature = signed?.let { (it["inviter_signature"] as? JsonPrimitive)?.contentOrNull }
            if (namespaceId == null || contextId == null || signed == null || signature == null) return null
            return ChessInvitation(SignedGroupOpenInvitation(signed), namespaceId, contextId)
        }

        private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotEmpty() }

        /** The link's `/<slug>/` path segment names this app (a segment, so a longer slug cannot match). */
        private fun slugMatches(link: String): Boolean =
            link
                .substringBefore('?')
                .split('/')
                .map { it.lowercase() }
                .contains(ChessConstants.PACKAGE_NAME)
    }
}
