package network.calimero.sign.core

import com.calimero.mero.app.AppNamespace
import com.calimero.mero.app.OrgInvitation
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.net.URI
import java.net.URLDecoder

/**
 * An invitation link: the SDK's [OrgInvitation] (the payload every Calimero 1.0 app shares), plus
 * the workspace's name to show:
 *
 * - payload: `{"invitation": "inv_…", "namespaceId": "<workspace>", "contextId"?: "<agreement>", "name"?: "<agreement name>", "workspaceName"?: "…"}`
 * - token: `base58(deflate(payload))`
 * - link: `https://links.calimero.network/com.calimero.mero-sign/join?invitation=<token>`
 *
 * The web app's own links are read too: `https://<the web app>/?invite=inv_…&agreement=<app id>`
 * (`app/src/lib/invites.ts`), and a bare `inv_…` token. They name no workspace; redeeming the token
 * answers which one it was. The token admits to the WORKSPACE (a Calimero organization); the
 * agreement and names are hints. (Swift `SignInvitation`.)
 */
data class SignInvitation(
    val invitation: OrgInvitation,
    val workspaceName: String? = null,
) {
    /** The workspace it admits to; empty for a web link (the node answers it on redeem). */
    val namespaceId: String get() = invitation.namespaceId

    /** The agreement to open after joining, when the link names one. */
    val contextId: String? get() = invitation.contextId?.trimmedOrNull()

    /** The agreement's name, while it loads. */
    val contextName: String? get() = invitation.name?.trimmedOrNull()

    val title: String get() = contextName ?: workspaceName?.trimmedOrNull() ?: "an agreement"

    fun token(): String {
        val base = invitation.copy(contextId = contextId, name = contextName).toJson()
        val payload = workspaceName?.trimmedOrNull()?.let { JsonObject(base + ("workspaceName" to JsonPrimitive(it))) } ?: base
        return InviteCodec.encode(payload.toString())
    }

    fun link(): String = InviteLink.invitation(token(), SignConstants.PACKAGE_NAME)

    companion object {
        private val json = Json { ignoreUnknownKeys = true }

        /** A link (https or `calimero://`), the web app's `?invite=` link, a bare token, or raw JSON. Null for another app's link. */
        fun parse(input: String): SignInvitation? {
            val trimmed = input.trim()
            return when {
                trimmed.isEmpty() -> null
                trimmed.startsWith("{") -> parseJson(trimmed)
                trimmed.startsWith("inv_") && trimmed.none { it.isWhitespace() } -> SignInvitation(OrgInvitation("", trimmed))
                // Another app's link is refused (`expectedSlug`).
                else ->
                    webInvite(trimmed)
                        ?: InviteLink.tokenFromPasted(trimmed, SignConstants.PACKAGE_NAME)?.let(InviteCodec::decode)?.let(::parseJson)
            }
        }

        /** The web app's link: `?invite=<token>` and an optional `&agreement=<app id>`. */
        internal fun webInvite(link: String): SignInvitation? {
            val query = runCatching { URI(link).rawQuery }.getOrNull() ?: return null
            val params =
                query.split('&').associate {
                    URLDecoder.decode(it.substringBefore('='), "UTF-8") to URLDecoder.decode(it.substringAfter('=', ""), "UTF-8")
                }
            val token = params["invite"]?.trimmedOrNull() ?: return null
            return SignInvitation(OrgInvitation("", token, params["agreement"]?.trimmedOrNull()))
        }

        /** The decoded payload. Only an [OrgInvitation] (an `inv_…` token and its organization) is an invitation. */
        fun parseJson(text: String): SignInvitation? {
            val invitation = OrgInvitation.decodeJson(text) ?: return null
            val extra = runCatching { json.parseToJsonElement(text) as? JsonObject }.getOrNull()
            val workspaceName = (extra?.get("workspaceName") as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull?.trimmedOrNull()
            return SignInvitation(invitation, workspaceName)
        }
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
        var namespaceId = invitation.namespaceId
        // The node answers the organization the token opened: a web link names none.
        val joined0 = attempt { current.backend.joinNamespace(namespaceId, invitation.invitation) }
        joined0
            .getOrNull()
            ?.namespaceId
            ?.takeIf { it.isNotEmpty() }
            ?.let { namespaceId = it }
        val joinError = joined0.exceptionOrNull()
        if (joinError != null) {
            val text = SignErrorText.message(joinError).lowercase()
            if (!(text.contains("already a member") || text.contains("already member") || text.contains("already joined"))) {
                _stage.value = Stage.Failed(SignErrorText.describe(joinError))
                return
            }
        }
        if (namespaceId.isEmpty()) {
            invitation.contextId?.let { hint ->
                attempt {
                    current.admin
                        .instances()
                        .firstOrNull { it.appId == hint }
                        ?.org
                }.getOrNull()?.let { namespaceId = it }
            }
        }
        if (namespaceId.isEmpty()) {
            _stage.value = Stage.Failed("Joined, but the workspace isn't listed yet. Pull to refresh in Agreements.")
            return
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
