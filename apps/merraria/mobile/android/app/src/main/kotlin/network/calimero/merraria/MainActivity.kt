package network.calimero.merraria

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import network.calimero.merraria.app.MerrariaAppViewModel
import network.calimero.merraria.ui.MerrariaApp

/**
 * The one activity, landscape (the manifest locks it). Links arrive here, on the launch intent (cold
 * start) or through [onNewIntent], and go to [MerrariaAppViewModel.handleLink]: the wallet's sign-in
 * redirect, or a world invitation (`https://links.calimero.network/com.calimero.merraria/join?invitation=…`).
 */
class MainActivity : ComponentActivity() {
    private val vm: MerrariaAppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) consume(intent)
        setContent {
            MerrariaApp(vm = vm, onSignIn = { vm.signIn(this) }, onShare = ::share)
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
                putExtra(Intent.EXTRA_SUBJECT, "Dig with me in Merraria")
                putExtra(Intent.EXTRA_TEXT, link)
            }
        startActivity(Intent.createChooser(send, "Invite friends"))
    }
}
