package network.calimero.updates.app

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
import kotlinx.serialization.json.Json
import network.calimero.updates.BuildConfig
import network.calimero.updates.core.ErrorText
import network.calimero.updates.core.UpdatesInvitation
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** How the app is signed in. */
enum class SignInMode {
    /** Calimero Cloud: real TDX quotes from a signed mero-tee release, the device's passkey. */
    CLOUD,

    /** `merod local` (or any `--dev` cluster): mock attestation allowed, a software passkey kept on the device. */
    DEV,
}

/**
 * The app's session and where the person is: the company list, one company's audiences, or an open
 * audience. The session is a [MeroAppSession] on the Calimero 1.0 cluster the person chose
 * (Calimero Cloud by cluster name or node URL, or a development node); the activity's links
 * (invitations, the consent page sending the person back) land here.
 *
 * The mode and cluster are kept beside the session ([SessionStore]), so a relaunch restores it.
 */
@Suppress("TooManyFunctions")
class UpdatesViewModel(
    app: Application,
) : AndroidViewModel(app) {
    private val sessions: SessionStore =
        runCatching<SessionStore> { EncryptedSessionStore(app, "calimero_session_${UpdatesInvitation.PACKAGE_NAME}") }
            .getOrElse { MemorySessionStore() }

    private val prefs = app.getSharedPreferences("mero-updates", Context.MODE_PRIVATE)

    private val _audience = MutableStateFlow(restoreAudience())

    /** The audience on screen, or null for the companies. */
    val audience: StateFlow<AudienceSummary?> = _audience.asStateFlow()

    private val _company = MutableStateFlow<CompanyRoute?>(null)

    /** The company whose audiences are on screen, or null for the company list. */
    val company: StateFlow<CompanyRoute?> = _company.asStateFlow()

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
        close()
        _company.value = null
        viewModelScope.launch {
            _session.value?.signOut()
        }
    }

    fun open(audience: AudienceSummary) {
        _audience.value = audience
        prefs.edit().putString(KEY_AUDIENCE, Json.encodeToString(AudienceSummary.serializer(), audience)).apply()
    }

    fun openCompany(route: CompanyRoute?) {
        _company.value = route
    }

    /** Back to the audience list of the company this audience is in. */
    fun switchAudience() {
        val current = _audience.value ?: return
        close()
        _company.value = CompanyRoute(CompanySummary(current.companyId, current.companyName))
    }

    fun land(landing: InvitationLanding) {
        when (landing) {
            is InvitationLanding.Audience -> open(landing.audience)
            is InvitationLanding.Company -> {
                close()
                _company.value = CompanyRoute(landing.company, justJoined = true)
            }
        }
    }

    /** A company was joined: on 1.0 the account is a member at once, so the screens only re-read. */
    suspend fun didJoin() {
        _session.value?.didJoinNamespace()
    }

    private fun close() {
        _audience.value = null
        prefs.edit().remove(KEY_AUDIENCE).apply()
    }

    private fun restoreAudience(): AudienceSummary? =
        prefs.getString(KEY_AUDIENCE, null)?.let { raw ->
            runCatching { Json.decodeFromString(AudienceSummary.serializer(), raw) }.getOrNull()
        }

    /** A link the activity received: an invitation (kept until confirmed), or the consent page coming back. */
    fun handleLink(url: String) {
        if (MeroAppSession.isInvitationLink(url, UpdatesInvitation.PACKAGE_NAME) || UpdatesInvitation.parse(url) != null) {
            _pendingInvitation.value = url
            return
        }
        viewModelScope.launch { _session.value?.handle(url) }
    }

    fun dismissPendingInvitation() {
        _pendingInvitation.value = null
    }

    /** The orgs (companies) of this app the account is in, for approvals: id and name. */
    suspend fun companies(): List<Pair<String, String>> =
        _backend.value
            ?.listNamespaces()
            .orEmpty()
            .map { it.id to (it.name ?: "Company") }

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
                _error.value = ErrorText.describe(e)
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
        val s = MeroAppSession(client, UpdatesInvitation.PACKAGE_NAME, CONSENT_CALLBACK, sessions, scope = viewModelScope)
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
        const val CONSENT_CALLBACK = "mero-updates://consent"

        /** The origin `merod local` allows (`--origins`); a software passkey's client data claims it. */
        const val DEV_ORIGIN = "http://localhost:3000"

        /** `merod local` from the emulator. */
        const val DEFAULT_DEV_NODE = "http://10.0.2.2:2501"

        private const val KEY_MODE = "updates.mode"
        private const val KEY_CLUSTER = "updates.cluster"
        private const val KEY_DEV_NODE = "updates.devNode"
        private const val KEY_DEV_PASSKEY = "updates.devPasskey:"
        private const val KEY_AUDIENCE = "openAudience"

        /** A node URL (`https://…`, or a host with a dot or a port) rather than a cluster name. */
        fun isNodeUrl(input: String): Boolean = "://" in input || '.' in input || ':' in input

        /** The emulator reaches the host as 10.0.2.2, but `merod local`'s relying party is `localhost`. */
        private fun devRpId(host: String): String = if (host == "10.0.2.2" || host == "127.0.0.1") "localhost" else host
    }
}
