package network.calimero.calendar

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import network.calimero.calendar.app.CalendarAppViewModel
import network.calimero.calendar.ui.MeroCalendarApp

/**
 * The one activity. Links arrive here — on the launch intent (cold start) or through
 * [onNewIntent] — and go to [CalendarAppViewModel.handleLink]: the wallet's sign-in redirect, or a
 * team invitation (`https://links.calimero.network/com.calimero.mero-calendar/join?invitation=…`).
 */
class MainActivity : ComponentActivity() {
    private val vm: CalendarAppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) consume(intent)
        setContent {
            MeroCalendarApp(
                vm = vm,
                onSignIn = { vm.signIn(this) },
                onShare = ::share,
            )
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
