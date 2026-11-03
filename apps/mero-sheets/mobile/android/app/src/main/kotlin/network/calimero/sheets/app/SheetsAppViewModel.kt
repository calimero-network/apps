package network.calimero.sheets.app

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.calimero.mero.CalimeroClient
import com.calimero.mero.CalimeroClientOptions
import com.calimero.mero.CalimeroConnectOptions
import com.calimero.mero.CloudPolicy
import com.calimero.mero.ConsentRequest
import com.calimero.mero.ConsentResult
import com.calimero.mero.ConsentStarted
import com.calimero.mero.PasskeyProvider
import com.calimero.mero.SoftPasskey
import com.calimero.mero.app.MeroAppBackend
import com.calimero.mero.compose.MeroAppSession
import com.calimero.mero.compose.PlatformPasskey
import com.calimero.mero.consentReturn
import com.calimero.mero.storage.EncryptedSessionStore
import com.calimero.mero.storage.MemorySessionStore
import com.calimero.mero.storage.SessionStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import network.calimero.sheets.BuildConfig
import network.calimero.sheets.core.MeroSheets
import network.calimero.sheets.core.PrefsSheetsStore
import network.calimero.sheets.core.SheetsInvitation
import network.calimero.sheets.core.SheetsStore
import network.calimero.sheets.core.WorkspaceModel
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** A workspace joined from an invitation, and the spreadsheet the link named. */
data class JoinedWorkspace(
    val namespaceId: String,
    val contextId: String?,
)

/** How the app is signed in. */
enum class SignInMode {
    /** A Calimero Cloud cluster: real TDX quotes from a signed mero-tee release, the device's passkey. */
    CLOUD,

    /** `merod local`: mock attestation allowed, a software passkey kept on the device for that node. */
    DEV,
}

/**
 * The signed-in account for the app's life, on Calimero 1.0: a [MeroAppSession] on the cluster the
 * person chose (by name through the node directory, or by a node URL), or on a development node;
 * and the links the activity receives (the consent page coming back, workspace invitations).
 * (iOS: `MeroAppSession` + `CloudAccess.swift`.)
 */
