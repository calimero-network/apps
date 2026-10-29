package network.calimero.stream

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import network.calimero.stream.app.StreamViewModel
import network.calimero.stream.ui.Platform
import network.calimero.stream.ui.StreamApp

/**
 * The one activity. Links arrive here, on the launch intent (cold start) or through [onNewIntent],
 * and go to the session: the wallet's sign-in redirect, or an invitation.
 */
class MainActivity : ComponentActivity() {
    private val vm: StreamViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) consume(intent)
        val platform =
            Platform(
                signIn = { vm.signIn(this) },
                share = ::share,
                copy = ::copy,
                openSettings = ::openSettings,
            )
        setContent { StreamApp(vm, platform) }
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

    private fun openSettings() {
        try {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
        } catch (_: ActivityNotFoundException) {
            // No settings screen to open; the dialog already said what to change.
        }
    }
}
