package network.calimero.sign

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
import com.calimero.mero.ConsentResult
import com.calimero.mero.PasskeyProvider
import com.calimero.mero.SoftPasskey
import com.calimero.mero.app.MeroAppBackend
import com.calimero.mero.app.SignedOutException
import com.calimero.mero.compose.ConsentLauncher
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
import network.calimero.sign.core.AgreementDirectory
import network.calimero.sign.core.AgreementModel
import network.calimero.sign.core.AgreementRef
import network.calimero.sign.core.AgreementsModel
import network.calimero.sign.core.ApprovalsModel
import network.calimero.sign.core.ClientSignAdmin
import network.calimero.sign.core.DocumentModel
import network.calimero.sign.core.InboxModel
import network.calimero.sign.core.InvitationModel
import network.calimero.sign.core.NameDirectory
import network.calimero.sign.core.PdfStamping
import network.calimero.sign.core.PrivateContextCache
import network.calimero.sign.core.PrivateStore
import network.calimero.sign.core.SignConstants
import network.calimero.sign.core.SignErrorText
import network.calimero.sign.core.SignInvitation
import network.calimero.sign.core.SignaturesModel
import network.calimero.sign.pdf.PdfBoxStamper
import network.calimero.sign.ui.SignApp
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * The one activity. Links arrive here, on the launch intent or through [onNewIntent]: the node's
 * consent page coming back, or an invitation. While it lives, its passkey (Credential Manager)
 * approves the account's step-ups, so it is attached in [onCreate] and detached in [onDestroy].
 */
class MainActivity : ComponentActivity() {
    private val vm: SignViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        vm.attach(this)
        if (savedInstanceState == null) consume(intent)
        setContent {
            SignApp(vm = vm, onSignIn = { cluster, create, name -> vm.signInCloud(this, cluster, create, name) })
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
        intent.data = null
    }
}

/** How the app reaches Calimero 1.0. */
enum class SignInMode {
    /** A Calimero Cloud cluster (by name, or a node URL): real TDX quotes, the device's passkey. */
    CLOUD,

    /** `merod local`: mock attestation allowed, a software passkey kept on the device. */
    DEV,
}

/**
 * The session on the cluster the person chose at sign-in (a Calimero Cloud cluster by name or node
 * URL, or a development node), the invitation being redeemed, and the stamper, for the app's life.
 * The chosen target is kept beside the encrypted session, so a relaunch restores it.
 */
