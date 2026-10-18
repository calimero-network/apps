package network.calimero.chat.data

import com.calimero.mero.admin.GroupContextEntry
import com.calimero.mero.admin.Namespace
import com.calimero.mero.admin.SignedGroupOpenInvitation
import com.calimero.mero.admin.SubgroupEntry
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * Everything the chat layer needs from a delegated Calimero session. The phone holds no node: the
 * account's relay reads, writes, creates and admits on its behalf. [MeroChatBackend] is the real
 * one, over the Kotlin SDK's `MeroClient`.
 */
@Suppress("TooManyFunctions")
interface ChatBackend {
    /** The signed-in account, 64 hex, or null when signed out. */
    val accountId: String?

    // ---- contract calls ------------------------------------------------------------------

    /** Run a view method as the account (the relay's account-scoped query route). */
    suspend fun view(
        contextId: String,
        method: String,
        args: JsonObject,
    ): JsonElement?

    /** Run a mutating method under a warrant this device signs (the relay's intents route). */
    suspend fun write(
        contextId: String,
        method: String,
        args: JsonObject,
    ): JsonElement?

    // ---- workspaces (namespaces) and channels (contexts) ---------------------------------

    /** The namespaces this account is in, for chat's application only. */
    suspend fun listWorkspaces(): List<Namespace>

    /** The subgroups under [namespaceId] — one per channel or DM in the web app's model. */
    suspend fun listSubgroups(namespaceId: String): List<SubgroupEntry>

    /** The contexts in [groupId]. */
    suspend fun listGroupContexts(groupId: String): List<GroupContextEntry>

    /** Whether the account is a direct member of [contextId]'s group, i.e. can read and write there. */
    suspend fun isMember(contextId: String): Boolean

    /** Become a direct member of an open channel (`MemberJoinedOpen` on its group). */
    suspend fun joinChannel(contextId: String)

    /** Create a channel's subgroup under [namespaceId]; returns the subgroup id. */
    suspend fun createSubgroup(
        namespaceId: String,
        name: String,
        public: Boolean,
    ): String

    /** Create chat's context in [groupId] (a creation warrant through the relay); returns its id. */
    suspend fun createContext(
        groupId: String,
        name: String,
        initArgs: JsonObject,
    ): String

    /** Found a namespace running chat, named [name], through the account's relay. */
    suspend fun foundWorkspace(name: String): FoundWorkspace

    /** Mint an invitation to [namespaceId], signed by this device. */
    suspend fun createInvitation(namespaceId: String): SignedGroupOpenInvitation

    /** Redeem [invitation] as the account (direct admission through a relay it names). */
    suspend fun joinWorkspace(
        namespaceId: String,
        invitation: SignedGroupOpenInvitation,
    ): JoinedWorkspace

    // ---- live updates --------------------------------------------------------------------

    /**
     * A signal per state change in [contextId] (the relay's event stream), or null when the
     * session has no live stream — the caller then polls.
     */
    fun changes(contextId: String): Flow<Unit>?
}

/** What founding a workspace came to. */
data class FoundWorkspace(
    val namespaceId: String,
    /** Something worth telling the person (hosting refused, name not set), or null. */
    val warning: String?,
)

/** What redeeming an invitation came to. */
data class JoinedWorkspace(
    val namespaceId: String,
    /** False when the relay accepted the join but has not published it yet. */
    val published: Boolean,
)

/** The app is not signed in, or has nothing to talk through yet (no relay). */
class ChatNotReadyException(
    message: String,
) : Exception(message)
