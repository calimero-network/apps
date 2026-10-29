package network.calimero.pass.core

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

/**
 * An invitation in the web app's format (`app/src/lib/inviteCodec.ts`), so a link minted on
 * either side opens on the other. (Swift `PassInvitation`.)
 *
 * - payload: `{"invitation": <SignedGroupOpenInvitation>, "kind": "namespace" | "vault",
 *   "groupId": "<team>", "groupAlias": "<team name>", "vaultId", "vaultName", "contextId"}`
 * - token: `base58(deflate(payload))` ([InviteCodec])
 * - link: `https://links.calimero.network/com.calimero.mero-pass/join?invitation=<token>`
 *
 * The signed invitation always grants the TEAM (namespace); a vault invite only says which vault
 * to open afterwards. Nothing secret travels in it.
 */
data class PassInvitation(
    val invitation: SignedGroupOpenInvitation,
    val kind: Kind = Kind.TEAM,
    val teamName: String? = null,
    val vaultId: String? = null,
    val vaultName: String? = null,
    val contextId: String? = null,
    /** The web's invite-only vault form: a second, vault invitation a phone cannot redeem yet. */
    val isInviteOnlyVault: Boolean = false,
) {
    enum class Kind(
        val wire: String,
    ) {
        TEAM("namespace"),
        VAULT("vault"),
    }

    /** The team it admits to: the hex of its SIGNED `group_id`, never a field beside it. */
    val namespaceId: String
        get() {
            val raw = invitation.invitation.raw["group_id"] ?: invitation.invitation.raw["groupId"]
            return when (raw) {
                is JsonArray -> raw.mapNotNull { (it as? JsonPrimitive)?.intOrNull }.joinToString("") { "%02x".format(it and BYTE_MASK) }
                is JsonPrimitive -> raw.contentOrNull.orEmpty().lowercase()
                else -> ""
            }
        }

    /** What to call it in a prompt: the vault for a vault invite, else the team. */
    val title: String
        get() =
            when {
                kind == Kind.VAULT && !vaultName.isNullOrEmpty() -> vaultName
                !teamName.isNullOrEmpty() -> teamName
                else -> "a team"
            }

    fun token(): String =
        InviteCodec.encode(
            buildJsonObject {
                put("invitation", invitation.raw)
                put("kind", kind.wire)
                put("groupId", namespaceId)
                teamName?.nullIfBlank()?.let { put("groupAlias", it) }
                vaultId?.let { put("vaultId", it) }
                vaultName?.nullIfBlank()?.let { put("vaultName", it) }
                contextId?.let { put("contextId", it) }
            }.toString(),
        )

    fun link(): String = InviteLink.invitation(token(), PassConstants.PACKAGE_NAME)

    companion object {
        private const val BYTE_MASK = 0xff
        private val json = Json { ignoreUnknownKeys = true }
        private val bareToken = Regex("^[A-Za-z0-9]+$")

        /** A link (https or `calimero://`), a bare token, or raw JSON. Null when it holds no invitation, and for another app's link. */
        fun parse(input: String): PassInvitation? {
            val trimmed = input.trim()
            if (trimmed.isEmpty()) return null
            if (trimmed.startsWith("{")) return parseJson(trimmed)
            val token = if (bareToken.matches(trimmed)) trimmed else tokenFromLink(trimmed) ?: return null
            return InviteCodec.decode(token)?.let(::parseJson)
        }

        /**
         * The Kotlin SDK's `InviteLink.tokenFromPasted` has no expected-app check (the Swift one
         * does), so another app's link is refused here: its path must name this app's slug.
         */
        private fun tokenFromLink(raw: String): String? {
            val lower = raw.lowercase()
            val isLink = lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("calimero://")
            if (!isLink) return null
            val segments = raw.substringBefore('?').split('/').map { it.lowercase() }
            if (PassConstants.PACKAGE_NAME !in segments) return null
            return InviteLink.tokenFromPasted(raw)
        }

        /** The web's `parsePayload`, including its older `room*` names. */
        fun parseJson(text: String): PassInvitation? {
            val root = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull() ?: return null
            val inner = root["data"] as? JsonObject ?: root
            val wrapped = inner["invitation"] as? JsonObject
            return when {
                wrapped != null && isEnvelope(wrapped) -> {
                    val rawKind = inner.string("kind")
                    PassInvitation(
                        invitation = signed(wrapped),
                        kind = if (rawKind == "vault" || rawKind == "room") Kind.VAULT else Kind.TEAM,
                        teamName = (inner.string("groupName") ?: inner.string("groupAlias"))?.nullIfBlank(),
                        vaultId = (inner.string("vaultId") ?: inner.string("roomId"))?.nullIfBlank(),
                        vaultName = (inner.string("vaultName") ?: inner.string("roomName"))?.nullIfBlank(),
                        contextId = inner.string("contextId")?.nullIfBlank(),
                        isInviteOnlyVault = ((inner["chain"] as? JsonArray)?.size ?: 0) > 1,
                    )
                }
                isEnvelope(inner) -> PassInvitation(signed(inner))
                else -> null
            }
        }

        private fun isEnvelope(obj: JsonObject): Boolean =
            obj["invitation"] is JsonObject && (obj.string("inviter_signature") != null || obj.string("inviterSignature") != null)

        /** The envelope verbatim, with a camelCase signature key renamed to core's spelling. */
        private fun signed(obj: JsonObject): SignedGroupOpenInvitation {
            val camel = obj["inviterSignature"]
            if (obj["inviter_signature"] != null || camel == null) return SignedGroupOpenInvitation(obj)
            return SignedGroupOpenInvitation(JsonObject(obj.filterKeys { it != "inviterSignature" } + ("inviter_signature" to camel)))
        }

        private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
    }
}
