package network.calimero.chat.app

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.calimero.mero.CalimeroClient
import com.calimero.mero.CalimeroClientOptions
import com.calimero.mero.CalimeroConnectOptions
import com.calimero.mero.CloudPolicy
import com.calimero.mero.ConsentResult
import com.calimero.mero.PasskeyProvider
import com.calimero.mero.SoftPasskey
import com.calimero.mero.app.MeroAppBackend
import com.calimero.mero.app.OrgInvitation
import com.calimero.mero.compose.MeroAppSession
import com.calimero.mero.compose.PlatformPasskey
import com.calimero.mero.consentReturn
import com.calimero.mero.storage.EncryptedSessionStore
import com.calimero.mero.storage.MemorySessionStore
import com.calimero.mero.storage.SessionStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import network.calimero.chat.BuildConfig
import network.calimero.chat.data.Channel
import network.calimero.chat.data.ChatBackend
import network.calimero.chat.data.ChatInvites
import network.calimero.chat.data.ChatNotReadyException
import network.calimero.chat.data.ChatRepository
import network.calimero.chat.data.JoinedWorkspace
import network.calimero.chat.data.MeroChatBackend
import network.calimero.chat.data.Workspace
import network.calimero.chat.data.describeChatError
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.io.IOException
import java.lang.ref.WeakReference

/** How the app signs in. */
enum class SignInMode {
    /** A Calimero Cloud cluster: real TDX attestation, the device's passkey. */
    CLOUD,

    /** A `merod local` node: mock attestation trusted, a software passkey kept on the device. */
    DEV,
}

