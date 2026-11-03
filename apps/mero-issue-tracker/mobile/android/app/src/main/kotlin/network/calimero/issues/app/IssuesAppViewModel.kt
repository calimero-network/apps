package network.calimero.issues.app

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
import com.calimero.mero.PendingApprovals
import com.calimero.mero.SoftPasskey
import com.calimero.mero.app.MeroAppBackend
import com.calimero.mero.app.SignedOutException
import com.calimero.mero.compose.MeroAppSession
import com.calimero.mero.compose.PlatformPasskey
import com.calimero.mero.storage.EncryptedSessionStore
import com.calimero.mero.storage.MemorySessionStore
import com.calimero.mero.storage.SessionStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import network.calimero.issues.BuildConfig
import network.calimero.issues.core.PrefsTrackerStore
import network.calimero.issues.core.Tracker
import network.calimero.issues.core.TrackerFormat
import network.calimero.issues.core.TrackerInvitation
import network.calimero.issues.core.TrackerStore
import network.calimero.issues.core.WorkspaceModel
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** How the app is signed in. */
enum class SignInMode {
    /** Calimero Cloud: real TDX quotes from a signed mero-tee release, the device's passkey. */
    CLOUD,

    /** `merod local` (or any `--dev` cluster): mock attestation allowed, a software passkey kept on the device. */
    DEV,
}

/**
 * The signed-in account for the app's life: a [MeroAppSession] on the Calimero 1.0 cluster the
 * person chose (Calimero Cloud by cluster name or node URL, or a development node), and the links
 * the activity receives (workspace invitations, the consent page sending the person back).
 *
 * The mode and cluster are kept beside the session ([SessionStore]), so a relaunch restores it.
 */
