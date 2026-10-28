package network.calimero.blocks

import android.content.Intent
import android.content.pm.ActivityInfo
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import network.calimero.blocks.app.BlocksAppViewModel
import network.calimero.blocks.ui.MeroBlocksApp

/**
 * The one activity. Links arrive here, on the launch intent (cold start) or through [onNewIntent],
 * and go to [BlocksAppViewModel.handleLink]: the wallet's sign-in redirect, or a world invitation
 * (`https://links.calimero.network/com.calimero.mero-blocks/join?invitation=…`). The manifest keeps
 * the activity across rotation, so switching the game to landscape does not restart it.
 */
class MainActivity : ComponentActivity() {
    private val vm: BlocksAppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // The shell is portrait on a phone; the game switches to landscape while it is up.
        if (resources.configuration.smallestScreenWidthDp < TABLET_DP) {
            requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        }
        if (savedInstanceState == null) consume(intent)
        setContent {
            MeroBlocksApp(vm = vm, onSignIn = { vm.signIn(this) }, onShare = ::share)
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
                putExtra(Intent.EXTRA_SUBJECT, "Build with me in Mero Blocks")
                putExtra(Intent.EXTRA_TEXT, link)
            }
        startActivity(Intent.createChooser(send, "Invite friends"))
    }
}

private const val TABLET_DP = 600
