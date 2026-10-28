package network.calimero.standup

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import network.calimero.standup.app.StandupViewModel
import network.calimero.standup.ui.Platform
import network.calimero.standup.ui.StandupApp

/**
 * The one activity. Links arrive here, on the launch intent (cold start) or through
 * [onNewIntent], and go to the session: the wallet's sign-in redirect, or a team invitation.
 */
class MainActivity : ComponentActivity() {
    private val vm: StandupViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) consume(intent)
        val platform =
            Platform(
                signIn = { vm.signIn(this) },
                share = ::share,
                copy = ::copy,
            )
        setContent { StandupApp(vm, platform) }
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

    private fun share(
        title: String,
        text: String,
    ) {
        val send =
            Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_SUBJECT, title)
                putExtra(Intent.EXTRA_TEXT, text)
            }
        startActivity(Intent.createChooser(send, title))
    }

    private fun copy(
        label: String,
        text: String,
    ) {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText(label, text))
    }
}
