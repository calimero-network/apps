package network.calimero.calendar.app

import android.app.Activity
import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.calimero.mero.CalimeroClient
import com.calimero.mero.CalimeroClientOptions
import com.calimero.mero.CalimeroConnectOptions
import com.calimero.mero.CloudPolicy
import com.calimero.mero.PasskeyProvider
import com.calimero.mero.SoftPasskey
import com.calimero.mero.app.MeroAppBackend
import com.calimero.mero.compose.MeroAppSession
import com.calimero.mero.compose.PlatformPasskey
import com.calimero.mero.storage.EncryptedSessionStore
import com.calimero.mero.storage.MemorySessionStore
import com.calimero.mero.storage.SessionStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import network.calimero.calendar.BuildConfig
import network.calimero.calendar.data.CalendarConstants
import network.calimero.calendar.data.ErrorText
import network.calimero.calendar.data.LocalNames
import network.calimero.calendar.data.PrefsKeyValueStore
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.lang.ref.WeakReference

/** Where the app is: the teams list, a team's calendars, or one calendar. */
sealed interface Screen {
    data object Teams : Screen

    data class TeamCalendars(
        val team: Team,
    ) : Screen

    data class Calendar(
        val team: Team,
        val calendar: CalendarRef,
    ) : Screen
}

/** How the app signs in. */
enum class SignInMode {
    /** A Calimero Cloud cluster: real TDX quotes from a signed mero-tee release, the device's passkey. */
    CLOUD,

    /** `merod local` (a development node): mock attestation allowed, a software passkey kept on the device. */
    DEVELOPMENT,
}

/**
 * The app's one Android view model: the [MeroAppSession] on the cluster the person chose (Calimero
 * Cloud by name or node URL, or a development node), the device-local names, and the navigation
 * stack. The chosen cluster's nodes are kept beside the session ([SessionStore]), so a relaunch
 * restores it without asking the node directory again. (iOS `MeroCalendarApp` + `SignInView`.)
 */
