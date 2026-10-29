package network.calimero.pixart

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import network.calimero.pixart.app.PixartAppViewModel
import network.calimero.pixart.ui.MeroPixartApp

/**
 * The one activity. Links arrive here, on the launch intent (cold start) or through
 * [onNewIntent], and go to [PixartAppViewModel.handleLink]: the wallet's sign-in redirect, or a
 * project link (`https://links.calimero.network/com.calimero.mero-pixart/project?team=…&project=…`), or a team
 * invitation, which the session holds for the person to confirm.
 */
class MainActivity : ComponentActivity() {
    private val vm: PixartAppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) consume(intent)
        setContent {
            MeroPixartApp(vm = vm, onSignIn = { vm.session.signIn(this) })
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
}
