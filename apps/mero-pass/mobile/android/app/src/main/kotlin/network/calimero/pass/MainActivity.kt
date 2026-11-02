package network.calimero.pass

import android.app.Application
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.WindowManager
import androidx.activity.compose.setContent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModelProvider
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
import network.calimero.pass.core.DeviceKeeper
import network.calimero.pass.core.InvitationModel
import network.calimero.pass.core.KeystoreDeviceKeyStore
import network.calimero.pass.core.PassConstants
import network.calimero.pass.core.PassErrorText
import network.calimero.pass.core.PassInvitation
import network.calimero.pass.core.SharedPassPreferences
import network.calimero.pass.ui.AppServices
import network.calimero.pass.ui.PassApp
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.io.IOException

/**
 * The one activity. Links arrive here, on the launch intent (cold start) or through [onNewIntent],
 * and go to [PassViewModel.handleLink]: the node's consent page sending the person back
 * (`mero-pass://consent?request_id=…`), or an invitation
 * (`https://links.calimero.network/com.calimero.mero-pass/join?invitation=…`).
 *
 * A [FragmentActivity], for BiometricPrompt. FLAG_SECURE keeps secrets out of screenshots and the
 * recents thumbnail; the vault keys leave memory after the chosen time away ([onStart]).
 */
class MainActivity : FragmentActivity() {
    private val vm: PassViewModel by lazy { ViewModelProvider(this)[PassViewModel::class.java] }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        // The passkey sheet needs this Activity: it approves the account's step-ups (invites,
        // member changes) while the app is on screen.
        vm.attach(this)
        if (savedInstanceState == null) consume(intent)
        setContent { PassApp(vm = vm, activity = this) }
    }

    override fun onDestroy() {
        vm.attach(null)
        super.onDestroy()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        consume(intent)
    }

    override fun onStop() {
        super.onStop()
        if (!isChangingConfigurations) vm.wentAway()
    }

    override fun onStart() {
        super.onStart()
        vm.cameBack()
    }

    private fun consume(intent: Intent?) {
        val url = intent?.data?.toString() ?: return
        vm.handleLink(url)
        // Handled once: a configuration change must not replay it.
        intent.data = null
    }
}

/** How the app is signed in. */
enum class SignInMode {
    /** A Calimero Cloud cluster: real TDX quotes from a signed mero-tee release, the device's passkey. */
    CLOUD,

    /** `merod local`: mock attestation allowed, a software passkey kept on the device. */
    DEV,
}

/**
 * The session, the device key, the invitation being redeemed, and the shared services, for the
 * app's life. The session is a [MeroAppSession] on the cluster the person chose (by name, through
 * the Calimero Cloud directory, or by a node's URL), or on a `merod local` node; which one is kept
 * beside the session ([SessionStore]) so a relaunch restores it.
 */
