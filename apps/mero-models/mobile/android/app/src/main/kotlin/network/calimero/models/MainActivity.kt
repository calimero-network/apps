package network.calimero.models

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import network.calimero.models.app.ModelsAppViewModel
import network.calimero.models.ui.MeroModelsApp

/**
 * The one activity. Links arrive here, on the launch intent (cold start) or through [onNewIntent],
 * and go to [ModelsAppViewModel.handleLink]: the node's consent page coming back
 * (`mero-models://consent?request_id=…&result=…`), or an invitation link
 * (`https://links.calimero.network/com.calimero.mero-models/join?invitation=…`).
 *
 * The activity hands itself to the view model while it lives ([ModelsAppViewModel.attach]): its
 * passkey approves the account's step-ups, and consent pages open from it.
 */
class MainActivity : ComponentActivity() {
    private val vm: ModelsAppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        vm.attach(this)
        if (savedInstanceState == null) consume(intent)
        setContent { MeroModelsApp(vm = vm) }
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