@Suppress("TooManyFunctions")
class IssuesAppViewModel(
    app: Application,
) : AndroidViewModel(app) {
    private val sessions: SessionStore =
        runCatching<SessionStore> { EncryptedSessionStore(app, "calimero_session_${Tracker.PACKAGE_NAME}") }
            .getOrElse { MemorySessionStore() }

    val store: TrackerStore = PrefsTrackerStore(app)

    /** The last sign-in's mode, cluster (a name or a node URL) and development node, for the form. */
    val savedMode: SignInMode = sessions.value(KEY_MODE)?.let { runCatching { SignInMode.valueOf(it) }.getOrNull() } ?: SignInMode.CLOUD
    val savedCluster: String = sessions.value(KEY_CLUSTER) ?: BuildConfig.CLUSTER.trim()
    val savedDevNode: String = sessions.value(KEY_DEV_NODE) ?: BuildConfig.DEV_NODE_URL.trim().ifEmpty { DEFAULT_DEV_NODE }

    private val _session = MutableStateFlow<MeroAppSession?>(null)

    /** The session on the chosen cluster; null before the first sign-in. */
    val session: StateFlow<MeroAppSession?> = _session.asStateFlow()

    private val _backend = MutableStateFlow<MeroAppBackend?>(null)

    /** What the screens run on: the session's backend, or null while signed out. */
    val backend: StateFlow<MeroAppBackend?> = _backend.asStateFlow()

    private val _revision = MutableStateFlow(0)

    /** Bumped whenever the backend is rebuilt or a workspace is joined: screens re-read. */
    val revision: StateFlow<Int> = _revision.asStateFlow()

    private val _restoring = MutableStateFlow(true)
    val restoring: StateFlow<Boolean> = _restoring.asStateFlow()

    private val _busy = MutableStateFlow(false)

    /** A sign-in is running (waiting for the passkey sheet, say). */
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)

    /** Why the last sign-in failed, in words. */
    val error: StateFlow<String?> = _error.asStateFlow()

    private val _pendingInvitation = MutableStateFlow<String?>(null)

    /** An invitation link that arrived and waits to be confirmed (kept while signed out). */
    val pendingInvitation: StateFlow<String?> = _pendingInvitation.asStateFlow()

    private val _consentResult = MutableStateFlow<ConsentResult?>(null)

    /** The decision the consent page sent the person back with, confirmed with the node. */
    val consentResult: StateFlow<ConsentResult?> = _consentResult.asStateFlow()

    private val _justJoined = MutableStateFlow<String?>(null)

    /** A workspace joined from an invitation whose repos may not have arrived yet. */
    val justJoined: StateFlow<String?> = _justJoined.asStateFlow()

    private var mode: SignInMode = savedMode
    private var mirror: Job? = null
    private var activityPasskey: PasskeyProvider? = null

    init {
        viewModelScope.launch {
            try {
                if (sessions.load() != null) reopen()?.restore()
            } catch (e: CancellationException) {
                throw e
            } catch (
                @Suppress("TooGenericExceptionCaught") _: Exception,
            ) {
                // The cluster could not be reached: stay signed out; the form signs in again.
            } finally {
                _restoring.value = false
            }
        }
    }

    /**
     * The Activity on screen, or null once it is gone: its passkey approves the account's step-ups
     * (invites, member changes, leaving) on a real cluster. Held only while it lives.
     */
    fun attach(activity: Context?) {
        activityPasskey = activity?.let(::PlatformPasskey)
        approve()
    }

    /** Sign in (or, with [create], sign up as [name]) to a Calimero Cloud cluster named by [cluster] (a name or a node URL). */
    fun signInCloud(
        activity: Context,
        cluster: String,
        create: Boolean,
        name: String,
    ) = attempt {
        val s = openCloud(cluster.trim())
        val passkey = PlatformPasskey(activity)
        if (create) s.signUp(passkey, name.trim()) else s.signIn(passkey)
    }

    /**
     * Sign in to a development node (`merod local`) with a software passkey kept on the device: the
     * first time it signs up as [name], after that it signs in with the same key.
     */
    fun signInDev(
        url: String,
        name: String,
    ) = attempt {
        val trimmed = url.trim().trimEnd('/')
        val s = open(SignInMode.DEV, client(trimmed, CloudPolicy.development))
        sessions.setValue(KEY_DEV_NODE, trimmed)
        val saved = devPasskey(trimmed)
        if (saved != null) {
            s.signIn(saved)
        } else {
            val passkey = SoftPasskey(rpId = trimmed.toHttpUrlOrNull()?.host?.let(::devRpId) ?: "localhost", origin = DEV_ORIGIN)
            s.signUp(passkey, name.trim().ifBlank { "android" })
            sessions.setValue(KEY_DEV_PASSKEY + trimmed, passkey.export())
        }
        approve()
    }

    fun signOut() {
        viewModelScope.launch {
            _session.value?.signOut()
        }
    }

    /** A link the activity received: an invitation (kept until confirmed), or the consent page coming back. */
    fun handleLink(url: String) {
        if (MeroAppSession.isInvitationLink(url, Tracker.PACKAGE_NAME)) {
            _pendingInvitation.value = url
            return
        }
        viewModelScope.launch { _session.value?.handle(url) }
    }

    fun dismissPendingInvitation() {
        _pendingInvitation.value = null
    }

    fun clearJustJoined() {
        _justJoined.value = null
    }

    /** Redeem an invitation; on 1.0 the account is a member at once, so the screens only re-read. */
    suspend fun join(invitation: TrackerInvitation) {
        val backend = _backend.value ?: throw SignedOutException("join")
        WorkspaceModel(backend, Tracker.PACKAGE_NAME, store).join(invitation)
        _justJoined.value = invitation.namespaceId
        _session.value?.didJoinNamespace()
        dismissPendingInvitation()
    }

    /** What waits for approval in [org] (or the account's own apps). */
    suspend fun pendingApprovals(org: String?): PendingApprovals = (_session.value ?: throw SignedOutException("pendingApprovals")).client.pendingApprovals(org)

    /** Open the node's consent page for [request] in a Custom Tab, after [confirm] showed its code. */
    suspend fun requestConsent(
        context: Context,
        request: (returnTo: String) -> ConsentRequest,
        confirm: suspend (ConsentStarted) -> Boolean,
    ): ConsentStarted? {
        val s = _session.value ?: return null
        return s.requestConsent(context, request(s.callbackUrl), confirm)
    }

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
                _error.value = TrackerFormat.errorText(e)
            } finally {
                _busy.value = false
            }
        }
    }

    /** The session the stored mode and cluster name, for a relaunch. */
    private suspend fun reopen(): MeroAppSession? =
        when (savedMode) {
            SignInMode.DEV -> open(SignInMode.DEV, client(savedDevNode, CloudPolicy.development))
            SignInMode.CLOUD -> savedCluster.takeIf { it.isNotEmpty() }?.let { openCloud(it) }
        }

    /** A cluster by node URL, or by name through the node directory. */
    private suspend fun openCloud(cluster: String): MeroAppSession {
        val client =
            if (isNodeUrl(cluster)) {
                client(cluster.trimEnd('/'), CloudPolicy.production)
            } else {
                CalimeroClient.connect(CalimeroConnectOptions(cluster = cluster, policy = CloudPolicy.production))
            }
        sessions.setValue(KEY_CLUSTER, cluster)
        return open(SignInMode.CLOUD, client)
    }

    private fun client(
        url: String,
        policy: CloudPolicy,
    ) = CalimeroClient(CalimeroClientOptions(baseUrl = url, policy = policy, httpClient = CalimeroClientOptions.defaultHttpClient()))

    /** A [MeroAppSession] on [client], its backend, revision and consent answers mirrored here. */
    private fun open(
        newMode: SignInMode,
        client: CalimeroClient,
    ): MeroAppSession {
        mode = newMode
        sessions.setValue(KEY_MODE, newMode.name)
        val s = MeroAppSession(client, Tracker.PACKAGE_NAME, CONSENT_CALLBACK, sessions, scope = viewModelScope)
        _session.value = s
        approve()
        mirror?.cancel()
        mirror =
            viewModelScope.launch {
                launch { s.backend.collect { _backend.value = it } }
                launch { s.revision.collect { _revision.value += 1 } }
                launch { s.consentResult.collect { _consentResult.value = it } }
            }
        return s
    }

    /** Hand the session the passkey that approves its step-ups. */
    private fun approve() {
        val s = _session.value ?: return
        s.passkey = (if (mode == SignInMode.DEV) devPasskey(s.client.nodeUrl) else null) ?: activityPasskey
    }

    private fun devPasskey(url: String): PasskeyProvider? = sessions.value(KEY_DEV_PASSKEY + url)?.let { runCatching { SoftPasskey.restore(it) }.getOrNull() }

    companion object {
        /** Where the consent page sends the person back; the manifest's intent filter matches it. */
        const val CONSENT_CALLBACK = "mero-issues://consent"

        /** The origin `merod local` allows (`--origins`); a software passkey's client data claims it. */
        const val DEV_ORIGIN = "http://localhost:3000"

        /** `merod local` from the emulator. */
        const val DEFAULT_DEV_NODE = "http://10.0.2.2:2501"

        private const val KEY_MODE = "issues.mode"
        private const val KEY_CLUSTER = "issues.cluster"
        private const val KEY_DEV_NODE = "issues.devNode"
        private const val KEY_DEV_PASSKEY = "issues.devPasskey:"

        /** A node URL (`https://…`, or a host with a dot or a port) rather than a cluster name. */
        fun isNodeUrl(input: String): Boolean = "://" in input || '.' in input || ':' in input

        /** The emulator reaches the host as 10.0.2.2, but `merod local`'s relying party is `localhost`. */
        private fun devRpId(host: String): String = if (host == "10.0.2.2" || host == "127.0.0.1") "localhost" else host
    }
}
