package network.calimero.merraria.app

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
import network.calimero.merraria.BuildConfig
import java.net.URI

/** Where the app signs in. (iOS `ClusterSheet.Mode`.) */
enum class ClusterKind {
    /** A Calimero Cloud cluster, by name or a node's URL: production attestation, the device's passkey. */
    CLOUD,

    /** A `merod local` node: mock attestation allowed, a software passkey kept on the device. */
    DEVELOPMENT,
}

/** The cluster chosen: its [kind] and what was entered (a cluster name, or a node URL). */
data class ClusterChoice(
    val kind: ClusterKind,
    val entry: String,
) {
    /** A node URL rather than a Cloud cluster name. */
    val isUrl: Boolean get() = entry.contains("://")
}

/**
 * The app's one view model: the cluster chosen and the signed-in session on it ([MeroAppSession]),
 * the invitation waiting to be confirmed, the world being played and the player's settings. Screens
 * build their own [WorldsModel] / [GameModel] from the session's backend.
 *
 * The session's client is bound to one cluster, so choosing another builds a new session. The
 * choice is kept beside the account session, so a relaunch restores both.
 */
@Suppress("TooManyFunctions")
class MerrariaAppViewModel(
    app: Application,
) : AndroidViewModel(app) {
    private val store: SessionStore =
        runCatching<SessionStore> { EncryptedSessionStore(app, "calimero_session_${MerrariaConstants.PACKAGE_NAME}") }
            .getOrElse { MemorySessionStore() }

    private val _session = MutableStateFlow<MeroAppSession?>(null)

    /** The session on the chosen cluster; null before one is chosen. */
    val session: StateFlow<MeroAppSession?> = _session.asStateFlow()

    private val _cluster = MutableStateFlow<ClusterChoice?>(null)

    /** The cluster chosen, or null. */
    val cluster: StateFlow<ClusterChoice?> = _cluster.asStateFlow()

    private val _busy = MutableStateFlow(false)

    /** Connecting to a cluster, or a passkey sign-in or sign-up, is running. */
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)

    /** Why the last connect or sign-in failed, in words. */
    val error: StateFlow<String?> = _error.asStateFlow()

    val settings: PlayerSettings = PrefsPlayerSettings(app)

    private val _restored = MutableStateFlow(false)

    /** The stored session has been restored once. */
    val restored: StateFlow<Boolean> = _restored.asStateFlow()

    private val _joining = MutableStateFlow<WorldInvitation?>(null)

    /** An invitation the player is being asked about. */
    val joining: StateFlow<WorldInvitation?> = _joining.asStateFlow()

    private val _pendingLink = MutableStateFlow<String?>(null)

    /** An invitation link that arrived and waits for a signed-in account. */
    val pendingLink: StateFlow<String?> = _pendingLink.asStateFlow()

    /** The world being played, kept here so a join that rebuilds the session keeps it. */
    private val _playing = MutableStateFlow<WorldRef?>(null)
    val playing: StateFlow<WorldRef?> = _playing.asStateFlow()

    /** The Activity's passkey (Credential Manager), while one is on screen: [attach]. */
    private var activityPasskey: PasskeyProvider? = null
    private var signing: Job? = null

    init {
        viewModelScope.launch {
            try {
                val choice = savedChoice()
                if (choice != null) {
                    open(choice)?.restore()
                }
            } catch (e: CancellationException) {
                throw e
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                _error.value = MerrariaText.error(e)
            } finally {
                _restored.value = true
                pickUpInvitation()
            }
        }
    }

    // ---- the cluster and the account ---------------------------------------------------------

    /** Signed in on the chosen cluster. */
    val isSignedIn: Boolean get() = _session.value?.isSignedIn == true

    /**
     * The Activity on screen, or null once it is gone: its passkey approves the account's step-ups
     * (inviting) on a real cluster. Held only while it lives.
     */
    fun attach(activity: Context?) {
        activityPasskey = activity?.let { PlatformPasskey(it) }
        approve()
    }

    /** Talk to [choice]'s cluster from now on (signing out of another). */
    fun choose(choice: ClusterChoice) =
        attempt {
            _session.value?.let { if (it.isSignedIn) it.signOut() }
            open(choice)
        }

    /** Sign in: the device's passkey on a real cluster, the kept software passkey on a development node. */
    fun signIn(activity: Context) =
        attempt {
            val s = _session.value ?: return@attempt
            if (_cluster.value?.kind == ClusterKind.DEVELOPMENT) signInDevelopment(s, null) else s.signIn(PlatformPasskey(activity))
            approve()
            pickUpInvitation()
        }

    /** Create an account named [name] with a new passkey, and sign in. */
    fun signUp(
        activity: Context,
        name: String,
    ) = attempt {
        val s = _session.value ?: return@attempt
        if (_cluster.value?.kind == ClusterKind.DEVELOPMENT) signInDevelopment(s, name) else s.signUp(PlatformPasskey(activity), name)
        approve()
        pickUpInvitation()
    }

    /** Stop a sign-in that is waiting (the person left the passkey sheet). */
    fun cancelSignIn() {
        signing?.cancel()
        _busy.value = false
    }

    fun dismissError() {
        _error.value = null
    }

    fun signOut() {
        viewModelScope.launch {
            _playing.value = null
            _session.value?.signOut()
        }
    }

    /**
     * A development node keeps one software passkey per node URL: the first sign-in creates the
     * account (named [name], or "Fighter"), later ones sign in with the same key.
     */
    private suspend fun signInDevelopment(
        session: MeroAppSession,
        name: String?,
    ) {
        val url = session.client.nodeUrl
        val saved = devPasskey(url)
        if (saved != null && name == null) {
            session.signIn(saved)
            return
        }
        val passkey = SoftPasskey(rpId = devRpId(url), origin = DEV_ORIGIN)
        session.signUp(passkey, name?.ifBlank { null } ?: MerrariaConstants.DEFAULT_PLAYER_NAME)
        store.setValue(KEY_DEV_PASSKEY + url, passkey.export())
    }

    private fun devPasskey(url: String): PasskeyProvider? =
        store.value(KEY_DEV_PASSKEY + url)?.let { runCatching { SoftPasskey.restore(it) }.getOrNull() }

    /** Hand the session the passkey that approves its step-ups. */
    private fun approve() {
        val s = _session.value ?: return
        s.passkey = if (_cluster.value?.kind == ClusterKind.DEVELOPMENT) devPasskey(s.client.nodeUrl) else activityPasskey
    }

    /** A session on [choice]'s cluster; a Cloud cluster's nodes are read from the node directory. */
    private suspend fun open(choice: ClusterChoice): MeroAppSession? {
        val entry = choice.entry.trim().trimEnd('/')
        val client =
            when {
                choice.kind == ClusterKind.DEVELOPMENT ->
                    CalimeroClient(CalimeroClientOptions(baseUrl = entry, policy = CloudPolicy.development))
                choice.isUrl -> CalimeroClient(CalimeroClientOptions(baseUrl = entry, policy = CloudPolicy.production))
                else -> CalimeroClient.connect(CalimeroConnectOptions(cluster = entry, policy = CloudPolicy.production))
            }
        val s = MeroAppSession(client, MerrariaConstants.PACKAGE_NAME, BuildConfig.CONSENT_CALLBACK_URL, store, scope = viewModelScope)
        _cluster.value = choice.copy(entry = entry)
        store.setValue(KEY_KIND, choice.kind.name)
        store.setValue(KEY_ENTRY, entry)
        _session.value = s
        approve()
        return s
    }

    /** The cluster chosen last, else the one the build presets (`-PmeroCluster` / `-PmeroNodeUrl`). */
    private fun savedChoice(): ClusterChoice? {
        val kind = store.value(KEY_KIND)?.let { runCatching { ClusterKind.valueOf(it) }.getOrNull() }
        val entry = store.value(KEY_ENTRY)
        if (kind != null && !entry.isNullOrBlank()) return ClusterChoice(kind, entry)
        val mock = BuildConfig.MERO_ALLOW_MOCK.lowercase() in setOf("1", "yes", "true")
        return when {
            BuildConfig.MERO_NODE_URL.isNotBlank() ->
                ClusterChoice(if (mock) ClusterKind.DEVELOPMENT else ClusterKind.CLOUD, BuildConfig.MERO_NODE_URL)
            BuildConfig.MERO_CLUSTER.isNotBlank() -> ClusterChoice(ClusterKind.CLOUD, BuildConfig.MERO_CLUSTER)
            else -> null
        }
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
                    _error.value = MerrariaText.error(e)
                } finally {
                    _busy.value = false
                }
            }
    }

    // ---- links -------------------------------------------------------------------------------

    /** Every link the activity receives: the consent page coming back, or a world invitation. */
    fun handleLink(url: String) {
        viewModelScope.launch {
            if (consentReturn(url) != null) {
                _session.value?.handle(url)
            } else if (MeroAppSession.isInvitationLink(url, MerrariaConstants.PACKAGE_NAME)) {
                _pendingLink.value = url
                pickUpInvitation()
            }
        }
    }

    /** An invitation link the system handed the app is asked about once signed in. */
    private fun pickUpInvitation() {
        if (!_restored.value || !isSignedIn) return
        val link = _pendingLink.value ?: return
        _pendingLink.value = null
        _joining.value = WorldInvitation.parse(link)
    }

    fun ask(invitation: WorldInvitation) {
        _joining.value = invitation
    }

    fun dismissJoin() {
        _joining.value = null
    }

    /** Redeem the invitation being asked about, then open its world. */
    suspend fun join(invitation: WorldInvitation) {
        val s = _session.value ?: throw MerrariaException(MerrariaException.Kind.SIGNED_OUT)
        val backend = s.backend.value ?: throw MerrariaException(MerrariaException.Kind.SIGNED_OUT)
        val ref = WorldsModel(backend, s.applicationId).join(invitation) { s.didJoinNamespace() }
        _joining.value = null
        _playing.value = ref
    }

    fun play(ref: WorldRef?) {
        _playing.value = ref
    }

    companion object {
        /** The origin `merod local` allows (`--origins`); a software passkey's client data claims it. */
        const val DEV_ORIGIN = "http://localhost:3000"

        /** `merod local` from the emulator. */
        const val DEFAULT_DEV_NODE = "http://10.0.2.2:2501"

        private const val KEY_KIND = "merraria:clusterKind"
        private const val KEY_ENTRY = "merraria:cluster"
        private const val KEY_DEV_PASSKEY = "merraria:devPasskey:"

        /** The emulator reaches the host as 10.0.2.2, but `merod local`'s relying party is `localhost`. */
        fun devRpId(url: String): String {
            val host = runCatching { URI(url).host }.getOrNull() ?: return "localhost"
            return if (host == "10.0.2.2" || host == "127.0.0.1") "localhost" else host
        }
    }
}

/** The player's settings, in SharedPreferences under the web app's keys. */
private class PrefsPlayerSettings(
    context: Context,
) : PlayerSettings {
    private val prefs = context.getSharedPreferences("merraria", Context.MODE_PRIVATE)

    override var name: String
        get() = prefs.getString("mt-name", null)?.trim()?.ifEmpty { null } ?: MerrariaConstants.DEFAULT_PLAYER_NAME
        set(value) {
            prefs.edit().putString("mt-name", value.trim().take(MerrariaConstants.MAX_PLAYER_NAME)).apply()
        }

    override var zoom: Double
        get() =
            prefs
                .getFloat("mt-zoom", MerrariaConstants.DEFAULT_ZOOM.toFloat())
                .toDouble()
                .takeIf { it in MerrariaConstants.MIN_ZOOM..MerrariaConstants.MAX_ZOOM } ?: MerrariaConstants.DEFAULT_ZOOM
        set(value) {
            prefs.edit().putFloat("mt-zoom", MerrariaConstants.clampZoom(value).toFloat()).apply()
        }
}
