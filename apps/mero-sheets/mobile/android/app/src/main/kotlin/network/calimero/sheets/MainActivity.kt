package network.calimero.sheets

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import network.calimero.sheets.app.SheetsAppViewModel
import network.calimero.sheets.ui.MeroSheetsApp

/**
 * The one activity. Links arrive here, on the launch intent (cold start) or through
 * [onNewIntent], and go to the view model: the node's consent page coming back
 * (`mero-sheets://consent?request_id=…`), or a workspace invitation
 * (`https://links.calimero.network/com.calimero.mero-sheets/join?invitation=…`). While it is on
 * screen, its passkey approves the account's step-ups (inviting someone).
 */
class MainActivity : ComponentActivity() {
    private val vm: SheetsAppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        vm.attach(this)
        if (savedInstanceState == null) consume(intent)
        setContent {
            MeroSheetsApp(vm = vm, onShare = ::share)
        }
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

    /** Hand an invitation link to the system share sheet. */
    private fun share(text: String) {
        val send =
            Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, text)
            }
        startActivity(Intent.createChooser(send, "Share invite link"))
    }
}
