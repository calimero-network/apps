package network.calimero.forum

import android.app.Application
import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.calimero.mero.CalimeroClient
import com.calimero.mero.CalimeroClientOptions
import com.calimero.mero.CalimeroConnectOptions
import com.calimero.mero.CloudPolicy
import com.calimero.mero.PasskeyProvider
import com.calimero.mero.SoftPasskey
import com.calimero.mero.app.MeroAppBackend
import com.calimero.mero.app.SignedOutException
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
import network.calimero.forum.core.ApprovalsModel
import network.calimero.forum.core.ForumConstants
import network.calimero.forum.core.ForumErrorText
import network.calimero.forum.core.ForumInvitation
import network.calimero.forum.core.InvitationModel
import network.calimero.forum.core.NameStore
import network.calimero.forum.ui.ForumApp
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * The one activity. Links arrive here, on the launch intent (cold start) or through
 * [onNewIntent], and go to [ForumViewModel.handleLink]: the node's consent page sending the person
 * back (`mero-forum://consent?request_id=…&result=…`), or an invitation
 * (`https://links.calimero.network/com.calimero.mero-forum/join?invitation=…`, or the web app's
 * `?invite=inv_…`).
 *
 * While it lives, its passkey (Credential Manager) approves the account's step-ups (inviting,
 * member changes): [ForumViewModel.attach].
 */
class MainActivity : ComponentActivity() {
    private val vm: ForumViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        vm.attach(this)
        if (savedInstanceState == null) consume(intent)
        setContent {
            ForumApp(vm = vm, onCloud = { cluster, create, name -> vm.signInCloud(this, cluster, create, name) })
        }
    }

    override fun onDestroy() {
        vm.attach(null)
        super.onDestroy()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        consume(intent)
    }

    private fun consume(intent: Intent?) {
        val url = intent?.data?.toString() ?: return
        vm.handleLink(url)
        // Handled once: a configuration change must not replay it.
        intent.data = null
    }
}

/** How the app signs in. */
enum class SignInMode {
    /** Calimero Cloud: a cluster by name or node URL, real attestation, the device's passkey. */
    CLOUD,

    /** A development cluster (`merod local`): mock attestation allowed, a software passkey kept on the device. */
    DEV,
}

/** The sign-in screen's state. */
data class SignInState(
    val busy: Boolean = false,
    val error: String? = null,
)

/**
 * The session on the cluster the person chose, the invitation being redeemed, what waits for
 * approval, and your name, for the app's life. The cluster and mode are kept beside the session
 * ([SessionStore]), so a relaunch restores it.
 */
