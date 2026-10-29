package network.calimero.pass

import android.app.Application
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.WindowManager
import androidx.activity.compose.setContent
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.calimero.mero.account.Enrolment
import com.calimero.mero.compose.MeroAppConfig
import com.calimero.mero.compose.MeroAppSession
import kotlinx.coroutines.launch
import network.calimero.pass.core.DeviceKeeper
import network.calimero.pass.core.InvitationModel
import network.calimero.pass.core.KeystoreDeviceKeyStore
import network.calimero.pass.core.PassConstants
import network.calimero.pass.core.SharedPassPreferences
import network.calimero.pass.ui.AppServices
import network.calimero.pass.ui.PassApp

/**
 * The one activity. Links arrive here, on the launch intent (cold start) or through [onNewIntent],
 * and go to [PassViewModel.handleLink]: the wallet's sign-in redirect, or an invitation
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
        if (savedInstanceState == null) consume(intent)
        setContent { PassApp(vm = vm, activity = this, onSignIn = { vm.session.signIn(this) }) }
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

/** The session, the device key, the invitation being redeemed, and the shared services, for the app's life. */
class PassViewModel(
    app: Application,
) : AndroidViewModel(app) {
    val session: MeroAppSession =
        MeroAppSession.create(
            app,
            packageName = PassConstants.PACKAGE_NAME,
            callbackUrl = BuildConfig.ENROL_CALLBACK_URL,
            config =
                MeroAppConfig(
                    registryUrl = BuildConfig.REGISTRY_URL.ifBlank { null },
                    cloudBaseUrl = BuildConfig.CLOUD_BASE_URL.ifBlank { MeroAppConfig().cloudBaseUrl },
                ),
            walletUrl = BuildConfig.WALLET_URL.ifBlank { Enrolment.DEFAULT_WALLET_URL },
            scope = viewModelScope,
        )
    val keeper = DeviceKeeper(KeystoreDeviceKeyStore(app))
    val preferences = SharedPassPreferences(app)
    val invitation = InvitationModel()
    val services = AppServices(app, deviceLabel())

    private var awaySince: Long? = null

    init {
        viewModelScope.launch { session.restore() }
    }

    /** Every link the activity receives. */
    fun handleLink(url: String) =
        viewModelScope.launch {
            session.handle(url)
            session.pendingInvitation.value?.let {
                invitation.open(it)
                session.dismissPendingInvitation()
            }
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

    private companion object {
        const val MINUTE_MS = 60_000L

        fun deviceLabel(): String = Build.MODEL?.takeIf { it.isNotBlank() } ?: "Android phone"
    }
}
