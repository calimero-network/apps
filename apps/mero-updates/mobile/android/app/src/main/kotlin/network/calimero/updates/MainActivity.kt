package network.calimero.updates

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import network.calimero.updates.app.UpdatesViewModel
import network.calimero.updates.ui.Platform
import network.calimero.updates.ui.UpdatesApp

/**
 * The one activity. Links arrive here, on the launch intent (cold start) or through
 * [onNewIntent], and go to the view model: an invitation, or the node's consent page sending the
 * person back (`mero-updates://consent?request_id=…`).
 *
 * While it lives, its passkey (Credential Manager) approves the account's step-ups: inviting,
 * member changes, leaving a company.
 */
class MainActivity : ComponentActivity() {
    private val vm: UpdatesViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        vm.attach(this)
        if (savedInstanceState == null) consume(intent)
        val platform =
            Platform(
                signInCloud = { cluster, create, name -> vm.signInCloud(this, cluster, create, name) },
                share = ::share,
                copy = ::copy,
            )
        setContent { UpdatesApp(vm, platform) }
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
