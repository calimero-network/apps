package network.calimero.crm.app

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
import com.calimero.mero.consentReturn
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
import network.calimero.crm.BuildConfig
import network.calimero.crm.core.CrmInvitation
import network.calimero.crm.core.ErrorText
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** How the app reaches Calimero 1.0. */
enum class SignInMode {
    /** A Calimero Cloud cluster (by name, or a node URL): real TDX quotes, the device's passkey. */
    CLOUD,

    /** `merod local`: mock attestation allowed, a software passkey kept on the device. */
    DEV,
}

/**
 * The app's session and which pipeline is open. The session is the SDK's [MeroAppSession] on the
 * cluster the person chose at sign-in (a Calimero Cloud cluster by name or node URL, or a
 * development node); the chosen target is kept beside it, so a relaunch restores it.
 */
@Suppress("TooManyFunctions")
class CrmViewModel(
    app: Application,
) : AndroidViewModel(app) {
    private val store: SessionStore =
        runCatching<SessionStore> { EncryptedSessionStore(app, "calimero_session_${CrmInvitation.PACKAGE_NAME}") }
            .getOrElse { MemorySessionStore() }

    private val prefs = app.getSharedPreferences("mero-crm", Context.MODE_PRIVATE)

    /** Device-local pipeline and workspace names (see [LocalNames]). */
    val names = LocalNames(PreferencesStore(prefs))

    /** The session on the chosen cluster; null while signed out. */
    var session: MeroAppSession? = null
        private set

    private val _backend = MutableStateFlow<MeroAppBackend?>(null)

    /** The signed-in account's backend, or null when signed out. */
    val backend: StateFlow<MeroAppBackend?> = _backend.asStateFlow()

    private val _revision = MutableStateFlow(0)

    /** Bumped whenever the session changes or a workspace was joined: screens re-read. */
    val revision: StateFlow<Int> = _revision.asStateFlow()

    private val _restoring = MutableStateFlow(true)
    val restoring: StateFlow<Boolean> = _restoring.asStateFlow()

    private val _busy = MutableStateFlow(false)

    /** A sign-in is running. */
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)

    /** Why the last sign-in failed, in words. */
    val error: StateFlow<String?> = _error.asStateFlow()

    private val _pendingInvitation = MutableStateFlow<String?>(null)

    /** An invitation link that arrived and waits for the person to confirm it (signed in or not). */
    val pendingInvitation: StateFlow<String?> = _pendingInvitation.asStateFlow()

    private val _openPipeline = MutableStateFlow(restorePipeline())

    /** The pipeline on screen, or null for the workspace list. */
    val openPipeline: StateFlow<PipelineRef?> = _openPipeline.asStateFlow()

    /** The Activity's passkey (Credential Manager) while one is on screen: [attach]. */
    private var activityPasskey: PasskeyProvider? = null
    private var mirror: Job? = null

    /** The cluster to prefill: `meroCluster` from Gradle, else the last one used. */
    val savedCluster: String get() = store.value(KEY_TARGET)?.takeIf { mode == SignInMode.CLOUD } ?: BuildConfig.CLUSTER

    /** The development node to prefill. */
    val savedDevNode: String get() = store.value(KEY_TARGET)?.takeIf { mode == SignInMode.DEV } ?: BuildConfig.DEV_NODE_URL

    private val mode: SignInMode
        get() = store.value(KEY_MODE)?.let { runCatching { SignInMode.valueOf(it) }.getOrNull() } ?: SignInMode.CLOUD

    val account: String? get() = session?.account

    val applicationId: String get() = CrmInvitation.PACKAGE_NAME

    /** Where the node's consent page sends the person back (the manifest's intent filter). */
    val consentCallback: String get() = BuildConfig.CONSENT_CALLBACK_URL

    init {
        viewModelScope.launch {
            try {
                val target = store.value(KEY_TARGET)
                if (store.load() != null && target != null) connect(mode, target).restore()
            } catch (e: CancellationException) {
                throw e
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                _error.value = ErrorText.describe(e)
            } finally {
                _restoring.value = false
            }
        }
    }

    /**
     * The Activity on screen, or null once it is gone: its passkey approves the account's step-ups
     * (inviting, member changes) on a real cluster. Held only while it lives.
     */
    fun attach(activity: Context?) {
        activityPasskey = activity?.let { PlatformPasskey(it) }
        approve()
    }

    /**
     * Sign in (or, with [create], create an account named [name]) on a Calimero Cloud cluster with
     * the device's passkey. [target] is the cluster's name, or a node URL.
     */
    fun signInCloud(
        activity: Context,
        target: String,
        create: Boolean,
        name: String,
    ) = attempt {
        val s = connect(SignInMode.CLOUD, target.trim())
        if (create) s.signUp(PlatformPasskey(activity), name.trim()) else s.signIn(PlatformPasskey(activity))
    }

    /**
     * Sign in to a development node (`merod local`) with a software passkey kept on the device: the
     * first time it creates an account named [name], after that it signs in with the same key.
     */
    fun signInDev(
        url: String,
        name: String,
    ) = attempt {
        val trimmed = url.trim().trimEnd('/')
        val s = connect(SignInMode.DEV, trimmed)
        val saved = devPasskey(trimmed)
        if (saved != null) {
            s.signIn(saved)
        } else {
            val host = trimmed.toHttpUrlOrNull()?.host
            val passkey = SoftPasskey(rpId = host?.let(::devRpId) ?: "localhost", origin = DEV_ORIGIN)
            s.signUp(passkey, name.trim().ifEmpty { "android" })
            store.setValue(KEY_DEV_PASSKEY + trimmed, passkey.export())
        }
        approve()
    }

    fun signOut() {
        open(null)
        viewModelScope.launch {
            session?.signOut()
            mirror?.cancel()
            session = null
            _backend.value = null
            _revision.value += 1
        }
    }

    /** A link the app received: the consent page coming back, or a workspace invitation. */
    fun handleLink(url: String) {
        if (consentReturn(url) != null) {
            viewModelScope.launch { session?.handle(url) }
            return
        }
        if (MeroAppSession.isInvitationLink(url, CrmInvitation.PACKAGE_NAME) || CrmInvitation.parse(url) != null) {
            _pendingInvitation.value = url
        }
    }

    fun dismissPendingInvitation() {
        _pendingInvitation.value = null
    }

    /** What waits for the person's decision in [org] (or their own apps). */
    suspend fun pendingApprovals(org: String? = null): PendingApprovals =
        session?.client?.pendingApprovals(org) ?: throw com.calimero.mero.app
            .SignedOutException("pendingApprovals")

    /**
     * Ask the person to approve [request] on the node's consent page in a Custom Tab; [confirm]
     * shows the confirmation code first.
     */
    suspend fun requestConsent(
        context: Context,
        request: ConsentRequest,
        confirm: suspend (ConsentStarted) -> Boolean,
    ): ConsentStarted =
        session?.requestConsent(context, request, confirm) ?: throw com.calimero.mero.app
            .SignedOutException("requestConsent")

    fun open(pipeline: PipelineRef?) {
        _openPipeline.value = pipeline
        prefs.edit().putString(OPEN_KEY, pipeline?.let { Json.encodeToString(PipelineRef.serializer(), it) }).apply()
    }

    /** A workspace was joined: re-read what the account sees. */
    suspend fun didJoin() {
        _revision.value += 1
    }

    private fun devPasskey(url: String): PasskeyProvider? =
        store.value(KEY_DEV_PASSKEY + url)?.let { runCatching { SoftPasskey.restore(it) }.getOrNull() }

    /** Hand the session the passkey that approves its step-ups. */
    private fun approve() {
        val target = store.value(KEY_TARGET).orEmpty()
        session?.passkey = (if (mode == SignInMode.DEV) devPasskey(target) else null) ?: activityPasskey
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

    /** A [MeroAppSession] on [target] under [newMode]'s policy, its backend mirrored into [backend]. */
    private suspend fun connect(
        newMode: SignInMode,
        target: String,
    ): MeroAppSession {
        store.setValue(KEY_MODE, newMode.name)
        store.setValue(KEY_TARGET, target)
        val policy = if (newMode == SignInMode.DEV) CloudPolicy.development else CloudPolicy.production
        val client =
            if (newMode == SignInMode.CLOUD && !isNodeUrl(target)) {
                CalimeroClient.connect(CalimeroConnectOptions(cluster = target, policy = policy))
            } else {
                CalimeroClient(CalimeroClientOptions(baseUrl = target.trimEnd('/'), policy = policy))
            }
        val s = MeroAppSession(client, CrmInvitation.PACKAGE_NAME, consentCallback, store, scope = viewModelScope)
        mirror?.cancel()
        session = s
        approve()
        mirror =
            viewModelScope.launch {
                s.backend.collect {
                    _backend.value = it
                    _revision.value += 1
                }
            }
        return s
    }

    private fun restorePipeline(): PipelineRef? =
        prefs.getString(OPEN_KEY, null)?.let { raw ->
            runCatching { Json.decodeFromString(PipelineRef.serializer(), raw) }.getOrNull()
        }

    companion object {
        /** The origin `merod local` allows (`--origins`); a software passkey's client data claims it. */
        const val DEV_ORIGIN = "http://localhost:3000"
        private const val OPEN_KEY = "openPipeline"
        private const val KEY_MODE = "crm.mode"
        private const val KEY_TARGET = "crm.target"
        private const val KEY_DEV_PASSKEY = "crm.devPasskey:"

        /** Whether [value] names a node (`https://…`, or a host with a dot or port) rather than a cluster. */
        fun isNodeUrl(value: String): Boolean = "://" in value || '.' in value || ':' in value

        /** The emulator reaches the host as 10.0.2.2, but `merod local`'s relying party is `localhost`. */
        private fun devRpId(host: String): String = if (host == "10.0.2.2" || host == "127.0.0.1") "localhost" else host
    }
}
