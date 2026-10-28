package network.calimero.issues

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import network.calimero.issues.app.IssuesAppViewModel
import network.calimero.issues.ui.IssuesApp

/**
 * The one activity. Links arrive here, on the launch intent (cold start) or through
 * [onNewIntent], and go to the session: the wallet's sign-in redirect, or a workspace invitation
 * (`https://links.calimero.network/com.calimero.mero-issue-tracker/join?invitation=…`).
 */
class MainActivity : ComponentActivity() {
    private val vm: IssuesAppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) consume(intent)
        setContent {
            IssuesApp(vm = vm, onSignIn = { vm.signIn(this) }, onShare = ::share)
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
    private fun share(text: String) {
        val send =
            Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, text)
            }
        startActivity(Intent.createChooser(send, "Share invite link"))
    }
}