@Suppress("TooManyFunctions")
class SignViewModel(
    app: Application,
) : AndroidViewModel(app) {
    private val store: SessionStore =
        runCatching<SessionStore> { EncryptedSessionStore(app, "calimero_session_${SignConstants.PACKAGE_NAME}") }
            .getOrElse { MemorySessionStore() }

    val invitation = InvitationModel()
    val stamper: PdfStamping by lazy { PdfBoxStamper(app) }
    val cache: PrivateContextCache = PrefsPrivateContextCache(app)

    /** The session on the chosen cluster; null while signed out. */
    var session: MeroAppSession? = null
        private set

    private val _backend = MutableStateFlow<MeroAppBackend?>(null)
    val backend: StateFlow<MeroAppBackend?> = _backend.asStateFlow()

    private val _revision = MutableStateFlow(0)

    /** Bumped whenever the session changes or a workspace was joined: screens re-read. */
    val revision: StateFlow<Int> = _revision.asStateFlow()

    private val _restoring = MutableStateFlow(true)
    val restoring: StateFlow<Boolean> = _restoring.asStateFlow()

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    private var activityPasskey: PasskeyProvider? = null
    private var activity: Context? = null
    private var mirror: Job? = null

    private val mode: SignInMode
        get() = store.value(KEY_MODE)?.let { runCatching { SignInMode.valueOf(it) }.getOrNull() } ?: SignInMode.CLOUD

    /** The cluster to prefill: `meroCluster` from Gradle, else the last one used. */
    val savedCluster: String get() = store.value(KEY_TARGET)?.takeIf { mode == SignInMode.CLOUD } ?: BuildConfig.CLUSTER

    /** The development node to prefill. */
    val savedDevNode: String get() = store.value(KEY_TARGET)?.takeIf { mode == SignInMode.DEV } ?: BuildConfig.DEV_NODE_URL

    val account: String? get() = session?.account

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
                _error.value = SignErrorText.describe(e)
            } finally {
                _restoring.value = false
            }
        }
    }

    /** The Activity on screen, or null once it is gone: its passkey approves the account's step-ups. */
    fun attach(activity: Context?) {
        this.activity = activity
        activityPasskey = activity?.let { PlatformPasskey(it) }
        approve()
    }

    /** Sign in (or, with [create], create an account named [name]) on a Calimero Cloud cluster (name or node URL). */
    fun signInCloud(
        activity: Context,
        target: String,
        create: Boolean,
        name: String,
    ) = attemptSignIn {
        val s = connect(SignInMode.CLOUD, target.trim())
        if (create) s.signUp(PlatformPasskey(activity), name.trim()) else s.signIn(PlatformPasskey(activity))
    }

    /** Sign in to a development node (`merod local`) with a software passkey kept on the device. */
    fun signInDev(
        url: String,
        name: String,
    ) = attemptSignIn {
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

    fun signOut() =
        viewModelScope.launch {
            session?.signOut()
            mirror?.cancel()
            session = null
            _backend.value = null
            _revision.value += 1
        }

    /** A link the app received: the consent page coming back, or an invitation. */
    fun handleLink(url: String) {
        if (consentReturn(url) != null) {
            viewModelScope.launch { session?.handle(url) }
            return
        }
        if (SignInvitation.parse(url) != null) invitation.open(url)
    }

    /** A workspace was joined: re-read what the account sees. */
    suspend fun didJoin() {
        _revision.value += 1
    }

    /** What waits for approval, read from the node, each decision on the node's consent page. */
    fun approvals(): ApprovalsModel =
        ApprovalsModel(
            load = { org -> session?.client?.pendingApprovals(org) ?: throw SignedOutException("pendingApprovals") },
            consent = { build, confirm ->
                val s = session
                val context = activity
                if (s == null || context == null) {
                    null
                } else {
                    val started = ConsentLauncher.request(context, s.client, build(BuildConfig.CONSENT_CALLBACK_URL), confirm)
                    s.consentResult.value?.takeIf { it.requestId == started.requestId }
                        ?: runCatching<ConsentResult> { s.client.consentResult(started.requestId) }.getOrNull()
                }
            },
        )

    /** A directory over whatever backend the session has now (for the invitation flow). */
    fun directory(): AgreementDirectory? {
        val backend = _backend.value ?: return null
        val admin = ClientSignAdmin(backend, session?.client)
        return AgreementDirectory(backend, admin, PrivateStore(backend, admin, cache))
    }

    private fun devPasskey(url: String): PasskeyProvider? =
        store.value(KEY_DEV_PASSKEY + url)?.let { runCatching { SoftPasskey.restore(it) }.getOrNull() }

    private fun approve() {
        val target = store.value(KEY_TARGET).orEmpty()
        session?.passkey = (if (mode == SignInMode.DEV) devPasskey(target) else null) ?: activityPasskey
    }

    private fun attemptSignIn(block: suspend () -> Unit) {
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
                _error.value = SignErrorText.describe(e)
            } finally {
                _busy.value = false
            }
        }
    }

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
        val s = MeroAppSession(client, SignConstants.PACKAGE_NAME, BuildConfig.CONSENT_CALLBACK_URL, store, scope = viewModelScope)
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

    companion object {
        /** The origin `merod local` allows (`--origins`); a software passkey's client data claims it. */
        const val DEV_ORIGIN = "http://localhost:3000"
        private const val KEY_MODE = "sign.mode"
        private const val KEY_TARGET = "sign.target"
        private const val KEY_DEV_PASSKEY = "sign.devPasskey:"

        /** Whether [value] names a node (`https://…`, or a host with a dot or port) rather than a cluster. */
        fun isNodeUrl(value: String): Boolean = "://" in value || '.' in value || ':' in value

        private fun devRpId(host: String): String = if (host == "10.0.2.2" || host == "127.0.0.1") "localhost" else host
    }
}

/** Everything a signed-in screen needs, rebuilt when the session changes. (iOS `AppServices`.) */
class Services(
    val backend: MeroAppBackend,
    vm: SignViewModel,
) {
    val admin = ClientSignAdmin(backend, vm.session?.client)
    val store = PrivateStore(backend, admin, vm.cache)
    val directory = AgreementDirectory(backend, admin, store)
    val approvals = vm.approvals()
    val names = NameDirectory(admin)
    val inbox = InboxModel(directory)
    val agreements = AgreementsModel(directory)
    val signatures = SignaturesModel(store)
    private val stamper = vm.stamper

    /** What waits for approval in the account and in each of its workspaces. */
    suspend fun refreshApprovals() {
        approvals.refresh(runCatching { backend.listNamespaces().map { it.id } }.getOrDefault(emptyList()))
    }

    private val agreementModels = mutableMapOf<String, AgreementModel>()
    private val documentModels = mutableMapOf<String, DocumentModel>()

    fun agreement(ref: AgreementRef): AgreementModel = agreementModels.getOrPut(ref.contextId) { AgreementModel(directory, names, ref) }

    fun document(
        ref: AgreementRef,
        documentId: String,
    ): DocumentModel =
        documentModels.getOrPut("${ref.contextId}/$documentId") {
            DocumentModel(
                directory,
                names,
                ref,
                documentId,
                stamper,
                inbox.entries.value.firstOrNull { it.agreement.contextId == ref.contextId && it.document.id == documentId },
            )
        }

    fun forget(
        ref: AgreementRef,
        documentId: String,
    ) {
        documentModels.remove("${ref.contextId}/$documentId")
    }
}

/** [PrivateContextCache] in SharedPreferences. */
class PrefsPrivateContextCache(
    context: Context,
) : PrivateContextCache {
    private val prefs = context.getSharedPreferences("sign", Context.MODE_PRIVATE)

    override fun load(account: String): String? = prefs.getString("privateContext.$account", null)

    override fun save(
        contextId: String?,
        account: String,
    ) = prefs.edit().putString("privateContext.$account", contextId).apply()
}
