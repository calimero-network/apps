package network.calimero.pass.ui

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import network.calimero.pass.core.PassConstants

/**
 * The clipboard. A copied secret is marked sensitive (kept out of the clipboard preview and
 * keyboard suggestions) and cleared after [PassConstants.CLIPBOARD_SECONDS] if it is still the
 * clip there: the Android twin of iOS's expiring, local-only pasteboard item.
 */
object Clipboard {
    private const val IS_SENSITIVE_KEY = "android.content.extra.IS_SENSITIVE"
    private val handler = Handler(Looper.getMainLooper())

    fun copySecret(
        context: Context,
        label: String,
        value: String,
    ) {
        val manager = context.getSystemService(ClipboardManager::class.java) ?: return
        val clip = ClipData.newPlainText(label, value)
        clip.description.extras =
            PersistableBundle().apply {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true)
                } else {
                    putBoolean(IS_SENSITIVE_KEY, true)
                }
            }
        manager.setPrimaryClip(clip)
        val stamp = clip.description.timestamp
        handler.postDelayed({ clearIfStill(manager, stamp, value) }, PassConstants.CLIPBOARD_SECONDS * 1000L)
    }

    private fun clearIfStill(
        manager: ClipboardManager,
        stamp: Long,
        value: String,
    ) {
        val current = runCatching { manager.primaryClip }.getOrNull()
        val same =
            if (current == null) {
                // The app is in the background and cannot read the clipboard: clear anyway.
                true
            } else {
                current.description.timestamp == stamp ||
                    (current.itemCount > 0 && current.getItemAt(0).text?.toString() == value)
            }
        if (!same) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            manager.clearPrimaryClip()
        } else {
            manager.setPrimaryClip(ClipData.newPlainText("", ""))
        }
    }

    /** Ids and links: not secret, no expiry. */
    fun copyPlain(
        context: Context,
        label: String,
        value: String,
    ) {
        context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText(label, value))
    }

    /** What is on the clipboard now, for "Paste". */
    fun paste(context: Context): String? =
        context
            .getSystemService(ClipboardManager::class.java)
            ?.primaryClip
            ?.takeIf { it.itemCount > 0 }
            ?.getItemAt(0)
            ?.coerceToText(context)
            ?.toString()

    /** The system share sheet for a link. */
    fun share(
        context: Context,
        text: String,
    ) {
        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
        context.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}

/** What every screen shares: the toast, the copy that expires, and this phone's label. (iOS `AppServices`.) */
class AppServices(
    private val context: Context,
    val deviceLabel: String,
) {
    var toast by mutableStateOf<String?>(null)
        private set
    private val handler = Handler(Looper.getMainLooper())
    private val hide = Runnable { toast = null }

    fun show(text: String) {
        toast = text
        handler.removeCallbacks(hide)
        handler.postDelayed(hide, TOAST_MS)
    }

    fun copySecret(
        value: String,
        what: String,
    ) {
        Clipboard.copySecret(context, what, value)
        show("$what copied. Clears in ${PassConstants.CLIPBOARD_SECONDS}s.")
    }

    private companion object {
        const val TOAST_MS = 2_500L
    }
}

val LocalServices = staticCompositionLocalOf<AppServices> { error("AppServices not provided") }
