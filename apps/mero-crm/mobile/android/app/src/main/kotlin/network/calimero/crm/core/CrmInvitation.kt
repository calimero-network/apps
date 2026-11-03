package network.calimero.crm.core

import com.calimero.mero.app.OrgInvitation
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * A workspace invitation: Calimero 1.0's org invite token in the SDK's link shape
 * ([OrgInvitation]), the workspace's name as its `name`:
 *
 * - payload: `{"invitation": "inv_…", "namespaceId": "<org>", "name": "<workspace>"}`
 * - token: `base58(deflate(payload))` ([InviteCodec])
 * - link: `https://links.calimero.network/com.calimero.mero-crm/join?invitation=<token>`
 *
 * The invite token is a bearer secret the org's node minted; redeeming it
 * (`POST /invites/{token}/redeem`) joins the org it belongs to. Decoding also takes an optional
 * `data` envelope and `groupAlias` / `groupName`. Another app's link is refused, and so is a pre-1.0
 * signed invitation (a 1.0 cluster cannot redeem it).
 */
class CrmInvitation(
    val invitation: OrgInvitation,
    val workspaceName: String?,
) {
    /** The org (workspace) it admits to. */
    val namespaceId: String get() = invitation.namespaceId

    /** The shareable token. */
    fun token(): String = invitation.copy(name = workspaceName?.trim()?.ifEmpty { null }).encoded()

    /** The shareable link. */
    fun link(): String = InviteLink.invitation(token(), PACKAGE_NAME)

    companion object {
        /** The registry package, which is also the links' slug (`APP_SLUG`). */
        const val PACKAGE_NAME = "com.calimero.mero-crm"

        /**
         * Read a pasted link (https or `calimero://`) or a bare token. Null when it is not a Mero CRM
         * invitation, including another app's link.
         */
        fun parse(input: String): CrmInvitation? {
            val token = InviteLink.tokenFromPasted(input.trim(), PACKAGE_NAME) ?: return null
            val json = InviteCodec.decode(token) ?: return null
            return parseJson(json)
        }

        /** Read the decoded payload JSON. */
        fun parseJson(json: String): CrmInvitation? {
            val root = runCatching { Json.parseToJsonElement(json) as? JsonObject }.getOrNull() ?: return null
            val inner = root["data"] as? JsonObject ?: root
            val base = OrgInvitation.decodeJson(inner.toString()) ?: return null
            val name =
                listOf(base.name, inner.string("groupAlias"), inner.string("groupName"))
                    .firstNotNullOfOrNull { it?.trim()?.ifEmpty { null } }
            return CrmInvitation(base, name)
        }

        private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
    }
}