/**
 * Owns the app's [MeroAppSession] on the cluster the person chose (by name, through the node
 * directory, or by a node's URL), or on a development node, and the view models built on it, for
 * the activity's lifetime. The node the session lives on is kept beside it, so a relaunch restores
 * it without asking the directory again.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@Suppress("TooManyFunctions")
class ChatAppViewModel(
    app: Application,
) : AndroidViewModel(app) {
    private val store: SessionStore =
        runCatching<SessionStore> { EncryptedSessionStore(app, "calimero_session_${ChatInvites.APP_SLUG}") }.getOrElse { MemorySessionStore() }

    private val _mode = MutableStateFlow(store.value(KEY_MODE)?.let { runCatching { SignInMode.valueOf(it) }.getOrNull() } ?: SignInMode.CLOUD)
    val mode: StateFlow<SignInMode> = _mode.asStateFlow()

    /** What the Calimero Cloud field holds: a cluster name or a node address. */
    val cluster = MutableStateFlow(store.value(KEY_CLUSTER) ?: BuildConfig.CLUSTER)

    /** The development node's URL. */
    val devNode = MutableStateFlow(store.value(KEY_DEV_NODE) ?: DEFAULT_DEV_NODE)

    private val signingIn = MutableStateFlow(false)
    private val signInError = MutableStateFlow<String?>(null)
    private val restoring = MutableStateFlow(true)
    private val _session = MutableStateFlow<MeroAppSession?>(null)

    private val backendFlow: StateFlow<MeroAppBackend?> =
        _session.flatMapLatest { it?.backend ?: flowOf(null) }.stateIn(viewModelScope, SharingStarted.Eagerly, null)

    val session: StateFlow<SessionStage> =
        combine(backendFlow, signingIn, restoring, signInError) { backend, busy, restoring, error ->
            when {
                backend != null -> SessionStage.SignedIn(backend.account, store.value(KEY_NODE), _mode.value == SignInMode.DEV)
                busy || restoring -> SessionStage.Connecting
                else -> SessionStage.SignedOut(error)
            }
        }.stateIn(viewModelScope, SharingStarted.Eagerly, SessionStage.Connecting)

    val profile = ProfileStore(SharedPreferencesStore(app, PREFS))
    private val chat = SessionChatBackend { backendFlow.value?.let(::MeroChatBackend) }
    val repository = ChatRepository(chat)
    val workspaces = WorkspacesModel(repository, viewModelScope, profile)

    /** The Activity on screen: the passkey sheet and the consent page's Custom Tab need it. */
    private var activity: WeakReference<Context>? = null

    /** What waits for the person's approval. */
    val approvals =
        ApprovalsModel(
            packageName = ChatInvites.APP_SLUG,
            appName = "Mero Chat",
            fetch = { org -> (_session.value?.client ?: throw IOException("Not signed in")).pendingApprovals(org) },
            consent = { build, confirm ->
                val session = _session.value ?: throw IOException("Not signed in")
                val context = activity?.get() ?: throw IOException("The app is not on screen")
                val started = session.requestConsent(context, build(CONSENT_CALLBACK), confirm)
                session.consentResult.value?.takeIf { it.requestId == started.requestId }
                    ?: runCatching { session.client.fetchConsentResult(started.requestId) }.getOrNull()
            },
        )

    private val channelLists = mutableMapOf<String, ChannelsModel>()
    private val openChannels = mutableMapOf<String, ChannelModel>()

    init {
        viewModelScope.launch {
            try {
                val node = store.value(KEY_NODE)
                if (store.load() != null && !node.isNullOrEmpty()) open(_mode.value, client(_mode.value, node, nodes())).restore()
            } finally {
                restoring.value = false
            }
        }
    }

    /** The Activity on screen, or null once it is gone. Its passkey approves the account's step-ups (inviting). */
    fun attach(activity: Context?) {
        this.activity = activity?.let(::WeakReference)
        approve()
    }

    fun selectMode(next: SignInMode) {
        _mode.value = next
        signInError.value = null
    }

    /** Sign in (or, with [create], sign up as [name]) on the Calimero Cloud cluster [cluster] names. */
    fun signInCloud(
        activity: Context,
        create: Boolean,
        name: String = "",
    ) = attempt {
        val target = ClusterTarget.parse(cluster.value) ?: throw IllegalArgumentException("Enter the cluster's name or a node address.")
        store.setValue(KEY_CLUSTER, cluster.value.trim())
        val client =
            when (target) {
                is ClusterTarget.Url -> client(SignInMode.CLOUD, target.url, emptyList())
                is ClusterTarget.Name ->
                    CalimeroClient.connect(CalimeroConnectOptions(cluster = target.name, policy = CloudPolicy.production, httpClient = http))
            }
        val s = open(SignInMode.CLOUD, client)
        if (create) s.signUp(PlatformPasskey(activity), name) else s.signIn(PlatformPasskey(activity))
        if (create && name.isNotBlank() && profile.displayName.value.isBlank()) profile.setDisplayName(name)
    }

    /**
     * Sign in to a development node (`merod local`) with a software passkey kept on the device: the
     * first time it signs up as [name], after that it signs in with the same key.
     */
    fun signInDev(name: String) =
        attempt {
            val url = (ClusterTarget.parse(devNode.value) as? ClusterTarget.Url)?.url ?: throw IllegalArgumentException("Enter the node's URL.")
            store.setValue(KEY_DEV_NODE, url)
            val s = open(SignInMode.DEV, client(SignInMode.DEV, url, emptyList()))
            val saved = devPasskey(url)
            if (saved != null) {
                s.signIn(saved)
            } else {
                val passkey = SoftPasskey(rpId = url.toHttpUrlOrNull()?.host?.let(::devRpId) ?: "localhost", origin = DEV_ORIGIN)
                s.signUp(passkey, name.ifBlank { "Developer" })
                store.setValue(KEY_DEV_PASSKEY + url, passkey.export())
            }
            if (name.isNotBlank() && profile.displayName.value.isBlank()) profile.setDisplayName(name)
            approve()
        }

    /** Any link the activity received: the consent page coming back, or a workspace invitation. */
    fun handleLink(url: String) {
        if (consentReturn(url) != null) {
            viewModelScope.launch { _session.value?.handle(url) }
            return
        }
        workspaces.offerInvite(url)
    }

    fun signOut() =
        viewModelScope.launch {
            openChannels.values.forEach { it.stop() }
            openChannels.clear()
            channelLists.clear()
            workspaces.reset()
            _session.value?.signOut()
        }

    fun channels(workspace: Workspace): ChannelsModel = channelLists.getOrPut(workspace.id) { ChannelsModel(repository, viewModelScope, profile, workspace) }

    fun channelsOf(workspaceId: String): ChannelsModel? = channelLists[workspaceId]

    fun channel(channel: Channel): ChannelModel =
        openChannels.getOrPut(channel.contextId) {
            ChannelModel(repository, viewModelScope, channel, onRead = { id -> channelLists[channel.workspaceId]?.markSeen(id) })
        }

    fun channelOf(contextId: String): ChannelModel? = openChannels[contextId]

    override fun onCleared() {
        openChannels.values.forEach { it.stop() }
        super.onCleared()
    }

    private fun approve() {
        val url = devNode.value
        _session.value?.passkey = devPasskey(url) ?: activity?.get()?.let(::PlatformPasskey)
    }

    private fun nodes(): List<String> =
        store
            .value(KEY_NODES)
            ?.split(',')
            ?.filter { it.isNotBlank() }
            .orEmpty()

    private fun devPasskey(url: String): PasskeyProvider? =
        if (_mode.value == SignInMode.DEV) store.value(KEY_DEV_PASSKEY + url)?.let { runCatching { SoftPasskey.restore(it) }.getOrNull() } else null

    private fun client(
        mode: SignInMode,
        url: String,
        nodes: List<String>,
    ): CalimeroClient =
        CalimeroClient(
            CalimeroClientOptions(
                baseUrl = url,
                nodes = nodes,
                policy = if (mode == SignInMode.DEV) CloudPolicy.development else CloudPolicy.production,
                httpClient = http,
            ),
        )

    /** A [MeroAppSession] over [client], remembered (mode and nodes) for the next launch. */
    private fun open(
        newMode: SignInMode,
        client: CalimeroClient,
    ): MeroAppSession {
        _mode.value = newMode
        store.setValue(KEY_MODE, newMode.name)
        store.setValue(KEY_NODE, client.nodes.firstOrNull().orEmpty())
        store.setValue(KEY_NODES, client.nodes.drop(1).joinToString(","))
        val s = MeroAppSession(client, ChatInvites.APP_SLUG, CONSENT_CALLBACK, store, scope = viewModelScope)
        _session.value = s
        approve()
        return s
    }

    private fun attempt(block: suspend () -> Unit) {
        signInError.value = null
        signingIn.value = true
        viewModelScope.launch {
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: IllegalArgumentException) {
                signInError.value = e.message
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                signInError.value = describeChatError(e)
            } finally {
                signingIn.value = false
            }
        }
    }

    companion object {
        /** Where the consent page sends the person back; the manifest's intent filter matches it. */
        const val CONSENT_CALLBACK = "mero-chat://consent"

        /** The origin `merod local` allows (`--origins`); a software passkey's client data claims it. */
        const val DEV_ORIGIN = "http://localhost:3000"

        /** `merod local` from the emulator. */
        const val DEFAULT_DEV_NODE = "http://10.0.2.2:2501"

        private const val PREFS = "mero_chat"
        private const val KEY_MODE = "chat.mode"
        private const val KEY_CLUSTER = "chat.cluster"
        private const val KEY_DEV_NODE = "chat.devNode"
        private const val KEY_NODE = "chat.node"
        private const val KEY_NODES = "chat.nodes"
        private const val KEY_DEV_PASSKEY = "chat.devPasskey:"

        private val http by lazy { CalimeroClientOptions.defaultHttpClient() }

        /** The emulator reaches the host as 10.0.2.2, but `merod local`'s relying party is `localhost`. */
        private fun devRpId(host: String): String = if (host == "10.0.2.2" || host == "127.0.0.1") "localhost" else host
    }
}

