package network.calimero.chat.data

import com.calimero.mero.app.AppContextEntry
import com.calimero.mero.app.AppNamespace
import com.calimero.mero.app.AppSubgroup
import com.calimero.mero.app.MeroAppBackend
import com.calimero.mero.app.OrgInvitation
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonObject
import network.calimero.chat.generated.client.ChatClient

/**
 * [ChatBackend] over kotlin-sdk's app layer ([MeroAppBackend]: in the app `CalimeroAppBackend` over a
 * `CalimeroClient`, in tests mero-testkit's `InMemoryAppBackend`). (Swift `CloudChatBackend`.)
 *
 * - contract calls: the generated [ChatClient] over the backend's contract, bound to the app
 *   instance (views and calls on `/apps/{app}`, sealed);
 * - workspaces: `listNamespaces` / `foundNamespace` (orgs whose metadata names chat);
 * - channels: the org's own app instances (open channels and DMs, as the web makes them) and its
 *   teams' (private channels);
 * - invitations: org invite tokens; live updates: `events(contextId)`.
 */
@Suppress("TooManyFunctions")
class MeroChatBackend(
    private val app: MeroAppBackend,
) : ChatBackend {
    override val accountId: String? get() = app.account

    override fun chat(contextId: String): ChatClient = ChatClient(app, contextId)

    override suspend fun listWorkspaces(): List<AppNamespace> = app.listNamespaces()

    override suspend fun listSubgroups(namespaceId: String): List<AppSubgroup> = app.listSubgroups(namespaceId)

    override suspend fun listGroupContexts(groupId: String): List<AppContextEntry> = app.listContextEntries(groupId)

    override suspend fun isMember(contextId: String): Boolean = app.isMember(contextId)

    override suspend fun joinChannel(contextId: String) = app.joinContext(contextId)

    override suspend fun createSubgroup(
        namespaceId: String,
        name: String,
        public: Boolean,
    ): String = app.createSubgroup(namespaceId, name, public)

    override suspend fun createContext(
        groupId: String,
        name: String,
        initArgs: JsonObject,
    ): String = app.createContext(groupId, ChatInvites.APP_SLUG, name, initArgs)

    override suspend fun foundWorkspace(name: String): FoundWorkspace {
        val founded = app.foundNamespace(name)
        return FoundWorkspace(founded.namespaceId, founded.nameError?.let { "Its name could not be set: $it" })
    }

    override suspend fun createInvitation(namespaceId: String): OrgInvitation = app.createInvitation(namespaceId)

    override suspend fun joinWorkspace(
        namespaceId: String,
        invitation: OrgInvitation,
    ): JoinedWorkspace {
        val joined = app.joinNamespace(namespaceId, invitation)
        return JoinedWorkspace(joined.namespaceId.ifEmpty { namespaceId }, joined.published)
    }

    override fun changes(contextId: String): Flow<Unit>? = if (app.canSubscribe) app.events(contextId).map { } else null
}