@Suppress("TooManyFunctions")
class PassViewModel(
    app: Application,
) : AndroidViewModel(app) {
    private val store: SessionStore =
        runCatching<SessionStore> { EncryptedSessionStore(app, "calimero_session_${PassConstants.PACKAGE_NAME}") }
            .getOrElse { MemorySessionStore() }

    val keeper = DeviceKeeper(KeystoreDeviceKeyStore(app))
    val preferences = SharedPassPreferences(app)
    val invitation = InvitationModel()
    val services = AppServices(app, deviceLabel())

    private var awaySince: Long? = null

    /** The session; null while signed out. */
    var session by mutableStateOf<MeroAppSession?>(null)
        private set

    private val _backend = MutableStateFlow<MeroAppBackend?>(null)

    /** What the screens run on: the session's backend, null while signed out. */
    val backend: StateFlow<MeroAppBackend?> = _backend.asStateFlow()

    private val _revision = MutableStateFlow(0)

    /** Bumped whenever the account changes or joins something: screens re-read. */
    val revision: StateFlow<Int> = _revision.asStateFlow()

    var restoring by mutableStateOf(true)
        private set
    var busy by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set

    /** The cluster (name or node URL) or development node last used. */
    var target by mutableStateOf(store.value(KEY_TARGET).orEmpty())
        private set
    var mode by mutableStateOf(store.value(KEY_MODE)?.let { runCatching { SignInMode.valueOf(it) }.getOrNull() } ?: SignInMode.CLOUD)
        private set

    val account: String? get() = session?.account

    private var activityPasskey: PasskeyProvider? = null
    private var mirror: Job? = null

    init {
        viewModelScope.launch {
            try {
                if (store.load() != null && target.isNotEmpty()) open(mode, target).restore()
            } catch (e: CancellationException) {
                throw e
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                error = PassErrorText.describe(e)
            } finally {
                restoring = false
            }
        }
    }

    /** The Activity on screen (null once it is gone): its passkey approves the account's step-ups. */
    fun attach(activity: Context?) {
        activityPasskey = activity?.let { PlatformPasskey(it) }
        approve()
    }

    /** A Calimero Cloud cluster, by name or a node's URL: sign in, or (with [create]) sign up as [name]. */
    fun signInCloud(
        activity: Context,
        cluster: String,
        create: Boolean,
        name: String,
    ) = attempt {
        val s = open(SignInMode.CLOUD, cluster)
        if (create) s.signUp(PlatformPasskey(activity), name.trim()) else s.signIn(PlatformPasskey(activity))
    }

    /**
     * A `merod local` node, with a software passkey kept on the device: the first time it signs up
     * as [name], after that it signs in with the same key.
     */
    fun signInDev(
        url: String,
        name: String,
    ) = attempt {
        val node = url.trim().trimEnd('/')
        val s = open(SignInMode.DEV, node)
        val saved = devPasskey(node)
        if (saved != null) {
            s.signIn(saved)
        } else {
            val passkey = SoftPasskey(rpId = node.toHttpUrlOrNull()?.host?.let(::devRpId) ?: "localhost", origin = DEV_ORIGIN)
            s.signUp(passkey, name.trim().ifEmpty { "android" })
            store.setValue(KEY_DEV_PASSKEY + node, passkey.export())
        }
        approve()
    }

    fun signOut() =
        viewModelScope.launch {
            session?.signOut()
            session = null
            mirror?.cancel()
            _backend.value = null
            _revision.value += 1
        }

    /** Every link the activity receives: the consent page coming back, or an invitation. */
    fun handleLink(url: String) =
        viewModelScope.launch {
            if (session?.handle(url) == true) {
                session?.pendingInvitation?.value?.let { invitation.open(it) }
                session?.dismissPendingInvitation()
                return@launch
            }
            if (PassInvitation.parse(url) != null) invitation.open(url)
        }

    /** After redeeming an invitation: re-read what the account sees. */
    suspend fun didJoin() {
        session?.didJoinNamespace()
        _revision.value += 1
    }

    /** What waits for the person's decision in [org] (or their own apps). */
    suspend fun pendingApprovals(org: String? = null): PendingApprovals =
        (session ?: throw SignedOutException("pendingApprovals")).client.pendingApprovals(org)

    /** Open the node's consent page for [request]; [confirm] shows its confirmation code first. */
    suspend fun requestConsent(
        context: Context,
        request: ConsentRequest,
        confirm: suspend (ConsentStarted) -> Boolean,
    ): ConsentStarted = (session ?: throw SignedOutException("requestConsent")).requestConsent(context, request, confirm)

    private fun devPasskey(node: String): SoftPasskey? =
        store.value(KEY_DEV_PASSKEY + node)?.let { runCatching { SoftPasskey.restore(it) }.getOrNull() }

    /** Hand the session the passkey that approves its step-ups. */
    private fun approve() {
        val s = session ?: return
        s.passkey = if (mode == SignInMode.DEV) devPasskey(target) ?: activityPasskey else activityPasskey
    }

    private fun attempt(block: suspend () -> Unit) {
        error = null
        busy = true
        viewModelScope.launch {
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: IOException) {
                error = if (mode == SignInMode.DEV) "Can't reach $target. Is the node running?" else PassErrorText.describe(e)
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                error = PassErrorText.describe(e)
            } finally {
                busy = false
            }
        }
    }

    /**
     * A [MeroAppSession] on [value] under [newMode]'s policy: a node URL directly, a cluster name
     * through the Calimero Cloud directory. Its backend is mirrored into [backend].
     */
    private suspend fun open(
        newMode: SignInMode,
        value: String,
    ): MeroAppSession {
        val trimmed = value.trim().trimEnd('/')
        mode = newMode
        target = trimmed
        store.setValue(KEY_MODE, newMode.name)
        store.setValue(KEY_TARGET, trimmed)
        val policy = if (newMode == SignInMode.DEV) CloudPolicy.development else CloudPolicy.production
        val client =
            if (newMode == SignInMode.DEV || isNodeUrl(trimmed)) {
                CalimeroClient(CalimeroClientOptions(baseUrl = trimmed, policy = policy))
            } else {
                CalimeroClient.connect(CalimeroConnectOptions(cluster = trimmed, policy = policy))
            }
        val s = MeroAppSession(client, PassConstants.PACKAGE_NAME, BuildConfig.CONSENT_CALLBACK_URL, store, scope = viewModelScope)
        session = s
        approve()
        mirror?.cancel()
        mirror =
            viewModelScope.launch {
                s.backend.collect {
                    _backend.value = it
                    _revision.value += 1
                }
            }
        return s
    }

    fun wentAway() {
        awaySince = SystemClock.elapsedRealtime()
    }

    /** Lock when back after the chosen time away (iOS: the scene-phase check). */
    fun cameBack() {
        val since = awaySince ?: return
        awaySince = null
        if (SystemClock.elapsedRealtime() - since >= preferences.autoLockMinutes * MINUTE_MS) keeper.lock()
    }

    companion object {
        /** The origin `merod local` allows (`--origins`); a software passkey's client data claims it. */
        const val DEV_ORIGIN = "http://localhost:3000"
        private const val KEY_MODE = "mode"
        private const val KEY_TARGET = "target"
        private const val KEY_DEV_PASSKEY = "devPasskey:"

        const val MINUTE_MS = 60_000L

        fun deviceLabel(): String = Build.MODEL?.takeIf { it.isNotBlank() } ?: "Android phone"

        /** Whether [value] names a node by URL rather than a cluster by name. */
        fun isNodeUrl(value: String): Boolean = "://" in value || '.' in value || ':' in value

        /** The emulator reaches the host as 10.0.2.2, but `merod local`'s relying party is `localhost`. */
        private fun devRpId(host: String): String = if (host == "10.0.2.2" || host == "127.0.0.1") "localhost" else host
    }
}
