package network.calimero.docs.app

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.calimero.mero.CalimeroClient
import com.calimero.mero.CalimeroClientOptions
import com.calimero.mero.CalimeroConnectOptions
import com.calimero.mero.CloudPolicy
import com.calimero.mero.ConsentRequest
import com.calimero.mero.ConsentStarted
import com.calimero.mero.PasskeyProvider
import com.calimero.mero.PendingApprovals
import com.calimero.mero.SoftPasskey
import com.calimero.mero.app.MeroAppBackend
import com.calimero.mero.compose.MeroAppSession
import com.calimero.mero.compose.PlatformPasskey
import com.calimero.mero.storage.EncryptedSessionStore
import com.calimero.mero.storage.MemorySessionStore
import com.calimero.mero.storage.SessionStore
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import network.calimero.docs.BuildConfig
import network.calimero.docs.core.BlobLoading
import network.calimero.docs.core.DocTarget
import network.calimero.docs.core.DocsFormat
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.io.IOException
import kotlin.coroutines.cancellation.CancellationException

/** How the app reaches Calimero 1.0. (Swift `CloudSignInPanel`'s two modes.) */
enum class SignInMode {
    /** A Calimero Cloud cluster, by name or a node's URL: real TDX attestation, the device's passkey. */
    CLOUD,

    /** A development node (`merod local`): mock attestation allowed, a software passkey kept on the phone. */
    DEV,
}

/**
 * The app's session, kept across configuration changes: Calimero 1.0 sign-in on the cluster the
 * person chose, the passkey that approves step-ups, links (consent returns, invitations, documents)
 * and approvals. Screens build their models from [backend]. (Swift `MeroAppSession` + `AppConfig`.)
 *
 * A [MeroAppSession] is bound to one [CalimeroClient], so signing in to another cluster builds a
 * new one. The mode and the cluster are kept beside the session ([SessionStore]) so a relaunch
 * restores it.
 */
