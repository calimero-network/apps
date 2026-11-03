package network.calimero.docs

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import network.calimero.docs.app.DocsAppViewModel
import network.calimero.docs.ui.MeroDocsApp

/**
 * The one activity. Links arrive here, on the launch intent (cold start) or through
 * [onNewIntent], and go to [DocsAppViewModel.handleLink]: the node's consent page coming back
 * (`mero-docs://consent?…`), an invitation to a workspace, or a document link
 * (`https://mero-docs.vercel.app/app/<workspace>/f/<folder>/d/<doc>`). While it lives, its passkey
 * (Credential Manager) approves the account's step-ups ([DocsAppViewModel.attach]).
 */
class MainActivity : ComponentActivity() {
    private val vm: DocsAppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        vm.attach(this)
        if (savedInstanceState == null) consume(intent)
        setContent { MeroDocsApp(vm = vm) }
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
}
