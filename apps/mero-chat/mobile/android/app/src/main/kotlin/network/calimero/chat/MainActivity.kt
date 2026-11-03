package network.calimero.chat

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import network.calimero.chat.app.ChatAppViewModel
import network.calimero.chat.ui.MeroChatApp

/**
 * The one activity. Links arrive here — on the launch intent (cold start) or through
 * [onNewIntent] — and go to [ChatAppViewModel.handleLink]: the node's consent page coming back
 * (`mero-chat://consent?request_id=…&result=…`), or a workspace invitation
 * (`https://links.calimero.network/com.calimero.chat/join?invitation=…`).
 *
 * The activity hands itself to the view model while it lives ([ChatAppViewModel.attach]): its
 * passkey signs in and approves step-ups, and consent pages open from it.
 */
class MainActivity : ComponentActivity() {
    private val vm: ChatAppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        vm.attach(this)
        if (savedInstanceState == null) consume(intent)
        setContent { MeroChatApp(vm = vm, onShare = ::share) }
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
}
