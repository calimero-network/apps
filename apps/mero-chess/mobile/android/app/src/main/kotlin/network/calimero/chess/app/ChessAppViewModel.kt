package network.calimero.chess.app

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
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import network.calimero.chess.BuildConfig
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

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
 * The app's one view model: the signed-in session ([MeroAppSession]) on the cluster the person chose,
 * the invitation waiting to be confirmed, what waits for approval, and the player's name. Screens
 * build their own [LobbyModel] / [TableModel] from [backend]. (Swift `RootView` + `MeroAppSession`.)
 *
 * The cluster and mode are kept beside the session ([SessionStore]), so a relaunch restores it.
 */
@Suppress("TooManyFunctions")
class ChessAppViewModel(
    app: Application,
) : AndroidViewModel(app) {
    private val store: SessionStore =
        runCatching<SessionStore> { EncryptedSessionStore(app, "calimero_session_${ChessConstants.PACKAGE_NAME}") }
            .getOrElse { MemorySessionStore() }

    /** The mode last used (prefills the sign-in screen). */
    val mode: SignInMode = store.value(KEY_MODE)?.let { runCatching { SignInMode.valueOf(it) }.getOrNull() } ?: SignInMode.CLOUD

    /** The Cloud cluster last used: a name or a node URL. */
    val lastCluster: String = store.value(KEY_CLUSTER) ?: BuildConfig.CLUSTER

    /** The development node last used. */
    val lastDevNode: String = store.value(KEY_DEV_NODE) ?: BuildConfig.DEV_NODE_URL

    private val _session = MutableStateFlow<MeroAppSession?>(null)

    /** The session on the chosen cluster; null before the person chose one. */
    val session: StateFlow<MeroAppSession?> = _session.asStateFlow()

    private val _backend = MutableStateFlow<MeroAppBackend?>(null)

    /** The signed-in account's backend, or null when signed out. */
    val backend: StateFlow<MeroAppBackend?> = _backend.asStateFlow()

    private val _revision = MutableStateFlow(0)

    /** Bumped whenever [backend] is rebuilt or an invitation was redeemed, so screens re-read. */
    val revision: StateFlow<Int> = _revision.asStateFlow()

    private val _signIn = MutableStateFlow(SignInState())
    val signIn: StateFlow<SignInState> = _signIn.asStateFlow()

    val names: NameStore = PrefsNameStore(app)

    private val _restored = MutableStateFlow(false)

    /** The stored session has been tried once. */
    val restored: StateFlow<Boolean> = _restored.asStateFlow()

    private val _pendingLink = MutableStateFlow<String?>(null)

    /** An invitation link that arrived while signed out. */
    val pendingLink: StateFlow<String?> = _pendingLink.asStateFlow()

    private val _joining = MutableStateFlow<ChessInvitation?>(null)

    /** An invitation the player is being asked about. */
    val joining: StateFlow<ChessInvitation?> = _joining.asStateFlow()

    /** The table to open, kept here so a join that rebuilds the session keeps it. */
    private val _openTable = MutableStateFlow<TableRef?>(null)
    val openTable: StateFlow<TableRef?> = _openTable.asStateFlow()

    private val _consentReturned = MutableStateFlow(0)

    /** Bumped when the consent page sent the person back: the approvals card re-reads. */
    val consentReturned: StateFlow<Int> = _consentReturned.asStateFlow()

    /** What waits for the person's approval (updates of Mero Chess, node releases). */
    val approvals =
        ApprovalsModel(
            packageName = ChessConstants.PACKAGE_NAME,
            appName = "Mero Chess",
            returnTo = BuildConfig.CONSENT_CALLBACK_URL,
            fetch = { org ->
                val s =
                    _session.value ?: throw com.calimero.mero.app
                        .SignedOutException("pendingApprovals")
                s.client.pendingApprovals(org)
            },
            consent = { request, confirm ->
                val s =
                    _session.value ?: throw com.calimero.mero.app
                        .SignedOutException("requestConsent")
                s.requestConsent(getApplication(), request, confirm)
            },
        )

    /** The Activity's passkey (Credential Manager), while one is on screen: [attach]. */
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
                // The cluster can't be reached: stay signed out, the sign-in screen says why on retry.
                _session.value = null
            } finally {
                _restored.value = true
                pickUpInvitation()
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

    /**
     * Sign in to a development cluster (`merod local`) with a software passkey kept on the device:
     * the first time it signs up as [name], after that it signs in with the same key.
     */
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
        viewModelScope.launch {
            _openTable.value = null
            _session.value?.signOut()
        }
    }

    fun dismissSignInError() {
        _signIn.value = _signIn.value.copy(error = null)
    }

    /** Every link the activity receives: the consent page coming back, or an invitation. */
    fun handleLink(url: String) {
        viewModelScope.launch {
            val s = _session.value
            if (s != null && s.handle(url)) {
                if (s.pendingInvitation.value == null) _consentReturned.value += 1
                pickUpInvitation()
            } else if (MeroAppSession.isInvitationLink(url, ChessConstants.PACKAGE_NAME)) {
                _pendingLink.value = url
            }
        }
    }

    /** An invitation link the system handed the app is asked about once signed in. */
    private fun pickUpInvitation() {
        val s = _session.value ?: return
        if (!_restored.value || !s.isSignedIn) return
        val link = s.pendingInvitation.value ?: _pendingLink.value ?: return
        s.dismissPendingInvitation()
        _pendingLink.value = null
        _joining.value = ChessInvitation.parse(link)
    }

    fun ask(invitation: ChessInvitation) {
        _joining.value = invitation
    }

    fun dismissJoin() {
        _joining.value = null
    }

    /** Redeem the invitation being asked about, then open its table. */
    suspend fun join(invitation: ChessInvitation) {
        val backend = _backend.value ?: throw ChessException(ChessException.Kind.NO_RELAY)
        val ref =
            LobbyModel(backend, ChessConstants.PACKAGE_NAME).join(invitation) {
                _session.value?.didJoinNamespace()
            }
        _joining.value = null
        _openTable.value = ref
    }

    fun open(ref: TableRef?) {
        _openTable.value = ref
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
                _signIn.value = SignInState(error = ChessText.error(e))
            }
        }
    }

    /**
     * A [MeroAppSession] on [entry] under [newMode]: a node URL as is, anything else (Cloud only) as
     * a cluster name looked up in the Calimero Cloud directory. Its backend is mirrored into [backend].
     */
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
        val s = MeroAppSession(client, ChessConstants.PACKAGE_NAME, BuildConfig.CONSENT_CALLBACK_URL, store, scope = viewModelScope)
        _session.value = s
        approve()
        watching?.cancel()
        watching =
            viewModelScope.launch {
                launch { s.backend.collect { _backend.value = it } }
                launch { s.revision.collect { _revision.value += 1 } }
                launch { s.pendingInvitation.collect { pickUpInvitation() } }
                launch {
                    s.backend.collect { pickUpInvitation() }
                }
            }
        return s
    }

    companion object {
        /** The origin `merod local` allows (`--origins`); a software passkey's client data claims it. */
        const val DEV_ORIGIN = "http://localhost:3000"
        private const val KEY_MODE = "mero-chess:mode"
        private const val KEY_CLUSTER = "mero-chess:cluster"
        private const val KEY_DEV_NODE = "mero-chess:devNode"
        private const val KEY_DEV_PASSKEY = "mero-chess:devPasskey:"

        /** A node URL (`https://…`, or a host with a dot or port) rather than a cluster name (`eu-shared-1`). */
        fun isUrl(entry: String): Boolean = entry.contains("://") || entry.contains('.') || entry.contains(':')

        /** The emulator reaches the host as 10.0.2.2, but `merod local`'s relying party is `localhost`. */
        private fun devRpId(host: String): String = if (host == "10.0.2.2" || host == "127.0.0.1") "localhost" else host
    }
}

/** The player's name, in SharedPreferences under the web app's key. */
private class PrefsNameStore(
    context: Context,
) : NameStore {
    private val prefs = context.getSharedPreferences("mero-chess", Context.MODE_PRIVATE)
    override var name: String
        get() = prefs.getString(KEY, "").orEmpty()
        set(value) {
            prefs.edit().putString(KEY, value).apply()
        }

    companion object {
        const val KEY = "mero-chess:name"
    }
}
