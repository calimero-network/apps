package network.calimero.models.core

import java.net.UnknownHostException
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** Copy, names and formatting shared by every screen. (Swift `ModelsFormat`.) */
@Suppress("MagicNumber", "TooManyFunctions")
object ModelsFormat {
    /** The app's registry package, the deep-link slug and the invitation path (`APP_SLUG` in the web app). */
    const val PACKAGE_NAME = "com.calimero.mero-models"

    /** `ab12…ef90`: an id short enough to show (the web's `shortId`). */
    fun shortId(id: String): String = if (id.length <= 12) id else "${id.take(6)}…${id.takeLast(4)}"

    /** Initials for an avatar: the first letters of the first two words. */
    fun initials(name: String): String {
        val out =
            name
                .split(' ', '_', '-', '.')
                .filter { it.isNotEmpty() }
                .take(2)
                .map { it.first() }
                .joinToString("")
                .uppercase()
        return out.ifEmpty { "?" }
    }

    /** The name a member chose for the scene. The web joins an unnamed member as "Guest", so that is no name. */
    fun chosenName(name: String): String? = name.trim().takeIf { it.isNotEmpty() && it != "Guest" }

    /** What the web's Add menu calls each kind. */
    fun kindLabel(kind: String): String =
        when (kind) {
            "cube" -> "Cube"
            "sphere" -> "UV Sphere"
            "icosphere" -> "Ico Sphere"
            "cylinder" -> "Cylinder"
            "cone" -> "Cone"
            "torus" -> "Torus"
            "plane" -> "Plane"
            "capsule" -> "Capsule"
            "mesh" -> "Mesh"
            "group" -> "Empty"
            "point_light" -> "Point light"
            "spot_light" -> "Spot light"
            "directional_light" -> "Sun"
            else -> kind.replaceFirstChar { it.uppercase() }
        }

    fun isLight(kind: String) = kind == "point_light" || kind == "spot_light" || kind == "directional_light"

    /** "just now", "5m ago", "3h ago", "2d ago", or a date, from unix milliseconds. */
    fun relativeTime(
        ms: Long,
        now: Long = System.currentTimeMillis(),
    ): String {
        val seconds = maxOf(0L, now - ms) / 1000
        return when {
            seconds < 60 -> "just now"
            seconds < 3600 -> "${seconds / 60}m ago"
            seconds < 86_400 -> "${seconds / 3600}h ago"
            seconds < 7 * 86_400 -> "${seconds / 86_400}d ago"
            else -> date(ms)
        }
    }

    /** When a check-out lapses: a time today, else a day and a time. */
    fun until(
        ms: Long,
        now: Long = System.currentTimeMillis(),
        timeZone: TimeZone = TimeZone.getDefault(),
    ): String {
        val a = Calendar.getInstance(timeZone).apply { timeInMillis = ms }
        val b = Calendar.getInstance(timeZone).apply { timeInMillis = now }
        val sameDay = a.get(Calendar.YEAR) == b.get(Calendar.YEAR) && a.get(Calendar.DAY_OF_YEAR) == b.get(Calendar.DAY_OF_YEAR)
        val f = SimpleDateFormat(if (sameDay) "HH:mm" else "d MMM, HH:mm", Locale.US)
        f.timeZone = timeZone
        return f.format(Date(ms))
    }

    fun date(
        ms: Long,
        timeZone: TimeZone = TimeZone.getDefault(),
    ): String {
        val f = SimpleDateFormat("d MMM yyyy", Locale.US)
        f.timeZone = timeZone
        return f.format(Date(ms))
    }

    /** "1 object", "12 objects". */
    fun count(
        n: Int,
        noun: String,
    ) = if (n == 1) "1 $noun" else "$n ${noun}s"

    /** "1.2k", "3.4M": triangle counts. */
    fun compact(n: Long): String =
        when {
            n < 1000 -> "$n"
            n < 1_000_000 -> trim(n / 1000.0) + "k"
            else -> trim(n / 1_000_000.0) + "M"
        }

    private fun trim(v: Double): String = String.format(Locale.US, "%.1f", v).removeSuffix(".0")

    /** Words a person can act on, from an error. */
    fun errorText(error: Throwable): String {
        val text = error.message ?: error.toString()
        val lower = text.lowercase()
        return when {
            lower.contains("norelay") || lower.contains("no relay") ->
                "Your account has no relay yet. Join a studio from an invitation link, or try again shortly."
            error is UnknownHostException -> "You're offline. Check your connection and try again."
            else -> text
        }
    }
}
