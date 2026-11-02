package network.calimero.sheets.core

import com.calimero.mero.app.OrgInvitation
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject

/**
 * A workspace invitation: Calimero 1.0's org invite token in the SDK's link shape
 * ([OrgInvitation]), plus the spreadsheet that was open:
 *
 * - payload: `{"invitation": "inv_…", "namespaceId": "<org>", "name": "<workspace>",
 *   "contextId": "<spreadsheet>", "projectName": "<name>", "roomName": "<name>"}` (the last three
 *   only when the invite names the spreadsheet that was open)
 * - token: `base58(deflate(payload))` ([InviteCodec])
 * - link: `https://links.calimero.network/com.calimero.mero-sheets/join?invitation=<token>`
 *
 * Reading takes an optional `data` envelope, and `groupName` / `groupAlias` for the name. The
 * token is a bearer secret the org's node minted; redeeming it (`POST /invites/{token}/redeem`)
 * joins the org it belongs to. The spreadsheet is only a hint for what to open after joining. A
 * link naming another app is refused, and so is a pre-1.0 signed invitation (a 1.0 cluster cannot
 * redeem it). (Swift `SheetsInvitation`.)
 */
data class SheetsInvitation(
    val invitation: OrgInvitation,
    val workspaceName: String?,
    /** The spreadsheet open when the invite was made: opened after joining. */
    val contextId: String? = null,
    val spreadsheetName: String? = null,
) {
    /** The org (workspace) the invitation admits to. */
    val namespaceId: String get() = invitation.namespaceId

    /** The shareable token: the SDK's [OrgInvitation] JSON with the spreadsheet's name beside it. */
    fun token(): String {
        val base = OrgInvitation(invitation.namespaceId, invitation.token, nonEmpty(contextId), nonEmpty(workspaceName))
        val payload = base.toJson().toMutableMap()
        nonEmpty(spreadsheetName)?.let {
            payload["projectName"] = JsonPrimitive(it)
            payload["roomName"] = JsonPrimitive(it)
        }
        return InviteCodec.encode(JsonObject(payload).toString())
    }

    /** The shareable link. */
    fun link(): String = InviteLink.invitation(token(), MeroSheets.PACKAGE_NAME)

    companion object {
        /** Read a link (https or `calimero://`) or a bare token; null when it holds no sheets invitation. */
        fun parse(input: String): SheetsInvitation? {
            val token = InviteLink.tokenFromPasted(input, MeroSheets.PACKAGE_NAME) ?: return null
            val decoded = InviteCodec.decode(token) ?: return null
            return parseJson(decoded)
        }

        /** Read the decoded payload JSON. */
        fun parseJson(text: String): SheetsInvitation? {
            val root = runCatching { Json.parseToJsonElement(text).jsonObject }.getOrNull() ?: return null
            val inner = root["data"] as? JsonObject ?: root
            val base = OrgInvitation.decodeJson(inner.toString()) ?: return null
            val name = listOf(base.name, inner.string("groupName"), inner.string("groupAlias")).firstNotNullOfOrNull(::nonEmpty)
            val project = listOf(inner.string("projectName"), inner.string("roomName")).firstNotNullOfOrNull(::nonEmpty)
            return SheetsInvitation(base, name, nonEmpty(base.contextId), project)
        }

        private fun nonEmpty(value: String?): String? = value?.trim()?.ifEmpty { null }

        private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
    }
}
