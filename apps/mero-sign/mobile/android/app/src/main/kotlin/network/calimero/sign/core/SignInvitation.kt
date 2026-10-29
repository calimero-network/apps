package network.calimero.sign.core

import com.calimero.mero.admin.SignedGroupOpenInvitation
import com.calimero.mero.app.AppNamespace
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put

/**
 * An invitation in the web app's format (`inviteCodec.ts`, `inviteLink.ts`), so a link minted on
 * either side opens on the other: `{"invitation", "contextId"?, "contextName"?, "workspaceName"?}`
 * as `base58(deflate(json))` in `https://links.calimero.network/com.calimero.mero-sign/join?invitation=…`.
 * The signed invitation grants the WORKSPACE; the fields beside it are hints. (Swift `SignInvitation`.)
 */
data class SignInvitation(
    val invitation: SignedGroupOpenInvitation,
    val contextId: String? = null,
    val contextName: String? = null,
    val workspaceName: String? = null,
) {
    /** The namespace it admits to: the hex of its SIGNED `group_id`. */
    val namespaceId: String
        get() =
            when (val raw = invitation.invitation.raw["group_id"] ?: invitation.invitation.raw["groupId"]) {
                is JsonArray -> raw.mapNotNull { (it as? JsonPrimitive)?.intOrNull }.joinToString("") { "%02x".format(it and 0xff) }
                is JsonPrimitive -> raw.contentOrNull.orEmpty().lowercase()
                else -> ""
            }

    val title: String get() = contextName?.trimmedOrNull() ?: workspaceName?.trimmedOrNull() ?: "an agreement"

    fun token(): String =
        InviteCodec.encode(
            buildJsonObject {
                put("invitation", invitation.raw)
                contextId?.let { put("contextId", it) }
                contextName?.trimmedOrNull()?.let { put("contextName", it) }
                workspaceName?.trimmedOrNull()?.let { put("workspaceName", it) }
            }.toString(),
        )

    fun link(): String = InviteLink.invitation(token(), SignConstants.PACKAGE_NAME)

    companion object {
        private val json = Json { ignoreUnknownKeys = true }

        /** A link (https or `calimero://`), a bare token, or raw JSON. Null for another app's link. */
        fun parse(input: String): SignInvitation? {
            val trimmed = input.trim()
            if (trimmed.isEmpty()) return null
            if (trimmed.startsWith("{")) return parseJson(trimmed)
            // Another app's link is refused (`expectedSlug`).
            val token = InviteLink.tokenFromPasted(trimmed, SignConstants.PACKAGE_NAME) ?: return null
            return InviteCodec.decode(token)?.let(::parseJson)
        }

        /** The decoded payload (the web's `parsePayload`). */
        fun parseJson(text: String): SignInvitation? {
            var inner: JsonElement = runCatching { json.parseToJsonElement(text) }.getOrNull() ?: return null
            repeat(6) {
                if (isEnvelope(inner)) return@repeat
                inner = (inner as? JsonObject)?.get("data") ?: return@repeat
            }
            val obj = inner as? JsonObject ?: return null
            val wrapped = unwrapSigned(obj["invitation"])
            if (wrapped != null) {
                return SignInvitation(
                    invitation = signed(wrapped),
                    contextId = (obj.string("contextId") ?: obj.string("context_id"))?.trimmedOrNull(),
                    contextName =
                        (obj.string("contextName") ?: obj.string("context_name") ?: obj.string("groupAlias") ?: obj.string("groupName"))
                            ?.trimmedOrNull(),
                    workspaceName = (obj.string("workspaceName") ?: obj.string("namespaceName"))?.trimmedOrNull(),
                )
            }
            return if (isEnvelope(obj)) SignInvitation(signed(obj)) else null
        }

        private fun unwrapSigned(value: JsonElement?): JsonObject? {
            var current = value
            repeat(6) {
                val obj = current as? JsonObject ?: return null
                if (isEnvelope(obj)) return obj
                current = obj["data"] ?: obj["invitation"]
            }
            return null
        }

        private fun isEnvelope(value: JsonElement): Boolean {
            val obj = value as? JsonObject ?: return false
            return obj["invitation"] is JsonObject && (obj.string("inviter_signature") != null || obj.string("inviterSignature") != null)
        }

        private fun signed(obj: JsonObject): SignedGroupOpenInvitation {
            val camel = obj["inviterSignature"]
            if (obj["inviter_signature"] != null || camel == null) return SignedGroupOpenInvitation(obj)
            return SignedGroupOpenInvitation(JsonObject(obj.filterKeys { it != "inviterSignature" } + ("inviter_signature" to camel)))
        }

        private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
    }
}

