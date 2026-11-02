package network.calimero.models.app

import android.app.Application
import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
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
import com.calimero.mero.consentReturn
import com.calimero.mero.storage.EncryptedSessionStore
import com.calimero.mero.storage.MemorySessionStore
import com.calimero.mero.storage.SessionStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import network.calimero.models.BuildConfig
import network.calimero.models.core.ApprovalsModel
import network.calimero.models.core.BlobLoading
import network.calimero.models.core.ClusterTarget
import network.calimero.models.core.InvitationModel
import network.calimero.models.core.ModelsFormat
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.io.IOException
import java.lang.ref.WeakReference

/** A scene to open once the signed-in screens are up. */
data class SceneLink(
    val studioId: String,
    val contextId: String,
)

/** How the app signs in. (Swift: the sign-in screen's two tabs.) */
enum class SignInMode {
    /** A Calimero Cloud cluster: real TDX attestation, the device's passkey. */
    CLOUD,

    /** A `merod local` node: mock attestation trusted, a software passkey kept on the device. */
    DEV,
}

/**
 * The app's session, kept across configuration changes: a [MeroAppSession] on the cluster the
 * person chose (by name, through the node directory, or by a node's URL) or on a development node,
 * invitations and links. Screens build their models from [backend].
 *
 * The node the session lives on is kept beside it ([SessionStore]), so a relaunch restores it
 * without asking the directory again.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@Suppress("TooManyFunctions")
class ModelsAppViewModel(
    app: Application,
) : AndroidViewModel(app) {
    private val store: SessionStore =
        runCatching<SessionStore> { EncryptedSessionStore(app, "calimero_session_${ModelsFormat.PACKAGE_NAME}") }
            .getOrElse { MemorySessionStore() }

    var mode by mutableStateOf(store.value(KEY_MODE)?.let { runCatching { SignInMode.valueOf(it) }.getOrNull() } ?: SignInMode.CLOUD)
        private set

    /** What the Calimero Cloud field holds: a cluster name or a node address. */
    var cluster by mutableStateOf(store.value(KEY_CLUSTER) ?: BuildConfig.CLUSTER)

    /** The development node's URL. */
    var devNode by mutableStateOf(store.value(KEY_DEV_NODE) ?: DEFAULT_DEV_NODE)

    var busy by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set

    private val _session = MutableStateFlow<MeroAppSession?>(null)

    /** The session on the chosen cluster; null before one is chosen. */
    val session: StateFlow<MeroAppSession?> = _session.asStateFlow()

    /** The signed-in account's backend, or null. */
    val backend: StateFlow<MeroAppBackend?> =
        _session
            .flatMapLatest { it?.backend ?: flowOf(null) }
            .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    /** Bumped whenever the session's backend is rebuilt, so screens re-read. */
    val revision: StateFlow<Int> =
        _session
            .flatMapLatest { it?.revision ?: flowOf(0) }
            .stateIn(viewModelScope, SharingStarted.Eagerly, 0)

    private val _restored = MutableStateFlow(false)
    val restored: StateFlow<Boolean> = _restored.asStateFlow()

    /** An invitation being confirmed or redeemed. */
    val invitation = InvitationModel()

    /** A scene a redeemed invitation asked to open. */
    private val _openScene = MutableStateFlow<SceneLink?>(null)
    val openScene: StateFlow<SceneLink?> = _openScene.asStateFlow()

    /** Mesh and texture bytes: blobs of the scene's app instance (`GET /apps/{app}/blobs/{blob}`). */
    val blobs =
        BlobLoading { id, contextId ->
            val backend = backend.value ?: throw IOException("Not signed in")
            backend.getBlob(id, contextId)
        }

    /** The Activity on screen: the passkey sheet and the consent page's Custom Tab need it. */
    private var activity: WeakReference<Context>? = null

    /** What waits for this account's approval; consent pages open from the Activity on screen. */
    val approvals =
        ApprovalsModel(
            load = { org ->
                val client = _session.value?.client ?: throw IOException("Not signed in")
                client.pendingApprovals(org)
            },
            consent = { build, confirm ->
                val session = _session.value ?: throw IOException("Not signed in")
                val context = activity?.get() ?: throw IOException("The app is not on screen")
                val started = session.requestConsent(context, build(CONSENT_CALLBACK), confirm)
                // The page sends the person back to CONSENT_CALLBACK ([handleLink]); ask the node meanwhile.
                session.consentResult.value?.takeIf { it.requestId == started.requestId }
                    ?: runCatching { session.client.consentResult(started.requestId) }.getOrNull()
            },
        )

    init {
        viewModelScope.launch {
            try {
                val node = store.value(KEY_NODE)
                if (store.load() != null && node != null) open(mode, client(mode, node, nodes())).restore()
            } finally {
                _restored.value = true
            }
        }
    }

    /**
     * The Activity on screen, or null once it is gone. Its passkey approves the account's step-ups
     * (inviting, member changes) on a real cluster; it is held only while it lives.
     */
    fun attach(activity: Context?) {
        this.activity = activity?.let(::WeakReference)
        approve()
    }

    private fun approve() {
        _session.value?.passkey = devPasskey(devNode) ?: activity?.get()?.let(::PlatformPasskey)
    }

    fun selectMode(next: SignInMode) {
        mode = next
        error = null
    }

    /** Sign in (or, with [create], sign up as [name]) on the Calimero Cloud cluster [cluster] names. */
    fun signInCloud(
        activity: Context,
        create: Boolean,
        name: String = "",
    ) = attempt {
        val target = ClusterTarget.parse(cluster) ?: throw IllegalArgumentException("Enter the cluster's name or a node address.")
        store.setValue(KEY_CLUSTER, cluster.trim())
        val client =
            when (target) {
                is ClusterTarget.Url -> client(SignInMode.CLOUD, target.url, emptyList())
                is ClusterTarget.Name ->
                    CalimeroClient.connect(
                        CalimeroConnectOptions(cluster = target.name, policy = CloudPolicy.production, httpClient = http),
                    )
            }
        val s = open(SignInMode.CLOUD, client)
        if (create) s.signUp(PlatformPasskey(activity), name) else s.signIn(PlatformPasskey(activity))
    }

    /**
     * Sign in to a development node (`merod local`) with a software passkey kept on the device: the
     * first time it signs up as [name], after that it signs in with the same key.
     */
    fun signInDev(name: String) =
        attempt {
            val url = (ClusterTarget.parse(devNode) as? ClusterTarget.Url)?.url ?: throw IllegalArgumentException("Enter the node's URL.")
            store.setValue(KEY_DEV_NODE, url)
            val s = open(SignInMode.DEV, client(SignInMode.DEV, url, emptyList()))
            val saved = devPasskey(url)
            if (saved != null) {
                s.signIn(saved)
            } else {
                val passkey = SoftPasskey(rpId = url.toHttpUrlOrNull()?.host?.let(::devRpId) ?: "localhost", origin = DEV_ORIGIN)
                s.signUp(passkey, name.ifBlank { "Developer" })
                store.setValue(KEY_DEV_PASSKEY + url, passkey.export())
            }
            approve()
        }

    /** A link the app received: the consent page coming back, or an invitation. */
    fun handleLink(url: String) {
        if (consentReturn(url) == null && MeroAppSession.isInvitationLink(url, ModelsFormat.PACKAGE_NAME)) {
            invitation.open(url)
            return
        }
        viewModelScope.launch { _session.value?.handle(url) }
    }

    /** Read a pasted link. */
    fun openInvitation(raw: String) {
        invitation.open(raw)
    }

    fun acceptInvitation() {
        viewModelScope.launch {
            invitation.accept(backend = { backend.value }, didJoin = { _session.value?.didJoinNamespace() })
        }
    }

    fun open(link: SceneLink) {
        _openScene.value = link
    }

    fun sceneOpened() {
        _openScene.value = null
    }

    fun signOut() {
        viewModelScope.launch { _session.value?.signOut() }
    }

    /** Where the signed-in account lives, for the account sheet. */
    val nodeUrl: String? get() = store.value(KEY_NODE)

    private fun nodes(): List<String> =
        store
            .value(KEY_NODES)
            ?.split(',')
            ?.filter { it.isNotBlank() }
            .orEmpty()

    private fun devPasskey(url: String): PasskeyProvider? =
        if (mode == SignInMode.DEV) store.value(KEY_DEV_PASSKEY + url)?.let { runCatching { SoftPasskey.restore(it) }.getOrNull() } else null

    private fun client(
        mode: SignInMode,
        url: String,
        nodes: List<String>,
    ): CalimeroClient =
        CalimeroClient(
            CalimeroClientOptions(
                baseUrl = url,
                nodes = nodes,
                policy = if (mode == SignInMode.DEV) CloudPolicy.development else CloudPolicy.production,
                httpClient = http,
            ),
        )

    /** A [MeroAppSession] over [client], remembered (mode and nodes) for the next launch. */
    private fun open(
        newMode: SignInMode,
        client: CalimeroClient,
    ): MeroAppSession {
        mode = newMode
        store.setValue(KEY_MODE, newMode.name)
        store.setValue(KEY_NODE, client.nodes.firstOrNull().orEmpty())
        store.setValue(KEY_NODES, client.nodes.drop(1).joinToString(","))
        val s = MeroAppSession(client, ModelsFormat.PACKAGE_NAME, CONSENT_CALLBACK, store, scope = viewModelScope)
        _session.value = s
        approve()
        return s
    }

    private fun attempt(block: suspend () -> Unit) {
        error = null
        busy = true
        viewModelScope.launch {
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: IllegalArgumentException) {
                error = e.message
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                error = ModelsFormat.errorText(e)
            } finally {
                busy = false
            }
        }
    }

    companion object {
        /** Where the consent page sends the person back; the manifest's intent filter matches it. */
        const val CONSENT_CALLBACK = "mero-models://consent"

        /** The origin `merod local` allows (`--origins`); a software passkey's client data claims it. */
        const val DEV_ORIGIN = "http://localhost:3000"

        /** `merod local` from the emulator. */
        const val DEFAULT_DEV_NODE = "http://10.0.2.2:2501"

        private const val KEY_MODE = "models.mode"
        private const val KEY_CLUSTER = "models.cluster"
        private const val KEY_DEV_NODE = "models.devNode"
        private const val KEY_NODE = "models.node"
        private const val KEY_NODES = "models.nodes"
        private const val KEY_DEV_PASSKEY = "models.devPasskey:"

        private val http by lazy { CalimeroClientOptions.defaultHttpClient() }

        /** The emulator reaches the host as 10.0.2.2, but `merod local`'s relying party is `localhost`. */
        private fun devRpId(host: String): String = if (host == "10.0.2.2" || host == "127.0.0.1") "localhost" else host
    }
}