@Suppress("TooManyFunctions")
class ForumViewModel(
    app: Application,
) : AndroidViewModel(app) {
    private val store: SessionStore =
        runCatching<SessionStore> { EncryptedSessionStore(app, "calimero_session_${ForumConstants.PACKAGE_NAME}") }
            .getOrElse { MemorySessionStore() }

    /** The mode last used (prefills the sign-in screen). */
    val mode: SignInMode = store.value(KEY_MODE)?.let { runCatching { SignInMode.valueOf(it) }.getOrNull() } ?: SignInMode.CLOUD

    /** The Cloud cluster last used: a name or a node URL. */
    val lastCluster: String = store.value(KEY_CLUSTER) ?: BuildConfig.CLUSTER

    /** The development node last used. */
    val lastDevNode: String = store.value(KEY_DEV_NODE) ?: BuildConfig.DEV_NODE_URL

    private val _session = MutableStateFlow<MeroAppSession?>(null)
    val session: StateFlow<MeroAppSession?> = _session.asStateFlow()

    private val _backend = MutableStateFlow<MeroAppBackend?>(null)

    /** The signed-in account's backend, or null when signed out. */
    val backend: StateFlow<MeroAppBackend?> = _backend.asStateFlow()

    private val _revision = MutableStateFlow(0)

    /** Bumped whenever [backend] is rebuilt, so screens re-read. */
    val revision: StateFlow<Int> = _revision.asStateFlow()

    private val _restoring = MutableStateFlow(true)
    val restoring: StateFlow<Boolean> = _restoring.asStateFlow()

    private val _signIn = MutableStateFlow(SignInState())
    val signIn: StateFlow<SignInState> = _signIn.asStateFlow()

    private val _consentReturned = MutableStateFlow(0)

    /** Bumped when the consent page sent the person back: the approvals card re-reads. */
    val consentReturned: StateFlow<Int> = _consentReturned.asStateFlow()

    val invitation = InvitationModel()
    val names: NameStore = PrefsNameStore(app)

    /** What waits for the person's approval (updates of Mero Forum, node releases). */
    val approvals =
        ApprovalsModel(
            packageName = ForumConstants.PACKAGE_NAME,
            appName = "Mero Forum",
            returnTo = BuildConfig.CONSENT_CALLBACK_URL,
            fetch = { org -> (_session.value ?: throw SignedOutException("pendingApprovals")).client.pendingApprovals(org) },
            consent = { request, confirm ->
                (_session.value ?: throw SignedOutException("requestConsent")).requestConsent(getApplication(), request, confirm)
            },
        )

    private var activityPasskey: PasskeyProvider? = null
    private var watching: Job? = null

    init {
        viewModelScope.launch {
            try {
                if (store.load() != null) open(mode, if (mode == SignInMode.DEV) lastDevNode else lastCluster).restore()
            } catch (e: CancellationException) {
                throw e
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                _session.value = null
            } finally {
                _restoring.value = false
            }
        }
    }

    /** The Activity on screen, or null once it is gone: its passkey approves the account's step-ups. */
    fun attach(activity: Context?) {
        activityPasskey = activity?.let { PlatformPasskey(it) }
        approve()
    }

    private fun approve() {
        _session.value?.passkey = devPasskey() ?: activityPasskey
    }

    private fun devPasskey(): PasskeyProvider? =
        if (store.value(KEY_MODE) == SignInMode.DEV.name) {
            store.value(KEY_DEV_PASSKEY + store.value(KEY_DEV_NODE))?.let { runCatching { SoftPasskey.restore(it) }.getOrNull() }
        } else {
            null
        }

    /** Sign in (or, with [create], sign up as [name]) on a Cloud cluster, by name or node URL, with the device's passkey. */
    fun signInCloud(
        activity: Context,
        cluster: String,
        create: Boolean,
        name: String,
    ) = attempt {
        val s = open(SignInMode.CLOUD, cluster)
        if (create) s.signUp(PlatformPasskey(activity), name.trim()) else s.signIn(PlatformPasskey(activity))
        approve()
    }

    /** Sign in to a development cluster (`merod local`) with a software passkey kept on the device. */
    fun signInDev(
        url: String,
        name: String,
    ) = attempt {
        val trimmed = url.trim().trimEnd('/')
        val s = open(SignInMode.DEV, trimmed)
        val saved = store.value(KEY_DEV_PASSKEY + trimmed)?.let { runCatching { SoftPasskey.restore(it) }.getOrNull() }
        if (saved != null) {
            s.signIn(saved)
        } else {
            val passkey = SoftPasskey(rpId = trimmed.toHttpUrlOrNull()?.host?.let(::devRpId) ?: "localhost", origin = DEV_ORIGIN)
            s.signUp(passkey, name.trim().ifEmpty { "Android" })
            store.setValue(KEY_DEV_PASSKEY + trimmed, passkey.export())
        }
        approve()
    }

    fun signOut() {
        viewModelScope.launch { _session.value?.signOut() }
    }

    fun dismissSignInError() {
        _signIn.value = _signIn.value.copy(error = null)
    }

    /** After redeeming an invitation: re-read what the account sees. */
    suspend fun didJoin() {
        _session.value?.didJoinNamespace()
    }

    /** Every link the activity receives: the consent page coming back, or an invitation. */
    fun handleLink(url: String) =
        viewModelScope.launch {
            if (consentReturn(url) != null) {
                _session.value?.handle(url)
                _consentReturned.value += 1
            } else if (ForumInvitation.parse(url) != null) {
                invitation.open(url)
            }
        }

    private fun attempt(block: suspend () -> Unit) {
        _signIn.value = SignInState(busy = true)
        viewModelScope.launch {
            try {
                block()
                _signIn.value = SignInState()
            } catch (e: CancellationException) {
                _signIn.value = SignInState()
                throw e
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                _signIn.value = SignInState(error = ForumErrorText.describe(e))
            }
        }
    }

    /** A [MeroAppSession] on [entry]: a node URL as is, anything else (Cloud only) as a cluster name. */
    private suspend fun open(
        newMode: SignInMode,
        entry: String,
    ): MeroAppSession {
        val trimmed = entry.trim().trimEnd('/')
        store.setValue(KEY_MODE, newMode.name)
        store.setValue(if (newMode == SignInMode.DEV) KEY_DEV_NODE else KEY_CLUSTER, trimmed)
        val policy = if (newMode == SignInMode.DEV) CloudPolicy.development else CloudPolicy.production
        val client =
            if (newMode == SignInMode.DEV || isUrl(trimmed)) {
                CalimeroClient(CalimeroClientOptions(baseUrl = trimmed, policy = policy))
            } else {
                CalimeroClient.connect(CalimeroConnectOptions(cluster = trimmed, policy = policy))
            }
        val s = MeroAppSession(client, ForumConstants.PACKAGE_NAME, BuildConfig.CONSENT_CALLBACK_URL, store, scope = viewModelScope)
        _session.value = s
        approve()
        watching?.cancel()
        watching =
            viewModelScope.launch {
                launch { s.backend.collect { _backend.value = it } }
                launch { s.revision.collect { _revision.value += 1 } }
            }
        return s
    }

    companion object {
        /** The origin `merod local` allows (`--origins`); a software passkey's client data claims it. */
        const val DEV_ORIGIN = "http://localhost:3000"
        private const val KEY_MODE = "mero-forum:mode"
        private const val KEY_CLUSTER = "mero-forum:cluster"
        private const val KEY_DEV_NODE = "mero-forum:devNode"
        private const val KEY_DEV_PASSKEY = "mero-forum:devPasskey:"

        /** A node URL (`https://…`, or a host with a dot or port) rather than a cluster name (`eu-shared-1`). */
        fun isUrl(entry: String): Boolean = entry.contains("://") || entry.contains('.') || entry.contains(':')

        /** The emulator reaches the host as 10.0.2.2, but `merod local`'s relying party is `localhost`. */
        private fun devRpId(host: String): String = if (host == "10.0.2.2" || host == "127.0.0.1") "localhost" else host
    }
}

/** [NameStore] in SharedPreferences. */
class PrefsNameStore(
    context: Context,
) : NameStore {
    private val prefs = context.getSharedPreferences("forum", Context.MODE_PRIVATE)

    override var name: String
        get() = prefs.getString(KEY, "").orEmpty()
        set(value) = prefs.edit().putString(KEY, value.trim()).apply()

    private companion object {
        const val KEY = "displayName"
    }
}
