package network.calimero.design

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import network.calimero.design.app.DesignAppViewModel
import network.calimero.design.ui.MeroDesignApp

/**
 * The one activity. Links arrive here, on the launch intent (cold start) or through
 * [onNewIntent], and go to [DesignAppViewModel.handleLink]: the wallet's sign-in redirect, or a
 * board link (`https://links.calimero.network/com.calimero.mero-design/board?team=…&board=…`).
 */
class MainActivity : ComponentActivity() {
    private val vm: DesignAppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) consume(intent)
        setContent {
            MeroDesignApp(vm = vm, onSignIn = { vm.session.signIn(this) })
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