@OptIn(ExperimentalCoroutinesApi::class)
@Suppress("TooManyFunctions")
class SheetsAppViewModel(
    app: Application,
) : AndroidViewModel(app) {
    private val sessionStore: SessionStore =
        runCatching<SessionStore> { EncryptedSessionStore(app, "calimero_session_${MeroSheets.PACKAGE_NAME}") }
            .getOrElse { MemorySessionStore() }

    val store: SheetsStore = PrefsSheetsStore(app)

    private val _session = MutableStateFlow<MeroAppSession?>(null)

    /** The session on the chosen cluster; null before the first sign-in. */
    val session: StateFlow<MeroAppSession?> = _session.asStateFlow()

    /** The signed-in account's backend, or null when signed out. */
    val backend: StateFlow<MeroAppBackend?> =
        _session.flatMapLatest { it?.backend ?: flowOf(null) }.stateIn(viewModelScope, SharingStarted.Eagerly, null)

    /** Bumped whenever the backend is rebuilt or an invitation was redeemed, so screens re-read. */
    val revision: StateFlow<Int> =
        _session.flatMapLatest { it?.revision ?: flowOf(0) }.stateIn(viewModelScope, SharingStarted.Eagerly, 0)

    /** The decision the consent page sent the person back with, confirmed with the node. */
    val consentResult: StateFlow<ConsentResult?> =
        _session.flatMapLatest { it?.consentResult ?: flowOf(null) }.stateIn(viewModelScope, SharingStarted.Eagerly, null)

    private val _restoring = MutableStateFlow(true)

    /** The stored session is being reconnected. */
    val restoring: StateFlow<Boolean> = _restoring.asStateFlow()

    private val _busy = MutableStateFlow(false)

    /** A sign-in or sign-up is running. */
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)

    /** Why the last sign-in failed, in plain words. */
    val error: StateFlow<String?> = _error.asStateFlow()

    private val _pendingInvitation = MutableStateFlow<String?>(null)

    /** An invitation link that arrived and waits for the person to confirm (kept across sign-in). */
    val pendingInvitation: StateFlow<String?> = _pendingInvitation.asStateFlow()

    private val _justJoined = MutableStateFlow<JoinedWorkspace?>(null)

    /** A workspace joined from an invitation, and the spreadsheet the link named. */
    val justJoined: StateFlow<JoinedWorkspace?> = _justJoined.asStateFlow()

    /** The cluster sign-in uses: `meroNodeUrl`, else the last one used. Empty: the person enters one. */
    val clusterDefault: String get() = BuildConfig.NODE_URL.ifBlank { sessionStore.value(KEY_CLUSTER).orEmpty() }

    /** Whether the cluster is fixed at build time (`meroNodeUrl`), so the field is hidden. */
    val clusterFixed: Boolean get() = BuildConfig.NODE_URL.isNotBlank()

    /** The development node "Development node" starts with. */
    val devNodeDefault: String get() = BuildConfig.DEV_NODE_URL.ifBlank { DEFAULT_DEV_NODE }

    private var mode: SignInMode = sessionStore.value(KEY_MODE)?.let { runCatching { SignInMode.valueOf(it) }.getOrNull() } ?: SignInMode.CLOUD
    private var nodeUrl: String = sessionStore.value(KEY_NODE).orEmpty()
    private var activityPasskey: PasskeyProvider? = null
    private var signing: Job? = null

    init {
        viewModelScope.launch {
            try {
                if (sessionStore.load() != null && nodeUrl.isNotEmpty()) open(mode, nodeUrl).restore()
            } finally {
                _restoring.value = false
            }
        }
    }

    /**
     * The Activity on screen, or null once it is gone: its passkey (Credential Manager) approves the
     * account's step-ups on a real cluster (inviting, member changes). Held only while it lives.
     */
    fun attach(activity: Context?) {
        activityPasskey = activity?.let(::PlatformPasskey)
        approve()
    }

    /**
     * Sign in (or, with [create], sign up as [name]) on [cluster] with the device's passkey:
     * a cluster name goes through the node directory, a node URL is used as it is.
     */
    fun signInCloud(
        activity: Context,
        cluster: String,
        create: Boolean,
        name: String,
    ) = attempt {
        val target = cluster.trim().trimEnd('/')
        val s =
            if (isNodeUrl(target)) {
                open(SignInMode.CLOUD, target)
            } else {
                val client = CalimeroClient.connect(CalimeroConnectOptions(cluster = target, policy = CloudPolicy.production))
                open(SignInMode.CLOUD, client.nodeUrl, client)
            }
        sessionStore.setValue(KEY_CLUSTER, target)
        if (create) s.signUp(PlatformPasskey(activity), name.trim()) else s.signIn(PlatformPasskey(activity))
    }

    /**
     * Connect to a development node (`merod local`) with a software passkey kept on the device for
     * it: the first time it signs up as [name], after that it signs in with the same key.
     */
    fun signInDev(
        url: String,
        name: String,
    ) = attempt {
        val target = url.trim().trimEnd('/')
        val s = open(SignInMode.DEV, target)
        val saved = devPasskey(target)
        if (saved != null) {
            s.signIn(saved)
        } else {
            val host = target.toHttpUrlOrNull()?.host ?: "localhost"
            val passkey = SoftPasskey(rpId = devRpId(host), origin = DEV_ORIGIN)
            s.signUp(passkey, name.trim().ifBlank { "android" })
            sessionStore.setValue(KEY_DEV_PASSKEY + target, passkey.export())
        }
        approve()
    }

    fun clearError() {
        _error.value = null
    }

    fun signOut() {
        viewModelScope.launch { _session.value?.signOut() }
    }

    /** A link the activity received: the consent page coming back, or a workspace invitation. */
    fun handleLink(url: String) {
        if (consentReturn(url) != null) {
            viewModelScope.launch { _session.value?.handle(url) }
            return
        }
        if (MeroAppSession.isInvitationLink(url, MeroSheets.PACKAGE_NAME) || url.startsWith("calimero://", ignoreCase = true)) {
            _pendingInvitation.value = url
        }
    }

    fun dismissPendingInvitation() {
        _pendingInvitation.value = null
    }

    fun clearJustJoined() {
        _justJoined.value = null
    }

    /** Redeem an invitation; screens re-read and open the workspace it names. */
    suspend fun join(invitation: SheetsInvitation) {
        val s = _session.value ?: return
        val backend = s.backend.value ?: return
        WorkspaceModel(backend, s.applicationId, store).join(invitation)
        _justJoined.value = JoinedWorkspace(invitation.namespaceId, invitation.contextId)
        s.didJoinNamespace()
        dismissPendingInvitation()
    }

    /** What waits for the account's decision in [org] (or its own apps). */
    suspend fun pendingApprovals(org: String? = null) = requireNotNull(_session.value) { "Sign in first." }.client.pendingApprovals(org)

    /**
     * Open the node's consent page for [request] in a Custom Tab. [confirm] shows the request's
     * confirmation code first; answering false leaves the page closed.
     */
    suspend fun requestConsent(
        context: Context,
        request: (String) -> ConsentRequest,
        confirm: suspend (ConsentStarted) -> Boolean,
    ): ConsentStarted {
        val s = requireNotNull(_session.value) { "Sign in first." }
        return s.requestConsent(context, request(s.callbackUrl), confirm)
    }

    private fun devPasskey(url: String): PasskeyProvider? =
        sessionStore.value(KEY_DEV_PASSKEY + url)?.let { runCatching { SoftPasskey.restore(it) }.getOrNull() }

    /** Hand the session the passkey that approves its step-ups. */
    private fun approve() {
        val s = _session.value ?: return
        s.passkey = if (mode == SignInMode.DEV) devPasskey(nodeUrl) else activityPasskey
    }

    private fun attempt(block: suspend () -> Unit) {
        signing?.cancel()
        _error.value = null
        _busy.value = true
        signing =
            viewModelScope.launch {
                try {
                    block()
                } catch (e: CancellationException) {
                    throw e
                } catch (
                    @Suppress("TooGenericExceptionCaught") e: Exception,
                ) {
                    _error.value = CloudErrorText.describe(e)
                } finally {
                    _busy.value = false
                }
            }
    }

    /**
     * A [MeroAppSession] on [url] under [newMode]'s policy, or on [connected] (a client the node
     * directory gave, which fails over between the cluster's nodes).
     */
    private fun open(
        newMode: SignInMode,
        url: String,
        connected: CalimeroClient? = null,
    ): MeroAppSession {
        val current = _session.value
        if (connected == null && current != null && newMode == mode && url == nodeUrl) return current
        mode = newMode
        nodeUrl = url
        sessionStore.setValue(KEY_MODE, newMode.name)
        sessionStore.setValue(KEY_NODE, url)
        val policy = if (newMode == SignInMode.DEV) CloudPolicy.development else CloudPolicy.production
        val client = connected ?: CalimeroClient(CalimeroClientOptions(baseUrl = url, policy = policy))
        val s = MeroAppSession(client, MeroSheets.PACKAGE_NAME, BuildConfig.CONSENT_CALLBACK_URL, sessionStore, scope = viewModelScope)
        _session.value = s
        approve()
        return s
    }

    companion object {
        /** The origin `merod local` allows (`--origins`); a software passkey's client data claims it. */
        const val DEV_ORIGIN = "http://localhost:3000"

        /** `merod local` on the host, as the emulator reaches it. */
        const val DEFAULT_DEV_NODE = "http://10.0.2.2:2501"
        private const val KEY_MODE = "mode"
        private const val KEY_NODE = "nodeUrl"
        private const val KEY_CLUSTER = "cluster"
        private const val KEY_DEV_PASSKEY = "devPasskey:"

        /** Whether [value] names a node (`https://…`, a host with a dot or a port) rather than a cluster (`eu-shared-1`). */
        fun isNodeUrl(value: String): Boolean = "://" in value || '.' in value || ':' in value

        /** The emulator reaches the host as 10.0.2.2, but `merod local`'s relying party is `localhost`. */
        private fun devRpId(host: String): String = if (host == "10.0.2.2" || host == "127.0.0.1") "localhost" else host
    }
}
