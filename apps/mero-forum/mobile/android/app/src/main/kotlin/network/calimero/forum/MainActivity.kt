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
import com.calimero.mero.compose.MeroAppConfig
import com.calimero.mero.compose.MeroAppSession
import kotlinx.coroutines.launch
import network.calimero.forum.core.ForumConstants
import network.calimero.forum.core.InvitationModel
import network.calimero.forum.core.NameStore
import network.calimero.forum.ui.ForumApp

/**
 * The one activity. Links arrive here, on the launch intent (cold start) or through
 * [onNewIntent], and go to [ForumViewModel.handleLink]: the wallet's sign-in redirect, or an
 * invitation (`https://links.calimero.network/com.calimero.mero-forum/join?invitation=…`).
 */
class MainActivity : ComponentActivity() {
    private val vm: ForumViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) consume(intent)
        setContent { ForumApp(vm = vm, onSignIn = { vm.session.signIn(this) }) }
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

/** The session, the invitation being redeemed, and your name, for the app's life. */
class ForumViewModel(
    app: Application,
) : AndroidViewModel(app) {
    val session: MeroAppSession =
        MeroAppSession.create(
            app,
            packageName = ForumConstants.PACKAGE_NAME,
            callbackUrl = BuildConfig.ENROL_CALLBACK_URL,
            config =
                MeroAppConfig(
                    registryUrl = BuildConfig.REGISTRY_URL.ifBlank { null },
                    cloudBaseUrl = BuildConfig.CLOUD_BASE_URL.ifBlank { MeroAppConfig().cloudBaseUrl },
                ),
            walletUrl = BuildConfig.WALLET_URL.ifBlank { com.calimero.mero.account.Enrolment.DEFAULT_WALLET_URL },
            scope = viewModelScope,
        )
    val invitation = InvitationModel()
    val names: NameStore = PrefsNameStore(app)

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
