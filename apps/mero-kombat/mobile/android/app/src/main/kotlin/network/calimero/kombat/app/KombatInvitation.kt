package network.calimero.kombat.app

import com.calimero.mero.admin.SignedGroupOpenInvitation
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * An invitation to one arena, in the web app's form (`app/src/utils/invitation.ts`), so a link made
 * on the phone opens in the browser and the other way round:
 *
 * - payload: JSON `{"invitation": <SignedGroupOpenInvitation>, "namespaceId": "…", "contextId": "…"}`
 * - token: `base58(deflate(payload))` ([InviteCodec])
 * - link: `https://links.calimero.network/com.calimero.mero-kombat/join?invitation=<token>`
 *
 * The invitation admits to the NAMESPACE (one link lets someone into every arena in it); the
 * context id says which arena to open once in. (Swift `KombatInvitation`.)
 */
data class KombatInvitation(
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
        return InviteLink.invitation(InviteCodec.encode(payload.toString()), KombatConstants.PACKAGE_NAME)
    }

    companion object {
        /**
         * A pasted link, a deep link or a bare token; null when it is not a Mero Kombat invitation
         * (another app's link is refused: redeeming it would join that app's namespace).
         */
        fun parse(input: String): KombatInvitation? {
            val token = InviteLink.tokenFromPasted(input.trim(), KombatConstants.PACKAGE_NAME) ?: return null
            val json = InviteCodec.decode(token) ?: return null
            return parseJson(json)
        }

        /** The decoded payload, checked as the web app's `parseInvitationPayload` checks it. */
        fun parseJson(json: String): KombatInvitation? {
            val fields = runCatching { Json.parseToJsonElement(json) as? JsonObject }.getOrNull()
            val namespaceId = fields?.text("namespaceId")
            val contextId = fields?.text("contextId")
            val signed = fields?.get("invitation") as? JsonObject
            val signature = signed?.let { (it["inviter_signature"] as? JsonPrimitive)?.contentOrNull }
            if (namespaceId == null || contextId == null || signed == null || signature == null) return null
            return KombatInvitation(SignedGroupOpenInvitation(signed), namespaceId, contextId)
        }

        private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotEmpty() }
    }
}