@Suppress("TooManyFunctions")
class CalendarAppViewModel(
    app: Application,
) : AndroidViewModel(app) {
    private val store: SessionStore =
        runCatching<SessionStore> { EncryptedSessionStore(app, "calimero_session_${CalendarConstants.PACKAGE_NAME}") }
            .getOrElse { MemorySessionStore() }

    private val prefs = PrefsKeyValueStore(app.getSharedPreferences("mero-calendar", Context.MODE_PRIVATE))
    val names = LocalNames(prefs)

    private val _session = MutableStateFlow<MeroAppSession?>(null)

    /** The session on the chosen cluster; null before one was chosen. */
    val session: StateFlow<MeroAppSession?> = _session.asStateFlow()

    /** The signed-in account's backend, or null. */
    @OptIn(ExperimentalCoroutinesApi::class)
    val backend: StateFlow<MeroAppBackend?> =
        _session
            .flatMapLatest { it?.backend ?: flowOf(null) }
            .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    private val _restored = MutableStateFlow(false)
    val restored: StateFlow<Boolean> = _restored.asStateFlow()

    private val _busy = MutableStateFlow(false)

    /** A sign-in is running. */
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)

    /** Why the last sign-in failed, in words. */
    val error: StateFlow<String?> = _error.asStateFlow()

    private val _stack = MutableStateFlow<List<Screen>>(listOf(Screen.Teams))
    val stack: StateFlow<List<Screen>> = _stack.asStateFlow()

    /** Teams joined in this run (their calendars may still be on their way). */
    val justJoined = mutableSetOf<String>()

    /** What the sign-in screen prefills. */
    val lastCluster: String get() = store.value(KEY_CLUSTER) ?: BuildConfig.CLUSTER
    val lastDevNode: String get() = store.value(KEY_DEV_NODE) ?: BuildConfig.DEV_NODE_URL

    private var activity: WeakReference<Activity> = WeakReference(null)

    init {
        viewModelScope.launch {
            try {
                restore()
            } finally {
                _restored.value = true
            }
        }
    }

    /**
     * The Activity on screen, or null once it is gone: its passkey approves the account's step-ups
     * (invites, member changes, leaving) and it opens the consent page. Held weakly.
     */
    fun attach(activity: Activity?) {
        this.activity = WeakReference(activity)
        approve()
    }

    /** Sign in (or, with [create], sign up as [name]) on a Calimero Cloud cluster: a name or a node URL. */
    fun signInCloud(
        cluster: String,
        create: Boolean,
        name: String,
    ) = attempt {
        val context = checkNotNull(activity.get()) { "No screen to show the passkey sheet on" }
        val s = openCloud(cluster.trim())
        val passkey = PlatformPasskey(context)
        if (create) s.signUp(passkey, name.trim()) else s.signIn(passkey)
        approve()
    }

    /**
     * Sign in to a development node (`merod local`) with a software passkey kept on the device: the
     * first time it signs up as [name], after that it signs in with the same key.
     */
    fun signInDevelopment(
        url: String,
        name: String,
    ) = attempt {
        val trimmed = url.trim().trimEnd('/')
        val s = open(SignInMode.DEVELOPMENT, listOf(trimmed))
        store.setValue(KEY_DEV_NODE, trimmed)
        val saved = devPasskey(trimmed)
        if (saved != null) {
            s.signIn(saved)
        } else {
            val passkey = SoftPasskey(rpId = trimmed.toHttpUrlOrNull()?.host?.let(::devRpId) ?: "localhost", origin = DEV_ORIGIN)
            s.signUp(passkey, name.trim().ifBlank { "android" })
            store.setValue(KEY_DEV_PASSKEY + trimmed, passkey.export())
        }
        approve()
    }

    fun signOut() =
        viewModelScope.launch {
            _session.value?.signOut()
            _stack.value = listOf(Screen.Teams)
        }

    /** A link the app received: the consent page coming back, or an invitation. */
    fun handleLink(url: String) =
        viewModelScope.launch {
            _restored.first { it }
            _session.value?.handle(url)
        }

    /** Ask the node to approve [request]: the consent page opens in a Custom Tab once [confirm] says so. */
    suspend fun requestConsent(
        request: com.calimero.mero.ConsentRequest,
        confirm: suspend (com.calimero.mero.ConsentStarted) -> Boolean,
    ): Boolean {
        val s = _session.value ?: return false
        val context = activity.get() ?: return false
        s.requestConsent(context, request, confirm)
        return true
    }

    fun push(screen: Screen) {
        _stack.value = _stack.value + screen
    }

    fun pop(): Boolean {
        if (_stack.value.size <= 1) return false
        _stack.value = _stack.value.dropLast(1)
        return true
    }

    /** After redeeming an invitation: re-read, then open the team. */
    suspend fun didJoin(team: Team) {
        justJoined += team.id
        _session.value?.didJoinNamespace()
        _stack.value = listOf(Screen.Teams, Screen.TeamCalendars(team))
    }

    // ---- internals ------------------------------------------------------------------------

    private suspend fun restore() {
        val mode = store.value(KEY_MODE)?.let { runCatching { SignInMode.valueOf(it) }.getOrNull() } ?: return
        val nodes =
            store
                .value(KEY_NODES)
                ?.split('\n')
                ?.filter { it.isNotBlank() }
                .orEmpty()
        if (nodes.isEmpty() || store.load() == null) return
        open(mode, nodes).restore()
        approve()
    }

    /** A cluster name goes through the node directory; a node URL is used as it is. */
    private suspend fun openCloud(cluster: String): MeroAppSession {
        store.setValue(KEY_CLUSTER, cluster)
        if (isUrl(cluster)) return open(SignInMode.CLOUD, listOf(cluster.trimEnd('/')))
        val client = CalimeroClient.connect(CalimeroConnectOptions(cluster = cluster, policy = CloudPolicy.production))
        return adopt(SignInMode.CLOUD, client, client.nodes)
    }

    private fun open(
        mode: SignInMode,
        nodes: List<String>,
    ): MeroAppSession {
        val policy = if (mode == SignInMode.DEVELOPMENT) CloudPolicy.development else CloudPolicy.production
        val client =
            CalimeroClient(
                CalimeroClientOptions(
                    baseUrl = nodes.first(),
                    nodes = nodes.drop(1),
                    policy = policy,
                    httpClient = CalimeroClientOptions.defaultHttpClient(),
                ),
            )
        return adopt(mode, client, nodes)
    }

    private fun adopt(
        mode: SignInMode,
        client: CalimeroClient,
        nodes: List<String>,
    ): MeroAppSession {
        store.setValue(KEY_MODE, mode.name)
        store.setValue(KEY_NODES, nodes.joinToString("\n"))
        val s =
            MeroAppSession(client, CalendarConstants.PACKAGE_NAME, BuildConfig.CONSENT_CALLBACK_URL, store, scope = viewModelScope)
        _session.value = s
        approve()
        return s
    }

    /** Hand the session the passkey that approves its step-ups. */
    private fun approve() {
        val s = _session.value ?: return
        val mode = store.value(KEY_MODE)
        val dev =
            if (mode == SignInMode.DEVELOPMENT.name) {
                store
                    .value(KEY_NODES)
                    ?.lineSequence()
                    ?.firstOrNull()
                    ?.let(::devPasskey)
            } else {
                null
            }
        s.passkey = dev ?: activity.get()?.let { PlatformPasskey(it) as PasskeyProvider }
    }

    private fun devPasskey(url: String): SoftPasskey? = store.value(KEY_DEV_PASSKEY + url)?.let { runCatching { SoftPasskey.restore(it) }.getOrNull() }

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
                _error.value = ErrorText.of(e, "sign in")
            } finally {
                _busy.value = false
            }
        }
    }

    companion object {
        /** The origin `merod local` allows (`--origins`); a software passkey's client data claims it. */
        const val DEV_ORIGIN = "http://localhost:3000"

        private const val KEY_MODE = "mode"
        private const val KEY_NODES = "nodes"
        private const val KEY_CLUSTER = "cluster"
        private const val KEY_DEV_NODE = "devNode"
        private const val KEY_DEV_PASSKEY = "devPasskey:"

        /** A node URL rather than a cluster name. */
        fun isUrl(raw: String): Boolean = raw.contains("://") || raw.contains('.') || raw.contains(':')

        /** The emulator reaches the host as 10.0.2.2, but `merod local`'s relying party is `localhost`. */
        private fun devRpId(host: String): String = if (host == "10.0.2.2" || host == "127.0.0.1") "localhost" else host
    }
}
