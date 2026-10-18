package network.calimero.chat.data

import com.calimero.mero.account.ApplicationIds
import com.calimero.mero.account.ResolvedApplication
import com.calimero.mero.admin.AdminSurface
import com.calimero.mero.admin.CreateContextRequest
import com.calimero.mero.admin.CreateGroupInNamespaceRequest
import com.calimero.mero.admin.GroupContextEntry
import com.calimero.mero.admin.Namespace
import com.calimero.mero.admin.SetSubgroupVisibilityRequest
import com.calimero.mero.admin.SignedGroupOpenInvitation
import com.calimero.mero.admin.SubgroupEntry
import com.calimero.mero.compose.MeroClient
import com.calimero.mero.relay.ApplicationTarget
import com.calimero.mero.relay.RelayClient
import com.calimero.mero.sse.ContextEvent
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * [ChatBackend] over the Kotlin SDK's [MeroClient] in its delegated (Calimero Cloud) mode. The
 * phone holds no node and never talks `/jsonrpc`:
 *
 * - **reads** go to the relay's account-scoped `POST /admin-api/contexts/{ctx}/query`
 *   ([RelayClient.query]) once the relay session (Bearer) is minted; before that,
 *   [RelayClient.call], which the SDK falls back to a warrant for;
 * - **writes** are warrants signed by this device's certified key, spent through
 *   `POST /admin-api/contexts/{ctx}/intents` ([RelayClient.execute]);
 * - **channels** are created with the account admin ([MeroClient.admin]): a subgroup through a
 *   root governance op, then chat's context through the relay's `context-intents`;
 * - **workspaces** are founded through the relay ([MeroClient.foundNamespace]) and joined by
 *   direct admission at the relay an invitation names ([MeroClient.joinWithInvitation]);
 * - **live updates** are the relay's event stream over the Bearer session.
 */
@Suppress("TooManyFunctions")
class MeroChatBackend(
    private val client: MeroClient,
    private val packageName: String = ChatInvites.APP_SLUG,
    private val registryUrl: String = ApplicationIds.DEFAULT_REGISTRY_URL,
    private val resolveApplication: suspend (packageName: String, registryUrl: String) -> ResolvedApplication = { pkg, registry ->
        ApplicationIds.resolveFromRegistry(pkg, registry)
    },
) : ChatBackend {
    private val appLock = Mutex()

    @Volatile private var resolved: ResolvedApplication? = null

    override val accountId: String? get() = client.state.value.account

    // ---- contract calls ------------------------------------------------------------------

    override suspend fun view(
        contextId: String,
        method: String,
        args: JsonObject,
    ): JsonElement? {
        val relay = relay()
        return if (client.state.value.sessionReady) relay.query(contextId, method, args) else relay.call(contextId, method, args)
    }

    override suspend fun write(
        contextId: String,
        method: String,
        args: JsonObject,
    ): JsonElement? = relay().execute(contextId, method, args).returns

    // ---- workspaces and channels -----------------------------------------------------------

    override suspend fun listWorkspaces(): List<Namespace> {
        val all = admin().listNamespaces()
        // ONLY chat's namespaces, as on the web: an account is used across apps.
        val appId = client.state.value.applicationId ?: optionalApplicationId()
        return if (appId == null) all else all.filter { it.targetApplicationId.equals(appId, ignoreCase = true) }
    }

    override suspend fun listSubgroups(namespaceId: String): List<SubgroupEntry> = admin().listSubgroups(namespaceId)

    override suspend fun listGroupContexts(groupId: String): List<GroupContextEntry> = admin().listGroupContexts(groupId)

    override suspend fun isMember(contextId: String): Boolean = admin().getContextIdentitiesOwned(contextId).identities.isNotEmpty()

    override suspend fun joinChannel(contextId: String) {
        admin().joinContext(contextId)
    }

    override suspend fun createSubgroup(
        namespaceId: String,
        name: String,
        public: Boolean,
    ): String {
        val admin = admin()
        val visibility =
            if (public) CreateGroupInNamespaceRequest.VISIBILITY_OPEN else CreateGroupInNamespaceRequest.VISIBILITY_RESTRICTED
        // Born with its visibility (a channel created restricted and flipped open strands every
        // member outside it), then set explicitly as well — the web app's createChannel does both.
        val groupId = admin.createGroupInNamespace(namespaceId, CreateGroupInNamespaceRequest(groupName = name, visibility = visibility)).groupId
        try {
            admin.setSubgroupVisibility(groupId, SetSubgroupVisibilityRequest(subgroupVisibility = visibility))
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // Non-fatal, as on the web: the subgroup already carries the visibility it was born with.
        }
        return groupId
    }

    override suspend fun createContext(
        groupId: String,
        name: String,
        initArgs: JsonObject,
    ): String =
        admin()
            .createContext(
                CreateContextRequest(
                    applicationId = applicationId(),
                    groupId = groupId,
                    initializationParams = initBytes(initArgs),
                    name = name,
                ),
            ).contextId

    override suspend fun foundWorkspace(name: String): FoundWorkspace {
        relay()
        val app = application()
        val founded = client.foundNamespace(application = ApplicationTarget(app.applicationId, app.packageName, app.version), name = name)
        val warnings =
            listOfNotNull(
                founded.haError?.let { "Invitees may not find it yet: $it" },
                founded.nameError?.let { "Its name could not be set: $it" },
            )
        return FoundWorkspace(founded.namespaceId, warnings.joinToString(" ").ifEmpty { null })
    }

    override suspend fun createInvitation(namespaceId: String): SignedGroupOpenInvitation = client.createNamespaceInvitation(namespaceId)

    override suspend fun joinWorkspace(
        namespaceId: String,
        invitation: SignedGroupOpenInvitation,
    ): JoinedWorkspace {
        if (!client.state.value.isAuthenticated) throw ChatNotReadyException("Sign in with your Calimero account first.")
        val joined = client.joinWithInvitation(namespaceId, invitation)
        return JoinedWorkspace(joined.namespaceId, joined.published)
    }

    // ---- live updates --------------------------------------------------------------------

    override fun changes(contextId: String): Flow<Unit>? {
        if (!client.state.value.sessionReady) return null
        val mero = client.mero ?: return null
        return mero
            .events(listOf(contextId))
            .filter { it.contextId == contextId && it.kind != ContextEvent.KIND_EPHEMERAL }
            .map { }
    }

    // ---- helpers ---------------------------------------------------------------------------

    private fun relay(): RelayClient {
        client.relay?.let { return it }
        val state = client.state.value
        val why =
            when {
                !state.isAuthenticated -> "Sign in with your Calimero account first."
                state.relayUrl == null ->
                    state.relayNote ?: "No relay serves your account yet. Join a workspace from an invitation link first."
                else -> "Connecting to your relay…"
            }
        throw ChatNotReadyException(why)
    }

    private fun admin(): AdminSurface = client.admin ?: throw ChatNotReadyException("Sign in with your Calimero account first.")

    private suspend fun applicationId(): String = client.state.value.applicationId ?: application().applicationId

    private suspend fun optionalApplicationId(): String? =
        try {
            application().applicationId
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            null
        }

    private suspend fun application(): ResolvedApplication =
        resolved ?: appLock.withLock { resolved ?: resolveApplication(packageName, registryUrl).also { resolved = it } }
}