/** Where a redeemed invitation lands. */
data class InvitationDestination(
    val namespaceId: String,
    val workspaceName: String,
    val agreement: AgreementRef?,
)

/**
 * Redeeming an invitation link, as the web's `joinWorkspaceFromInvitation`: join the workspace,
 * find the agreement (the one the link names, else the only one), enter it, and settle in.
 * (Swift `InvitationModel`.)
 */
class InvitationModel(
    private val findAttempts: Int = 15,
    private val findDelayMs: Long = 2_000,
) {
    sealed interface Stage {
        data object Idle : Stage

        data class Confirm(
            val title: String,
        ) : Stage

        data class Joining(
            val title: String,
            val step: String,
        ) : Stage

        data class Joined(
            val destination: InvitationDestination,
        ) : Stage

        data class Failed(
            val message: String,
        ) : Stage
    }

    private val _stage = MutableStateFlow<Stage>(Stage.Idle)
    val stage: StateFlow<Stage> = _stage.asStateFlow()
    var invitation: SignInvitation? = null
        private set

    fun open(raw: String): Boolean {
        val parsed = SignInvitation.parse(raw)
        invitation = parsed
        _stage.value = if (parsed == null) Stage.Failed("This isn't a Mero Sign invitation. Check the link and try again.") else Stage.Confirm(parsed.title)
        return parsed != null
    }

    /** Join. [directory] is read again after [didJoin], which may give the session a new backend. */
    suspend fun accept(
        directory: () -> AgreementDirectory?,
        didJoin: suspend () -> Unit,
    ) {
        val invitation = invitation
        val current = directory()
        if (invitation == null || current == null) {
            _stage.value = Stage.Failed("Sign in to join.")
            return
        }
        val title = invitation.title
        _stage.value = Stage.Joining(title, "Joining the workspace…")
        val namespaceId = invitation.namespaceId
        val joinError = attempt { current.backend.joinNamespace(namespaceId, invitation.invitation) }.exceptionOrNull()
        if (joinError != null) {
            val text = SignErrorText.message(joinError).lowercase()
            if (!(text.contains("already a member") || text.contains("already member") || text.contains("already joined"))) {
                _stage.value = Stage.Failed(SignErrorText.describe(joinError))
                return
            }
        }
        didJoin()
        val joined = directory()
        if (joined == null) {
            _stage.value = Stage.Failed("Sign in to join.")
            return
        }
        _stage.value = Stage.Joining(title, "Looking for the agreement…")
        val workspaceName =
            invitation.workspaceName
                ?: attempt { joined.backend.listNamespaces().firstOrNull { it.id == namespaceId } }.getOrNull()?.let(AgreementDirectory::nameOf)
                ?: "Workspace"
        val target = findAgreement(joined, namespaceId, workspaceName)
        if (target == null) {
            _stage.value = Stage.Joined(InvitationDestination(namespaceId, workspaceName, null))
            return
        }
        val settled =
            attempt {
                _stage.value = Stage.Joining(title, "Opening the agreement…")
                joined.enter(target.contextId)
                _stage.value = Stage.Joining(title, "Registering you as a signer…")
                target.copy(name = joined.settle(target.contextId, invitation.contextName ?: target.name))
            }.getOrNull()
        _stage.value = Stage.Joined(InvitationDestination(namespaceId, workspaceName, settled))
    }

    private suspend fun findAgreement(
        directory: AgreementDirectory,
        namespaceId: String,
        workspaceName: String,
    ): AgreementRef? {
        val workspace = AppNamespace(namespaceId, workspaceName, "")
        val hint = invitation?.contextId
        var listed: List<AgreementRef> = emptyList()
        for (i in 0 until maxOf(findAttempts, 1)) {
            if (i > 0) delay(findDelayMs)
            listed = attempt { directory.agreements(workspace) }.getOrDefault(emptyList())
            if (hint != null) {
                listed.firstOrNull { it.contextId == hint }?.let { return it }
            } else if (listed.isNotEmpty()) {
                break
            }
        }
        return listed.singleOrNull()
    }

    fun reset() {
        invitation = null
        _stage.value = Stage.Idle
    }
}