/** [ChatBackend] over whichever session is signed in now; signed out, every call says so. */
private class SessionChatBackend(
    private val current: () -> ChatBackend?,
) : ChatBackend {
    private fun live(): ChatBackend = current() ?: throw ChatNotReadyException("Sign in first.")

    override val accountId: String? get() = current()?.accountId

    override suspend fun view(
        contextId: String,
        method: String,
        args: JsonObject,
    ): JsonElement? = live().view(contextId, method, args)

    override suspend fun write(
        contextId: String,
        method: String,
        args: JsonObject,
    ): JsonElement? = live().write(contextId, method, args)

    override suspend fun listWorkspaces() = live().listWorkspaces()

    override suspend fun listSubgroups(namespaceId: String) = live().listSubgroups(namespaceId)

    override suspend fun listGroupContexts(groupId: String) = live().listGroupContexts(groupId)

    override suspend fun isMember(contextId: String) = live().isMember(contextId)

    override suspend fun joinChannel(contextId: String) = live().joinChannel(contextId)

    override suspend fun createSubgroup(
        namespaceId: String,
        name: String,
        public: Boolean,
    ) = live().createSubgroup(namespaceId, name, public)

    override suspend fun createContext(
        groupId: String,
        name: String,
        initArgs: JsonObject,
    ) = live().createContext(groupId, name, initArgs)

    override suspend fun foundWorkspace(name: String) = live().foundWorkspace(name)

    override suspend fun createInvitation(namespaceId: String) = live().createInvitation(namespaceId)

    override suspend fun joinWorkspace(
        namespaceId: String,
        invitation: OrgInvitation,
    ): JoinedWorkspace = live().joinWorkspace(namespaceId, invitation)

    override fun changes(contextId: String): Flow<Unit>? = current()?.changes(contextId)
}

/** What became of consent request [requestId] (`consent.pageResult`), as the session's [ConsentResult]. */
private suspend fun CalimeroClient.fetchConsentResult(requestId: String): ConsentResult =
    consent.pageResult(request = requestId).let { ConsentResult(it.requestId, it.kind.value, it.status.value, it.decidedAt) }