@Suppress("TooManyFunctions")
class DocsAppViewModel(
    app: Application,
) : AndroidViewModel(app) {
    private val store: SessionStore =
        runCatching<SessionStore> { EncryptedSessionStore(app, "calimero_session_${DocsFormat.PACKAGE_NAME}") }
            .getOrElse { MemorySessionStore() }

    private val _mode = MutableStateFlow(store.value(KEY_MODE)?.let { runCatching { SignInMode.valueOf(it) }.getOrNull() } ?: SignInMode.CLOUD)

    /** The mode last signed in with. */
    val mode: StateFlow<SignInMode> = _mode.asStateFlow()

    /** The cluster last used: a name or a node URL (`-PmeroCluster` prefills it). */
    val lastCluster: String = store.value(KEY_CLUSTER) ?: BuildConfig.CLUSTER

    /** The development node last used (`-PmeroDevNodeUrl`, else `merod local` from the emulator). */
    val lastDevNode: String = store.value(KEY_DEV_NODE) ?: BuildConfig.DEV_NODE_URL.ifBlank { DEFAULT_DEV_NODE }

    private val _session = MutableStateFlow<MeroAppSession?>(null)

    /** The session on the chosen cluster; null before sign-in picks one. */
    val session: StateFlow<MeroAppSession?> = _session.asStateFlow()

    private val _backend = MutableStateFlow<MeroAppBackend?>(null)

    /** The signed-in account's backend, or null when signed out. */
    val backend: StateFlow<MeroAppBackend?> = _backend.asStateFlow()

    private val _revision = MutableStateFlow(0)

    /** Bumped whenever the account or what it sees changes: screens re-read. */
    val revision: StateFlow<Int> = _revision.asStateFlow()

    private val _restored = MutableStateFlow(false)
    val restored: StateFlow<Boolean> = _restored.asStateFlow()

    private val _busy = MutableStateFlow(false)

    /** A sign-in is running. */
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)

    /** Why the last sign-in failed, in words. */
    val error: StateFlow<String?> = _error.asStateFlow()

    private val _pendingInvitation = MutableStateFlow<String?>(null)

    /** An invitation link waiting for the person to join (after sign-in, if they were signed out). */
    val pendingInvitation: StateFlow<String?> = _pendingInvitation.asStateFlow()

    /** A document link waiting for the signed-in screens to open it. */
    private val _openDoc = MutableStateFlow<DocTarget?>(null)
    val openDoc: StateFlow<DocTarget?> = _openDoc.asStateFlow()

    /** The Activity's passkey (Credential Manager), while one is on screen: [attach]. */
    private var activityPasskey: PasskeyProvider? = null
    private var mirror: Job? = null

    /** Image bytes: a blob of the folder's docs app instance (`GET /apps/{app}/blobs/{id}`). */
    val blobs =
        BlobLoading { id, appId ->
            val backend = _backend.value ?: throw IOException("Not signed in")
            backend.getBlob(id, appId)
        }

    /** What this phone opened last, per workspace. */
    val recents: RecentStore = PrefsRecentStore(app.getSharedPreferences("mero-docs", Context.MODE_PRIVATE))

    /** One [WorkspaceModel] per workspace for the session, shared by its screens. */
    private val workspaces = mutableMapOf<String, WorkspaceModel>()
    private var workspacesBackend: MeroAppBackend? = null

    fun workspaceModel(
        backend: MeroAppBackend,
        workspace: Workspace,
    ): WorkspaceModel {
        if (workspacesBackend !== backend) {
            workspaces.clear()
            workspacesBackend = backend
        }
        return workspaces.getOrPut(workspace.id) { WorkspaceModel(backend, workspace, recents) }
    }

    init {
        viewModelScope.launch {
            try {
                val url = store.value(KEY_NODE)
                if (store.load() != null && url != null) {
                    open(
                        _mode.value,
                        client(
                            _mode.value, url,
                            nodes =
                                store
                                    .value(KEY_NODES)
                                    .orEmpty()
                                    .split(' ')
                                    .filter { it.isNotBlank() },
                        ),
                    ).restore()
                }
            } finally {
                _restored.value = true
            }
        }
    }

    /**
     * The Activity on screen, or null once it is gone: its passkey approves the account's step-ups
     * on a real cluster. Held only while it lives.
     */
    fun attach(activity: Context?) {
        activityPasskey = activity?.let { PlatformPasskey(it) }
        approve()
    }

    /** Hand the session the passkey that approves its step-ups. */
    private fun approve() {
        _session.value?.passkey = devPasskey(_mode.value) ?: activityPasskey
    }

    private fun devPasskey(mode: SignInMode): PasskeyProvider? {
        if (mode != SignInMode.DEV) return null
        val url = store.value(KEY_NODE) ?: return null
        return store.value(KEY_DEV_PASSKEY + url)?.let { runCatching { SoftPasskey.restore(it) }.getOrNull() }
    }

    /**
     * Sign in (or, with [create], sign up as [name]) on a Calimero Cloud cluster with the device's
     * passkey. [cluster] is a name (`eu-shared-1`, its nodes read from the Calimero Cloud directory)
     * or a node's URL.
     */
    fun signInCloud(
        activity: Context,
        cluster: String,
        create: Boolean,
        name: String,
    ) = attempt {
        val target = cluster.trim().trimEnd('/')
        val client =
            if (isNodeUrl(target)) {
                client(SignInMode.CLOUD, target)
            } else {
                CalimeroClient.connect(
                    CalimeroConnectOptions(cluster = target, policy = CloudPolicy.production, httpClient = CalimeroClientOptions.defaultHttpClient()),
                )
            }
        store.setValue(KEY_CLUSTER, target)
        val s = open(SignInMode.CLOUD, client)
        val passkey = PlatformPasskey(activity)
        if (create) s.signUp(passkey, name.trim()) else s.signIn(passkey)
    }

    /**
     * Sign in to a development node (`merod local`) with a software passkey kept on the phone: the
     * first time it signs up as [name], after that it signs in with the same key.
     */
    fun signInDev(
        url: String,
        name: String,
    ) = attempt {
        val trimmed = url.trim().trimEnd('/')
        store.setValue(KEY_DEV_NODE, trimmed)
        val s = open(SignInMode.DEV, client(SignInMode.DEV, trimmed))
        val saved = store.value(KEY_DEV_PASSKEY + trimmed)?.let { runCatching { SoftPasskey.restore(it) }.getOrNull() }
        if (saved != null) {
            s.signIn(saved)
        } else {
            val passkey = SoftPasskey(rpId = trimmed.toHttpUrlOrNull()?.host?.let(::devRpId) ?: "localhost", origin = DEV_ORIGIN)
            s.signUp(passkey, name.trim().ifBlank { "android" })
            store.setValue(KEY_DEV_PASSKEY + trimmed, passkey.export())
        }
        approve()
    }

    fun signOut() {
        viewModelScope.launch {
            _session.value?.signOut()
            mirror?.cancel()
            _session.value = null
            _backend.value = null
            _revision.value += 1
        }
    }

    /**
     * A link the app received: a document (`https://mero-docs.vercel.app/app/<ws>/f/<folder>/d/<doc>`),
     * the consent page coming back (`mero-docs://consent?…`), or an invitation to a workspace.
     */
    fun handleLink(url: String) {
        DocsFormat.parseDocLink(url)?.let {
            _openDoc.value = it
            return
        }
        if (MeroAppSession.isInvitationLink(url, DocsFormat.PACKAGE_NAME)) {
            _pendingInvitation.value = url
            return
        }
        viewModelScope.launch { _session.value?.handle(url) }
    }

    fun docOpened() {
        _openDoc.value = null
    }

    fun dismissInvitation() {
        _pendingInvitation.value = null
    }

    /** Join the workspace [pendingInvitation] invites to (`POST /invites/{token}/redeem`). */
    suspend fun joinInvitation() {
        val link = _pendingInvitation.value ?: return
        val s =
            _session.value ?: throw com.calimero.mero.app
                .SignedOutException("joinInvitation")
        try {
            s.handle(link)
            s.redeemPendingInvitation()
        } finally {
            _pendingInvitation.value = null
        }
        _revision.value += 1
    }

    /** What waits for the person's decision in [org] (or their own apps). */
    suspend fun pendingApprovals(org: String? = null): PendingApprovals {
        val s =
            _session.value ?: throw com.calimero.mero.app
                .SignedOutException("pendingApprovals")
        return s.client.pendingApprovals(org)
    }

    /**
     * Ask the account holder to approve [request] on the node's consent page, in a Custom Tab.
     * [confirm] shows the confirmation code first.
     */
    suspend fun requestConsent(
        context: Context,
        request: ConsentRequest,
        confirm: suspend (ConsentStarted) -> Boolean,
    ): ConsentStarted {
        val s =
            _session.value ?: throw com.calimero.mero.app
                .SignedOutException("requestConsent")
        return s.requestConsent(context, request, confirm)
    }

    /** Where the person is connected, for the account's Details. */
    val nodeUrl: String? get() = _session.value?.let { store.value(KEY_NODE) }

    private fun attempt(block: suspend () -> Unit) {
        _error.value = null
        _busy.value = true
        viewModelScope.launch {
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                _error.value = DocsFormat.errorText(e)
            } finally {
                _busy.value = false
            }
        }
    }

    private fun client(
        mode: SignInMode,
        url: String,
        nodes: List<String> = emptyList(),
    ): CalimeroClient =
        CalimeroClient(
            CalimeroClientOptions(
                baseUrl = url,
                nodes = nodes,
                policy = if (mode == SignInMode.DEV) CloudPolicy.development else CloudPolicy.production,
                httpClient = CalimeroClientOptions.defaultHttpClient(),
            ),
        )

    /** A [MeroAppSession] over [client] under [mode], its backend mirrored into [backend]. */
    private suspend fun open(
        mode: SignInMode,
        client: CalimeroClient,
    ): MeroAppSession {
        val nodes = client.nodes
        _mode.value = mode
        store.setValue(KEY_MODE, mode.name)
        store.setValue(KEY_NODE, nodes.first())
        store.setValue(KEY_NODES, nodes.drop(1).joinToString(" "))
        mirror?.cancel()
        _session.value?.passkey = null
        val s = MeroAppSession(client, DocsFormat.PACKAGE_NAME, CONSENT_CALLBACK, store, scope = viewModelScope)
        _session.value = s
        approve()
        mirror =
            viewModelScope.launch {
                launch { s.backend.collectLatest { _backend.value = it } }
                s.revision.collectLatest { _revision.value += 1 }
            }
        return s
    }

    companion object {
        /** Where the consent page sends the person back; the manifest's intent filter matches it. */
        const val CONSENT_CALLBACK = "mero-docs://consent"

        /** The origin `merod local` allows (`--origins`); a software passkey's client data claims it. */
        const val DEV_ORIGIN = "http://localhost:3000"

        /** `merod local` from the emulator. */
        const val DEFAULT_DEV_NODE = "http://10.0.2.2:2501"

        private const val KEY_MODE = "mode"
        private const val KEY_NODE = "nodeUrl"
        private const val KEY_NODES = "nodes"
        private const val KEY_CLUSTER = "cluster"
        private const val KEY_DEV_NODE = "devNodeUrl"
        private const val KEY_DEV_PASSKEY = "devPasskey:"

        /** A node's URL (`https://…`, or a host with a dot or port), not a cluster's name. (Swift `CloudSettings.isNodeURL`.) */
        fun isNodeUrl(value: String): Boolean = "://" in value || '.' in value || ':' in value

        /** The emulator reaches the host as 10.0.2.2, but `merod local`'s relying party is `localhost`. */
        private fun devRpId(host: String): String = if (host == "10.0.2.2" || host == "127.0.0.1") "localhost" else host
    }
}
