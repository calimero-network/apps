package network.calimero.design.app

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
import com.calimero.mero.app.OrgInvitation
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
import network.calimero.design.BuildConfig
import network.calimero.design.core.BlobLoading
import network.calimero.design.core.DesignFormat
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.io.IOException

/** A board a link asked to open. */
data class BoardLink(
    val teamId: String,
    val contextId: String,
)

/**
 * The app's session, kept across configuration changes: sign-in to a Calimero 1.0 cluster
 * (Calimero Cloud by name or node URL, or a development node), team invitations, approvals and
 * links. The node and mode are kept beside the session, so a relaunch restores it. Screens build
 * their models from [backend]. (iOS: `MeroAppSession` + `SignInView`.)
 */
@Suppress("TooManyFunctions")
class DesignAppViewModel(
    app: Application,
) : AndroidViewModel(app) {
    private val store: SessionStore =
        runCatching<SessionStore> { EncryptedSessionStore(app, "calimero_session_${DesignFormat.PACKAGE_NAME}") }
            .getOrElse { MemorySessionStore() }

    private var session: MeroAppSession? = null
    private var mirror: Job? = null
    private val _backend = MutableStateFlow<MeroAppBackend?>(null)

    /** The signed-in account's backend, or null while signed out. */
    val backend: StateFlow<MeroAppBackend?> = _backend.asStateFlow()
    private val _revision = MutableStateFlow(0)

    /** Moves whenever the account changes or joins a team: screens re-read. */
    val revision: StateFlow<Int> = _revision.asStateFlow()
    private val _restored = MutableStateFlow(false)
    val restored: StateFlow<Boolean> = _restored.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    /** A team invitation link that arrived and waits for the person to join or decline. */
    private val _pendingInvitation = MutableStateFlow<OrgInvitation?>(null)
    val pendingInvitation: StateFlow<OrgInvitation?> = _pendingInvitation.asStateFlow()

    /** A board link waiting for the signed-in screens to open it. */
    private val _openBoard = MutableStateFlow<BoardLink?>(null)
    val openBoard: StateFlow<BoardLink?> = _openBoard.asStateFlow()

    /** The signed-in account, or null. */
    val account: String? get() = session?.account

    /** The node the session talks to, for the account sheet. */
    val nodeUrl: String? get() = store.value(KEY_NODES)?.substringBefore(' ')

    /** The cluster the sign-in screen starts with (`-PmeroCluster`), or the last one used. */
    val defaultCluster: String get() = store.value(KEY_CLUSTER) ?: BuildConfig.CLUSTER

    /** What the "Development node" field starts with. */
    val defaultDevNode: String get() = store.value(KEY_DEV_NODE) ?: BuildConfig.DEV_NODE_URL

    /** Image bytes from the board's app instance. */
    val blobs =
        BlobLoading { id, contextId ->
            val current = _backend.value ?: throw IOException("Not signed in")
            current.getBlob(id, contextId)
        }

    private var activityPasskey: PasskeyProvider? = null
    private var devNode: String? = null

    init {
        viewModelScope.launch {
            try {
                val mode = store.value(KEY_MODE)
                val nodes =
                    store
                        .value(KEY_NODES)
                        ?.split(' ')
                        ?.filter { it.isNotBlank() }
                        .orEmpty()
                if (store.load() != null && mode != null && nodes.isNotEmpty()) open(mode == MODE_DEV, nodes).restore()
            } catch (e: CancellationException) {
                throw e
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                _error.value = DesignFormat.errorText(e)
            } finally {
                _restored.value = true
            }
        }
    }

    /** The Activity on screen, or null once it is gone: its passkey approves step-ups on a real cluster. */
    fun attach(activity: Context?) {
        activityPasskey = activity?.let { PlatformPasskey(it) }
        approve()
    }

    /**
     * Sign in (or, with [create], create an account named [name]) on a Calimero Cloud cluster with
     * the device's passkey. [cluster] is a node URL, or a cluster name the directory resolves.
     */
    fun signInCloud(
        activity: Context,
        cluster: String,
        create: Boolean,
        name: String,
    ) = attempt {
        val value = cluster.trim().trimEnd('/')
        store.setValue(KEY_CLUSTER, value)
        val nodes =
            if (value.contains("://")) {
                listOf(value)
            } else {
                CalimeroClient.connect(CalimeroConnectOptions(cluster = value, policy = CloudPolicy.production)).nodes
            }
        val s = open(dev = false, nodes)
        val passkey = PlatformPasskey(activity)
        if (create) s.signUp(passkey, name.trim()) else s.signIn(passkey)
    }

    /**
     * Sign in to a development node (`merod local`, mock attestation allowed) with a software
     * passkey kept on the device: the first time it signs up as [name], after that it signs in
     * with the same key.
     */
    fun signInDev(
        url: String,
        name: String,
    ) = attempt {
        val node = url.trim().trimEnd('/')
        store.setValue(KEY_DEV_NODE, node)
        val s = open(dev = true, listOf(node))
        val saved = devPasskey(node)
        if (saved != null) {
            s.signIn(saved)
        } else {
            val host = node.toHttpUrlOrNull()?.host
            val rpId = if (host == null || host == "10.0.2.2" || host == "127.0.0.1") "localhost" else host
            val passkey = SoftPasskey(rpId = rpId, origin = DEV_ORIGIN)
            s.signUp(passkey, name.trim().ifEmpty { "Android" })
            store.setValue(KEY_DEV_PASSKEY + node, passkey.export())
        }
        approve()
    }

    fun signOut() {
        viewModelScope.launch {
            session?.signOut()
            mirror?.cancel()
            session = null
            _backend.value = null
            _revision.value += 1
        }
    }

    /** A link the activity received: a board, the consent page coming back, or a team invitation. */
    fun handleLink(url: String) {
        DesignFormat.parseBoardLink(url)?.let { (team, board) ->
            _openBoard.value = BoardLink(team, board)
            return
        }
        viewModelScope.launch {
            if (consentReturn(url) != null) {
                session?.handle(url)
            } else {
                OrgInvitation.parse(url, DesignFormat.PACKAGE_NAME)?.let { _pendingInvitation.value = it }
            }
        }
    }

    fun boardOpened() {
        _openBoard.value = null
    }

    fun dismissInvitation() {
        _pendingInvitation.value = null
    }

    /** Join the team the pending invitation opens (`POST /invites/{token}/redeem`). Answers the org. */
    suspend fun joinInvitation(): String? {
        val invitation = _pendingInvitation.value ?: return null
        val current = _backend.value ?: error("signed out")
        val joined = current.joinNamespace(invitation.namespaceId, invitation)
        _pendingInvitation.value = null
        session?.didJoinNamespace()
        return joined.namespaceId
    }

    /** What waits for the person's decision in [org] (or their own apps). */
    suspend fun pendingApprovals(org: String? = null): PendingApprovals = (session ?: error("signed out")).client.pendingApprovals(org)

    /** The consent page's return address: what a [ConsentRequest]'s `returnTo` is. */
    val consentCallback: String get() = BuildConfig.CONSENT_CALLBACK_URL

    /** Approve [request] on the node's consent page, after [confirm] showed its code. */
    suspend fun requestConsent(
        context: Context,
        request: ConsentRequest,
        confirm: suspend (ConsentStarted) -> Boolean,
    ): ConsentStarted = (session ?: error("signed out")).requestConsent(context, request, confirm)

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
                _error.value =
                    when (e) {
                        is com.calimero.mero.tee.TeeTrustException -> "The node did not pass its attestation check."
                        is IOException -> "Can't reach the cluster. Check the address and your connection."
                        else -> DesignFormat.errorText(e)
                    }
            } finally {
                _busy.value = false
            }
        }
    }

    /** A [MeroAppSession] on [nodes] (first, then the rest on `421`), its backend mirrored here. */
    private fun open(
        dev: Boolean,
        nodes: List<String>,
    ): MeroAppSession {
        store.setValue(KEY_MODE, if (dev) MODE_DEV else MODE_CLOUD)
        store.setValue(KEY_NODES, nodes.joinToString(" "))
        val client =
            CalimeroClient(
                CalimeroClientOptions(
                    baseUrl = nodes.first(),
                    nodes = nodes.drop(1),
                    policy = if (dev) CloudPolicy.development else CloudPolicy.production,
                ),
            )
        val s = MeroAppSession(client, DesignFormat.PACKAGE_NAME, BuildConfig.CONSENT_CALLBACK_URL, store, scope = viewModelScope)
        session = s
        devNode = if (dev) nodes.first() else null
        approve()
        mirror?.cancel()
        mirror =
            viewModelScope.launch {
                launch { s.backend.collect { _backend.value = it } }
                launch { s.revision.collect { _revision.value += 1 } }
            }
        return s
    }

    private fun devPasskey(node: String): PasskeyProvider? =
        store.value(KEY_DEV_PASSKEY + node)?.let { runCatching { SoftPasskey.restore(it) }.getOrNull() }

    /** Hand the session the passkey that approves its step-ups: the dev node's, else the Activity's. */
    private fun approve() {
        session?.passkey = devNode?.let(::devPasskey) ?: activityPasskey
    }

    companion object {
        /** The origin `merod local` allows (`--origins`); a software passkey's client data claims it. */
        const val DEV_ORIGIN = "http://localhost:3000"
        private const val MODE_CLOUD = "cloud"
        private const val MODE_DEV = "dev"
        private const val KEY_MODE = "mode"
        private const val KEY_NODES = "nodes"
        private const val KEY_CLUSTER = "cluster"
        private const val KEY_DEV_NODE = "devNode"
        private const val KEY_DEV_PASSKEY = "devPasskey:"
    }
}
