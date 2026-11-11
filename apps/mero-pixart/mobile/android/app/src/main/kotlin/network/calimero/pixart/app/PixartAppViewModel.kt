package network.calimero.pixart.app

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
import network.calimero.pixart.BuildConfig
import network.calimero.pixart.core.ApprovalsModel
import network.calimero.pixart.core.BlobLoading
import network.calimero.pixart.core.BlobStore
import network.calimero.pixart.core.InvitationModel
import network.calimero.pixart.core.PixartFormat
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.io.IOException

/** Where a link or a joined invitation asks to go. */
sealed interface Destination {
    data class Project(
        val teamId: String,
        val contextId: String,
    ) : Destination

    data class Team(
        val teamId: String,
        val name: String,
    ) : Destination
}

/**
 * The app's session, kept across configuration changes, on Calimero 1.0: a [MeroAppSession] on the
 * team's cluster (by name through the node directory, or by a node URL) or on a development
 * cluster (`merod local`, mock attestation, a software passkey); links (project links,
 * invitations, the consent page coming back); approvals. Screens build their models from [backend].
 * (iOS: `MeroAppSession` + `SignInView`.)
 */
@OptIn(ExperimentalCoroutinesApi::class)
@Suppress("TooManyFunctions")
class PixartAppViewModel(
    app: Application,
) : AndroidViewModel(app) {
    private val sessionStore: SessionStore =
        runCatching<SessionStore> { EncryptedSessionStore(app, "calimero_session_${PixartFormat.PACKAGE_NAME}") }
            .getOrElse { MemorySessionStore() }

    private val _session = MutableStateFlow<MeroAppSession?>(null)

    /** The session on the chosen cluster; null until one is chosen. */
    val session: StateFlow<MeroAppSession?> = _session.asStateFlow()

    /** The signed-in account's backend, or null when signed out. */
    val backend: StateFlow<MeroAppBackend?> =
        _session.flatMapLatest { it?.backend ?: flowOf(null) }.stateIn(viewModelScope, SharingStarted.Eagerly, null)

    /** Bumped whenever the backend is rebuilt or an invitation was redeemed, so screens re-read. */
    val revision: StateFlow<Int> =
        _session.flatMapLatest { it?.revision ?: flowOf(0) }.stateIn(viewModelScope, SharingStarted.Eagerly, 0)

    private val _restored = MutableStateFlow(false)
    val restored: StateFlow<Boolean> = _restored.asStateFlow()

    private val _busy = MutableStateFlow(false)

    /** A passkey sign-in or sign-up is running. */
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)

    /** Why the last sign-in failed, in plain words. */
    val error: StateFlow<String?> = _error.asStateFlow()

    private val _nodeUrl = MutableStateFlow(sessionStore.value(KEY_NODE)?.ifEmpty { null } ?: BuildConfig.NODE_URL.ifBlank { null })

    /** The cluster chosen: a node URL or a cluster name; null until one is chosen. */
    val nodeUrl: StateFlow<String?> = _nodeUrl.asStateFlow()

    private val _allowMock = MutableStateFlow(sessionStore.value(KEY_MOCK) == "1")

    /** Whether the chosen cluster is a development cluster (mock attestation, a software passkey). */
    val allowMock: StateFlow<Boolean> = _allowMock.asStateFlow()

    /** The development node the cluster sheet suggests. */
    val devNodeDefault: String get() = BuildConfig.DEV_NODE_URL.ifBlank { DEFAULT_DEV_NODE }

    /** A place a link asked to open, waiting for the signed-in screens. */
    private val _destination = MutableStateFlow<Destination?>(null)
    val destination: StateFlow<Destination?> = _destination.asStateFlow()

    /** An invitation link being confirmed and redeemed. */
    val invitation = InvitationModel()

    /** Decisions that wait for this account, each approved on the node's consent page. */
    val approvals =
        ApprovalsModel(
            load = { org -> requireNotNull(_session.value) { "Sign in first." }.client.pendingApprovals(org) },
            consent = { build, confirm ->
                val s = _session.value
                val context = activity
                if (s == null || context == null) {
                    null
                } else {
                    val started = s.requestConsent(context, build(s.callbackUrl), confirm)
                    s.consentResult.value?.takeIf { it.requestId == started.requestId }
                        ?: runCatching { s.client.fetchConsentResult(started.requestId) }.getOrNull()
                }
            },
        )

    /** Decoded blobs through the signed-in backend (`/apps/{app}/blobs`), shared by every screen. */
    val blobs =
        BlobStore(
            BlobLoading { id, contextId ->
                val current = backend.value ?: throw IOException("Not signed in")
                current.getBlob(id, contextId)
            },
            Compositor,
        )

    private var activity: Context? = null
    private var signing: Job? = null

    init {
        viewModelScope.launch {
            try {
                val url = _nodeUrl.value
                if (sessionStore.load() != null && url != null && isNodeUrl(url)) open(url, _allowMock.value).restore()
            } finally {
                _restored.value = true
            }
        }
        viewModelScope.launch {
            invitation.stage.collect { stage ->
                if (stage is InvitationModel.Stage.Joined) {
                    _destination.value = Destination.Team(stage.teamId, stage.name)
                    invitation.reset()
                }
            }
        }
    }

    /**
     * The Activity on screen, or null once it is gone: its passkey (Credential Manager) approves the
     * account's step-ups on a real cluster (inviting), and it opens consent pages. Held only while it lives.
     */
    fun attach(context: Context?) {
        activity = context
        approve()
    }

    /**
     * Use [target] from now on: a node URL as it is, a development cluster with mock attestation,
     * or a cluster name through the node directory.
     */
    fun chooseCluster(
        target: String,
        mock: Boolean,
    ) {
        val trimmed = target.trim().trimEnd('/')
        _error.value = null
        if (mock || isNodeUrl(trimmed)) {
            open(trimmed, mock)
            return
        }
        attempt {
            val client = CalimeroClient.connect(CalimeroConnectOptions(cluster = trimmed, policy = CloudPolicy.production))
            open(client.nodeUrl, false, client)
        }
    }

    /** Sign in with the device's passkey; on a development cluster with the soft passkey kept for it (signing up the first time). */
    fun signIn(context: Context) =
        attempt {
            val s = requireNotNull(_session.value) { "Choose your cluster first." }
            if (_allowMock.value) {
                val url = _nodeUrl.value.orEmpty()
                val saved = devPasskey(url)
                if (saved != null) {
                    s.signIn(saved)
                } else {
                    val passkey = SoftPasskey(rpId = devRpId(url.toHttpUrlOrNull()?.host ?: "localhost"), origin = DEV_ORIGIN)
                    s.signUp(passkey, "android")
                    sessionStore.setValue(KEY_DEV_PASSKEY + url, passkey.export())
                }
                approve()
            } else {
                s.signIn(PlatformPasskey(context))
            }
        }

    /** Create an account named [name] with a new passkey, and sign in. */
    fun signUp(
        context: Context,
        name: String,
    ) = attempt {
        val s = requireNotNull(_session.value) { "Choose your cluster first." }
        if (_allowMock.value) {
            val url = _nodeUrl.value.orEmpty()
            val passkey = SoftPasskey(rpId = devRpId(url.toHttpUrlOrNull()?.host ?: "localhost"), origin = DEV_ORIGIN)
            s.signUp(passkey, name.trim())
            sessionStore.setValue(KEY_DEV_PASSKEY + url, passkey.export())
            approve()
        } else {
            s.signUp(PlatformPasskey(context), name.trim())
        }
    }

    fun handleLink(url: String) {
        PixartFormat.parseProjectLink(url)?.let { (team, project) ->
            _destination.value = Destination.Project(team, project)
            return
        }
        if (consentReturn(url) != null) {
            viewModelScope.launch { _session.value?.handle(url) }
            return
        }
        if (MeroAppSession.isInvitationLink(url, PixartFormat.PACKAGE_NAME) || url.startsWith("calimero://", ignoreCase = true)) {
            invitation.open(url)
        }
    }

    fun acceptInvitation() {
        viewModelScope.launch {
            invitation.accept(backend = { backend.value }, didJoin = { _session.value?.didJoinNamespace() })
        }
    }

    fun destinationOpened() {
        _destination.value = null
    }

    fun signOut() {
        viewModelScope.launch { _session.value?.signOut() }
    }

    private fun devPasskey(url: String): PasskeyProvider? =
        sessionStore.value(KEY_DEV_PASSKEY + url)?.let { runCatching { SoftPasskey.restore(it) }.getOrNull() }

    /** Hand the session the passkey that approves its step-ups. */
    private fun approve() {
        val s = _session.value ?: return
        s.passkey = if (_allowMock.value) devPasskey(_nodeUrl.value.orEmpty()) else activity?.let(::PlatformPasskey)
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
                    _error.value = PixartFormat.errorText(e)
                } finally {
                    _busy.value = false
                }
            }
    }

    /** A [MeroAppSession] on [url] (or [connected], a client the node directory gave). */
    private fun open(
        url: String,
        mock: Boolean,
        connected: CalimeroClient? = null,
    ): MeroAppSession {
        val current = _session.value
        if (connected == null && current != null && url == _nodeUrl.value && mock == _allowMock.value) return current
        _nodeUrl.value = url
        _allowMock.value = mock
        sessionStore.setValue(KEY_NODE, url)
        sessionStore.setValue(KEY_MOCK, if (mock) "1" else "0")
        val policy = if (mock) CloudPolicy.development else CloudPolicy.production
        val client = connected ?: CalimeroClient(CalimeroClientOptions(baseUrl = url, policy = policy))
        val s = MeroAppSession(client, PixartFormat.PACKAGE_NAME, BuildConfig.CONSENT_CALLBACK_URL, sessionStore, scope = viewModelScope)
        _session.value = s
        approve()
        return s
    }

    companion object {
        /** The origin `merod local` allows (`--origins`); a software passkey's client data claims it. */
        const val DEV_ORIGIN = "http://localhost:3000"

        /** `merod local` on the host, as the emulator reaches it. */
        const val DEFAULT_DEV_NODE = "http://10.0.2.2:2501"
        private const val KEY_NODE = "nodeUrl"
        private const val KEY_MOCK = "allowMock"
        private const val KEY_DEV_PASSKEY = "devPasskey:"

        /** Whether [value] names a node (`https://…`, a host with a dot or a port) rather than a cluster (`eu-shared-1`). */
        fun isNodeUrl(value: String): Boolean = "://" in value || '.' in value || ':' in value

        /** The emulator reaches the host as 10.0.2.2, but `merod local`'s relying party is `localhost`. */
        private fun devRpId(host: String): String = if (host == "10.0.2.2" || host == "127.0.0.1") "localhost" else host
    }
}

/** What became of consent request [requestId] (`consent.pageResult`), as the session's [ConsentResult]. */
private suspend fun CalimeroClient.fetchConsentResult(requestId: String): ConsentResult =
    consent.pageResult(request = requestId).let { ConsentResult(it.requestId, it.kind.value, it.status.value, it.decidedAt) }
