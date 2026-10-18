package network.calimero.chat.data

import com.calimero.mero.admin.SignedGroupOpenInvitation
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/** A workspace invitation, read from a link or a pasted code. */
data class ChatInvitation(
    /** The namespace (workspace) it admits to, 64 hex. */
    val namespaceId: String,
    /** The signed envelope, verbatim — re-encoding it any other way breaks its signature. */
    val invitation: SignedGroupOpenInvitation,
    /** The workspace's name, when the inviter put it in the payload. */
    val workspaceName: String?,
)

/**
 * Invitation links in the web app's format (app/src/utils/invitation.ts), so a link minted on
 * either side opens on the other:
 *
 * - payload: `{"invitation": <SignedGroupOpenInvitation>, "groupAlias": "<workspace name>"}`
 *   (a bare envelope, a `{data: …}` wrapper and a `groupName` key are accepted too, as on the web;
 *   so is the SDK sample's `{namespaceId, spaceName, invitation}`),
 * - token: `base58(deflate(payload))` ([InviteCodec], byte-compatible with the web's fflate + bs58),
 * - link: `https://links.calimero.network/com.calimero.chat/join?invitation=<token>` ([InviteLink]).
 */
object ChatInvites {
    /** The package the web app's links name (`APP_SLUG`), which the desktop launcher resolves. */
    const val APP_SLUG = "com.calimero.chat"

    /** The JSON payload the web app's `serializeGroupInvitationPayload` writes. */
    fun payload(
        invitation: SignedGroupOpenInvitation,
        workspaceName: String?,
    ): String =
        buildJsonObject {
            put("invitation", invitation.raw)
            workspaceName?.takeIf { it.isNotEmpty() }?.let { put("groupAlias", it) }
        }.toString()

    /** The shareable link for [invitation]. */
    fun link(
        invitation: SignedGroupOpenInvitation,
        workspaceName: String?,
    ): String = InviteLink.invitation(InviteCodec.encode(payload(invitation, workspaceName)), APP_SLUG)

    /** Read a link (https or calimero://), a bare token or raw JSON; null when it is none of them. */
    fun parse(input: String): ChatInvitation? {
        val root =
            InviteLink
                .tokenFromPasted(input)
                ?.let { InviteCodec.decode(it) }
                ?.let { json -> runCatching { chatJson.parseToJsonElement(json).jsonObject }.getOrNull() }
                ?: return null
        val inner = root["data"] as? JsonObject ?: root
        val wrapped = inner["invitation"] as? JsonObject
        return when {
            isEnvelope(inner) -> invitationOf(inner, envelope = inner, name = null)
            wrapped != null && isEnvelope(wrapped) ->
                invitationOf(inner, envelope = wrapped, name = NAME_KEYS.firstNotNullOfOrNull { key -> inner.string(key)?.ifEmpty { null } })
            else -> null
        }
    }

    private fun invitationOf(
        payload: JsonObject,
        envelope: JsonObject,
        name: String?,
    ): ChatInvitation? {
        val signed = SignedGroupOpenInvitation(envelope)
        val namespaceId = payload.string("namespaceId")?.lowercase() ?: groupIdOf(signed) ?: return null
        return ChatInvitation(namespaceId, signed, name)
    }

    /** `SignedGroupOpenInvitation`'s shape: a signed body plus the inviter's signature. */
    private fun isEnvelope(obj: JsonObject): Boolean =
        obj["invitation"] is JsonObject && (obj.string("inviter_signature") != null || obj.string("inviterSignature") != null)

    /** The invited group, which for a workspace invitation is the namespace: bytes → hex, or a string as is. */
    private fun groupIdOf(signed: SignedGroupOpenInvitation): String? {
        val raw = signed.invitation.raw["group_id"] ?: signed.invitation.raw["groupId"]
        return when (raw) {
            is JsonArray -> {
                val bytes = raw.mapNotNull { (it as? JsonPrimitive)?.intOrNull }
                if (bytes.size == raw.size && bytes.isNotEmpty()) bytes.joinToString("") { "%02x".format(it and BYTE_MASK) } else null
            }
            is JsonPrimitive -> raw.contentOrNull?.ifEmpty { null }?.lowercase()
            else -> null
        }
    }

    private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

    private const val BYTE_MASK = 0xff

    /** Where a payload names its workspace: mero-js ≥2.1, older web builds, the SDK sample. */
    private val NAME_KEYS = listOf("groupName", "groupAlias", "spaceName")
}

/** Accounts as the contract writes them. */
object ChatIdentity {
    /**
     * The contract's `UserId` for an account: the same 32 bytes, base58 (`sender`, reaction and
     * profile identities). The session names the account in hex. Null when [accountHex] is not
     * 32 bytes of hex.
     */
    fun userIdOf(accountHex: String?): String? {
        val hex = accountHex?.trim()?.lowercase() ?: return null
        if (hex.length != HEX_LEN || hex.any { it !in "0123456789abcdef" }) return null
        val bytes = ByteArray(hex.length / 2) { i -> hex.substring(i * 2, i * 2 + 2).toInt(HEX_RADIX).toByte() }
        return InviteCodec.base58Encode(bytes)
    }

    /** A short form of a base58 id, for someone with no profile yet. */
    fun short(userId: String): String = if (userId.length <= SHORT_LEN) userId else userId.take(SHORT_LEN) + "…"

    private const val HEX_LEN = 64
    private const val HEX_RADIX = 16
    private const val SHORT_LEN = 8
}
