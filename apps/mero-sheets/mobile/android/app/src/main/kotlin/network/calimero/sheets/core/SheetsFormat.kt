package network.calimero.sheets.core

import com.calimero.mero.account.NoRelayException
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.roundToLong

/** Names and fixed values shared with the web app (`app/src/config.ts`). */
object MeroSheets {
    /** The registry package: what workspaces are founded with and invitation links carry. */
    const val PACKAGE_NAME = "com.calimero.mero-sheets"

    /** How often to re-read while the relay's event stream is not available, in ms. */
    const val POLL_INTERVAL_MS = 5_000L

    /** The tab a new spreadsheet starts with, as on the web. */
    const val FIRST_SHEET_NAME = "Sheet 1"
}

/** Pure presentation helpers, the twins of `app/src/lib/time.ts` and friends. */
object SheetsFormat {
    private const val NS_PER_MS = 1_000_000L
    private const val JUST_NOW_S = 45
    private const val MINUTE = 60.0
    private const val DAY_H = 24.0
    private const val WEEK_D = 7

    /**
     * "just now", "5 min ago", "3 h ago", "2 d ago", then a date, from a node timestamp in
     * nanoseconds (`app/src/lib/time.ts`).
     */
    @Suppress("ReturnCount")
    fun ago(
        ns: Long,
        nowMs: Long = System.currentTimeMillis(),
    ): String {
        if (ns <= 0) return ""
        val ms = ns / NS_PER_MS
        val s = maxOf(0L, ((nowMs - ms) / 1000.0).roundToLong())
        if (s < JUST_NOW_S) return "just now"
        val m = (s / MINUTE).roundToLong()
        if (m < MINUTE) return "$m min ago"
        val h = (m / MINUTE).roundToLong()
        if (h < DAY_H) return "$h h ago"
        val d = (h / DAY_H).roundToLong()
        if (d < WEEK_D) return "$d d ago"
        return SimpleDateFormat("d MMM yyyy", Locale.getDefault()).format(Date(ms))
    }

    /** `4f8a…c2e1` for a hex key; anything that is not one passes through. */
    fun truncateKey(key: String): String = if (key.length >= 32 && ' ' !in key) "${key.take(4)}…${key.takeLast(4)}" else key

    /** Index into the eight avatar swatches, stable per seed (the web's `avatarColor`). */
    fun swatch(seed: String): Int {
        var h = 0
        for (c in seed) h = h * 31 + c.code
        return (Math.abs(h.toLong()) % 8).toInt()
    }

    /** Plain words for a failure. */
    fun errorText(error: Throwable): String =
        when (error) {
            is NoRelayException -> "No relay serves this account yet. Join a workspace from an invitation link to get one."
            is SheetsException -> error.message.orEmpty()
            is SocketTimeoutException -> "The relay took too long to answer. Try again."
            is UnknownHostException -> "You are offline. Check your connection and try again."
            is IOException -> error.message?.takeIf { it.isNotBlank() } ?: "You are offline. Check your connection and try again."
            else -> error.message?.takeIf { it.isNotBlank() } ?: "Something went wrong. Try again."
        }
}

/** A failure the app words itself. */
class SheetsException(
    message: String,
) : Exception(message)
