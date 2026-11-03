package network.calimero.chess

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import network.calimero.chess.app.ChessAppViewModel
import network.calimero.chess.ui.MeroChessApp

/**
 * The one activity. Links arrive here, on the launch intent (cold start) or through [onNewIntent],
 * and go to [ChessAppViewModel.handleLink]: the node's consent page sending the person back
 * (`mero-chess://consent?request_id=…&result=…`), or a table invitation
 * (`https://links.calimero.network/com.calimero.mero-chess/join?invitation=…`).
 *
 * While it lives, its passkey (Credential Manager) approves the account's step-ups (inviting,
 * member changes): [ChessAppViewModel.attach].
 */
class MainActivity : ComponentActivity() {
    private val vm: ChessAppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        vm.attach(this)
        if (savedInstanceState == null) consume(intent)
        setContent {
            MeroChessApp(
                vm = vm,
                onCloud = { cluster, create, name -> vm.signInCloud(this, cluster, create, name) },
                onShare = ::share,
            )
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
    private fun share(link: String) {
        val send =
            Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_SUBJECT, "Play chess with me")
                putExtra(Intent.EXTRA_TEXT, link)
            }
        startActivity(Intent.createChooser(send, "Invite to table"))
    }
}
