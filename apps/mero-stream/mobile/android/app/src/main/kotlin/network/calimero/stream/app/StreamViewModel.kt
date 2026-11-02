package network.calimero.stream.app

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
import com.calimero.mero.compose.MeroAppSession
import com.calimero.mero.compose.PlatformPasskey
import com.calimero.mero.storage.EncryptedSessionStore
import com.calimero.mero.storage.MemorySessionStore
import com.calimero.mero.storage.SessionStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import network.calimero.stream.BuildConfig
import network.calimero.stream.core.CalimeroMediaChannel
import network.calimero.stream.core.ErrorText
import network.calimero.stream.core.MediaChannel
import network.calimero.stream.core.StreamInvitation
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** A room being called in. */
data class CallTarget(
    val stream: StreamSummary,
    val room: RoomSummary,
    val contextId: String,
)

/**
 * Where to sign in: a Calimero Cloud cluster (by name, or one of its nodes' URLs), or a
 * development node (`merod local`, mock attestation). (Identical to the iOS `ClusterChoice`.)
 */
sealed interface ClusterChoice {
    val value: String

    data class Cloud(
        override val value: String,
    ) : ClusterChoice

    data class Development(
        override val value: String,
    ) : ClusterChoice

    companion object {
        /** A URL is a node; anything else is a cluster name for the node directory. */
        fun isUrl(text: String): Boolean {
            val url = text.trim().toHttpUrlOrNull() ?: return false
            return url.host.isNotEmpty()
        }
    }
}

/**
 * The app's session and where the person is: the stream list, a stream's rooms, the call. The
 * session is the SDK's [MeroAppSession] on the chosen cluster: passkey sign-in over the sealed
 * channel, deep links and invitations, and the consent page for approvals.
 */
