package network.calimero.chat.data

import com.calimero.mero.app.AppContextEntry
import com.calimero.mero.app.AppNamespace
import com.calimero.mero.app.AppSubgroup
import com.calimero.mero.app.OrgInvitation
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * Everything the chat layer needs from a signed-in account on a Calimero 1.0 cluster. In 1.0 words
 * a workspace is an **org**, a channel is an **app instance** of chat (in the org itself, or in a
 * team of it for a private channel). [MeroChatBackend] is the real one, over kotlin-sdk's
 * `MeroAppBackend`. (Swift `ChatBackend`.)
 */
@Suppress("TooManyFunctions")
interface ChatBackend {
    /** The signed-in account, or null when signed out. */
    val accountId: String?

    // ---- contract calls ------------------------------------------------------------------

    /** Run a view as the account (`POST /apps/{app}` view, over the sealed channel). */
    suspend fun view(
        contextId: String,
        method: String,
        args: JsonObject,
    ): JsonElement?

    /** Run a call as the account (through the instance's log). */
    suspend fun write(
        contextId: String,
        method: String,
        args: JsonObject,
    ): JsonElement?

    // ---- workspaces (orgs) and channels (app instances) ----------------------------------

    /** The orgs this account is in that run chat. */
    suspend fun listWorkspaces(): List<AppNamespace>

    /** The org's teams and the app instances in each (private channels). */
    suspend fun listSubgroups(namespaceId: String): List<AppSubgroup>

    /** The app instances in [groupId]: the org's own (open channels, DMs), or a team's. */
    suspend fun listGroupContexts(groupId: String): List<AppContextEntry>

    /** Whether the account reaches the app instance (its calls work). */
    suspend fun isMember(contextId: String): Boolean

    /** Join an open channel: org members reach it already, so this checks it is reachable. */
    suspend fun joinChannel(contextId: String)

    /** Create a private channel's team in [namespaceId] (admits by invitation); returns its group id. */
    suspend fun createSubgroup(
        namespaceId: String,
        name: String,
        public: Boolean,
    ): String

    /** Create chat's app instance in [groupId] (the org, or a team); returns its id. */
    suspend fun createContext(
        groupId: String,
        name: String,
        initArgs: JsonObject,
    ): String

    /** Found an org running chat, named [name]. */
    suspend fun foundWorkspace(name: String): FoundWorkspace

    /** Mint an invite token to [namespaceId] (`POST /orgs/{org}/invites`, a passkey step-up). */
    suspend fun createInvitation(namespaceId: String): OrgInvitation

    /** Redeem [invitation] (`POST /invites/{token}/redeem`): the account joins the org at once. */
    suspend fun joinWorkspace(
        namespaceId: String,
        invitation: OrgInvitation,
    ): JoinedWorkspace

    // ---- live updates --------------------------------------------------------------------

    /** A signal per state change in [contextId] (`GET /apps/{app}/events`), or null to poll. */
    fun changes(contextId: String): Flow<Unit>?
}

/** What founding a workspace came to. */
data class FoundWorkspace(
    val namespaceId: String,
    /** Something worth telling the person (its name not set, `#general` not made), or null. */
    val warning: String?,
)

/** What redeeming an invitation came to. */
data class JoinedWorkspace(
    /** The org joined, as the node answered. */
    val namespaceId: String,
    /** Always true on 1.0: the account is a member at once. */
    val published: Boolean,
)

/** The app is not signed in yet. */
class ChatNotReadyException(
    message: String,
) : Exception(message)
