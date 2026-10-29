package network.calimero.kombat

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import network.calimero.kombat.app.KombatAppViewModel
import network.calimero.kombat.ui.MeroKombatApp

/**
 * The one activity, landscape only (the manifest). Links arrive here, on the launch intent (cold
 * start) or through [onNewIntent], and go to [KombatAppViewModel.handleLink]: the wallet's sign-in
 * redirect, or an arena invitation
 * (`https://links.calimero.network/com.calimero.mero-kombat/join?invitation=…`).
 */
class MainActivity : ComponentActivity() {
    private val vm: KombatAppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // Sideways and full screen: the system bars come back with a swipe.
        WindowCompat.getInsetsController(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        if (savedInstanceState == null) consume(intent)
        setContent {
            MeroKombatApp(vm = vm, onSignIn = { vm.signIn(this) }, onShare = ::share)
        }
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

    /** Hand an invitation link to the system share sheet. */
    private fun share(link: String) {
        val send =
            Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_SUBJECT, "Fight me in Mero Kombat")
                putExtra(Intent.EXTRA_TEXT, link)
            }
        startActivity(Intent.createChooser(send, "Invite an opponent"))
    }
}