@Suppress("TooManyFunctions")
class StreamViewModel(
    app: Application,
) : AndroidViewModel(app) {
    private val store: SessionStore =
        runCatching<SessionStore> { EncryptedSessionStore(app, "calimero_session_${StreamInvitation.PACKAGE_NAME}") }
            .getOrElse { MemorySessionStore() }

    private val _session = MutableStateFlow<MeroAppSession?>(null)

    /** The session on the chosen cluster; null until one is chosen. */
    val sessionFlow: StateFlow<MeroAppSession?> = _session.asStateFlow()

    /** The session; only read on the signed-in screens, which exist only with one. */
    val session: MeroAppSession get() = checkNotNull(_session.value) { "no cluster chosen" }

    private val _choice = MutableStateFlow(initialChoice())

    /** The cluster in use, or null when none is chosen yet. */
    val choice: StateFlow<ClusterChoice?> = _choice.asStateFlow()

    private val _busy = MutableStateFlow(false)

    /** Connecting, signing in or creating an account. */
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    /** Why connecting or signing in failed. */
    val signInError = MutableStateFlow<String?>(null)

    private val _restoring = MutableStateFlow(true)
    val restoring: StateFlow<Boolean> = _restoring.asStateFlow()

    private val prefs = app.getSharedPreferences("mero-stream", Context.MODE_PRIVATE)

    private val _openStream = MutableStateFlow<StreamSummary?>(null)

    /** The stream whose rooms are on screen, or null for the stream list. */
    val openStream: StateFlow<StreamSummary?> = _openStream.asStateFlow()

    private val _call = MutableStateFlow<CallTarget?>(null)

    /** The call on screen. */
    val call: StateFlow<CallTarget?> = _call.asStateFlow()

    /** A room an invitation link asked to open, entered once its stream's rooms load. */
    val autoEnter = MutableStateFlow<RoomSummary?>(null)

    private val _displayName = MutableStateFlow(prefs.getString("displayName", "").orEmpty())

    /** Your name in calls, kept on this device. */
    val displayName: StateFlow<String> = _displayName.asStateFlow()

    /** A link that arrived before a cluster was chosen; handed to the session once there is one. */
    private val _waitingLink = MutableStateFlow<String?>(null)
    val waitingLink: StateFlow<String?> = _waitingLink.asStateFlow()

    /** The Activity's passkey (Credential Manager), while one is on screen: [attach]. */
    private var activityPasskey: PasskeyProvider? = null

    init {
        viewModelScope.launch {
            try {
                _choice.value?.let { choice -> if (open(choice) != null && store.load() != null) _session.value?.restore() }
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

    /** Use [choice] from now on: connect to it (a cluster name asks the node directory). Answers why it failed, or null. */
    suspend fun choose(choice: ClusterChoice): String? {
        signInError.value = null
        _busy.value = true
        try {
            val previous = _choice.value
            if (previous != null && previous != choice) _session.value?.let { runCatching { it.signOut() } }
            return if (open(choice) == null) signInError.value else null
        } finally {
            _busy.value = false
        }
    }

    /** Sign in with a passkey: the device's on a real cluster; on a development node a soft one kept for it, creating its account the first time. */
    fun signIn(activity: Context) =
        attempt {
            val s = session
            when (val choice = _choice.value) {
                is ClusterChoice.Development -> {
                    val saved = devPasskey(choice.value)
                    if (saved != null) {
                        s.signIn(saved)
                    } else {
                        val passkey = SoftPasskey(rpId = devRpId(choice.value), origin = DEV_ORIGIN)
                        s.signUp(passkey, _displayName.value.ifBlank { "android" })
                        store.setValue(KEY_DEV_PASSKEY + choice.value, passkey.export())
                    }
                }
                else -> s.signIn(PlatformPasskey(activity))
            }
            approve()
        }

    /** Create an account named [name] with a new passkey on this device, and sign in. */
    fun signUp(
        activity: Context,
        name: String,
    ) = attempt {
        val s = session
        when (val choice = _choice.value) {
            is ClusterChoice.Development -> {
                val passkey = SoftPasskey(rpId = devRpId(choice.value), origin = DEV_ORIGIN)
                s.signUp(passkey, name)
                store.setValue(KEY_DEV_PASSKEY + choice.value, passkey.export())
            }
            else -> s.signUp(PlatformPasskey(activity), name)
        }
        if (_displayName.value.isBlank()) setDisplayName(name)
        approve()
    }

    fun signOut() {
        _call.value = null
        _openStream.value = null
        viewModelScope.launch { _session.value?.signOut() }
    }

    /** A link the system opened: the consent page coming back, or an invitation. */
    fun handleLink(url: String) {
        val s = _session.value
        if (s == null) {
            _waitingLink.value = url
            return
        }
        viewModelScope.launch { s.handle(url) }
    }

    fun openStream(stream: StreamSummary?) {
        _openStream.value = stream
    }

    fun openCall(target: CallTarget?) {
        _call.value = target
    }

    fun land(landing: InvitationLanding) {
        when (landing) {
            is InvitationLanding.Stream -> _openStream.value = landing.stream
            is InvitationLanding.Room -> {
                autoEnter.value = landing.room
                _openStream.value = landing.stream
            }
        }
    }

    fun setDisplayName(name: String) {
        _displayName.value = name
        prefs.edit().putString("displayName", name).apply()
    }

    /** An invitation was redeemed: screens re-read what the account sees. */
    suspend fun didJoin() = session.didJoinNamespace()

    /** The call's media channel: the room's presence on the cluster. */
    fun mediaChannel(): MediaChannel? {
        val s = _session.value ?: return null
        return CalimeroMediaChannel(s.client, s.account)
    }

    /** Approvals for the signed-in session: read from the node, decided on its consent page. */
    fun approvals(context: Context): ApprovalsModel =
        ApprovalsModel(
            load = { org -> session.client.pendingApprovals(org) },
            consent = { request, confirm -> consent(context, request, confirm) },
        )

    private suspend fun consent(
        context: Context,
        request: (String) -> ConsentRequest,
        confirm: suspend (ConsentStarted) -> Boolean,
    ): ConsentResult? {
        val s = session
        val started = s.requestConsent(context, request(BuildConfig.CONSENT_CALLBACK_URL), confirm)
        // The page's return (handled by the session) answers at once; else ask the node.
        s.consentResult.value
            ?.takeIf { it.requestId == started.requestId }
            ?.let { return it }
        return runCatching { s.client.consentResult(started.requestId) }.getOrNull()
    }

    /** The session on [choice], its client verified as the choice says. Null with [signInError] set when it can't connect. */
    private suspend fun open(choice: ClusterChoice): MeroAppSession? {
        val value = choice.value.trim().trimEnd('/')
        val client =
            try {
                when {
                    choice is ClusterChoice.Development ->
                        CalimeroClient(CalimeroClientOptions(baseUrl = value, policy = CloudPolicy.development))
                    ClusterChoice.isUrl(value) ->
                        CalimeroClient(CalimeroClientOptions(baseUrl = value, policy = CloudPolicy.production))
                    else -> CalimeroClient.connect(CalimeroConnectOptions(cluster = value, policy = CloudPolicy.production))
                }
            } catch (e: CancellationException) {
                throw e
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                signInError.value = if (ClusterChoice.isUrl(value)) ErrorText.describe(e) else "No cluster called “$value” could be reached. ${ErrorText.describe(e)}"
                return null
            }
        val s = MeroAppSession(client, StreamInvitation.PACKAGE_NAME, BuildConfig.CONSENT_CALLBACK_URL, store, scope = viewModelScope)
        val chosen = if (choice is ClusterChoice.Development) ClusterChoice.Development(value) else ClusterChoice.Cloud(value)
        _choice.value = chosen
        store.setValue(KEY_KIND, if (chosen is ClusterChoice.Development) "development" else "cloud")
        store.setValue(KEY_VALUE, value)
        _session.value = s
        approve()
        _waitingLink.value?.let { link ->
            _waitingLink.value = null
            s.handle(link)
        }
        return s
    }

    /** Hand the session the passkey that approves its step-ups. */
    private fun approve() {
        val choice = _choice.value
        _session.value?.passkey = (choice as? ClusterChoice.Development)?.let { devPasskey(it.value) } ?: activityPasskey
    }

    private fun devPasskey(url: String): SoftPasskey? = store.value(KEY_DEV_PASSKEY + url)?.let { runCatching { SoftPasskey.restore(it) }.getOrNull() }

    private fun attempt(block: suspend () -> Unit) {
        signInError.value = null
        _busy.value = true
        viewModelScope.launch {
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                signInError.value = ErrorText.describe(e)
            } finally {
                _busy.value = false
            }
        }
    }

    /** The stored choice, else the build's (`meroCluster` / `meroNodeUrl` + `meroAllowMock`), else none. */
    private fun initialChoice(): ClusterChoice? {
        val kind = store.value(KEY_KIND)
        val value = store.value(KEY_VALUE)
        if (kind != null && !value.isNullOrBlank()) {
            return if (kind == "development") ClusterChoice.Development(value) else ClusterChoice.Cloud(value)
        }
        if (BuildConfig.MERO_CLUSTER.isNotEmpty()) return ClusterChoice.Cloud(BuildConfig.MERO_CLUSTER)
        if (BuildConfig.MERO_NODE_URL.isNotEmpty()) {
            return if (BuildConfig.MERO_ALLOW_MOCK) ClusterChoice.Development(BuildConfig.MERO_NODE_URL) else ClusterChoice.Cloud(BuildConfig.MERO_NODE_URL)
        }
        return null
    }

    companion object {
        /** The origin `merod local` allows (`--origins`); a software passkey's client data claims it. */
        const val DEV_ORIGIN = "http://localhost:3000"

        /** `merod local` from the emulator. */
        const val DEFAULT_DEV_NODE = "http://10.0.2.2:2501"
        private const val KEY_KIND = "mero-stream:cluster-kind"
        private const val KEY_VALUE = "mero-stream:cluster"
        private const val KEY_DEV_PASSKEY = "mero-stream:dev-passkey:"

        /** The emulator reaches the host as 10.0.2.2, but `merod local`'s relying party is `localhost`. */
        private fun devRpId(url: String): String {
            val host = url.toHttpUrlOrNull()?.host ?: return "localhost"
            return if (host == "10.0.2.2" || host == "127.0.0.1") "localhost" else host
        }
    }
}
