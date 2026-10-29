package network.calimero.updates.core

import network.calimero.updates.generated.MetricPoint
import network.calimero.updates.generated.MetricSeries
import java.time.Clock
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToLong

/**
 * The web app's display helpers (`app/src/lib/updates.ts`), so both sides say the same thing about
 * the same data. Timestamps are the contract's milliseconds.
 */
object Format {
    private const val MINUTE = 60L
    private const val HOUR = 60L
    private const val DAY_HOURS = 24L
    private const val MONTH_DAYS = 30L
    private const val DAY_MS = 86_400_000.0

    fun nowMs(clock: Clock = Clock.systemDefaultZone()): ULong = clock.millis().coerceAtLeast(0).toULong()

    /** "just now", "5m ago", "3h ago", "12d ago", then the date. */
    fun timeAgo(
        ms: ULong,
        clock: Clock = Clock.systemDefaultZone(),
    ): String {
        val seconds = ((clock.millis() - ms.toLong()) / 1000).coerceAtLeast(0)
        val minutes = seconds / MINUTE
        val hours = minutes / HOUR
        val days = hours / DAY_HOURS
        return when {
            ms == 0uL -> "never"
            seconds < MINUTE -> "just now"
            minutes < HOUR -> "${minutes}m ago"
            hours < DAY_HOURS -> "${hours}h ago"
            days < MONTH_DAYS -> "${days}d ago"
            else -> formatDate(ms, clock.zone)
        }
    }

    /** "Oct 28, 2026". */
    fun formatDate(
        ms: ULong,
        zone: ZoneId = ZoneId.systemDefault(),
    ): String = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US).format(Instant.ofEpochMilli(ms.toLong()).atZone(zone))

    /** "Due today", "Due in 3 days", "2 days overdue". */
    fun dueLabel(
        dueMs: ULong,
        clock: Clock = Clock.systemDefaultZone(),
    ): String {
        val days = ((dueMs.toDouble() - clock.millis()) / DAY_MS).roundHalfUp()
        if (days == 0L) return "Due today"
        if (days > 0) return "Due in $days day${if (days == 1L) "" else "s"}"
        return "${-days} day${if (days == -1L) "" else "s"} overdue"
    }

    fun isOverdue(
        dueMs: ULong,
        clock: Clock = Clock.systemDefaultZone(),
    ): Boolean = dueMs.toLong() < clock.millis()

    /** The month's update title: "October 2026 update". */
    fun monthTitle(clock: Clock = Clock.systemDefaultZone()): String =
        DateTimeFormatter.ofPattern("LLLL yyyy", Locale.US).format(Instant.ofEpochMilli(clock.millis()).atZone(clock.zone)) + " update"

    fun plural(
        n: ULong,
        one: String,
        many: String = one + "s",
    ): String = "$n ${if (n == 1uL) one else many}"

    /** The share of updates a person opened, rounded. */
    fun percent(
        part: ULong,
        total: ULong,
    ): Int = if (total == 0uL) 0 else (part.toDouble() / total.toDouble() * 100).roundHalfUp().toInt()

    // Swift's `.rounded()` rounds half away from zero; Kotlin's roundToLong rounds half up.
    private fun Double.roundHalfUp(): Long = if (this < 0) -(-this).roundToLong() else roundToLong()
}

/** Names for accounts, the web's `personLabel` / `shortAccount` / `initials`. */
object People {
    private const val SHORT_AT = 12
    private const val FNV_OFFSET = 2_166_136_261u
    private const val FNV_PRIME = 16_777_619u
    private const val HUES = 360u

    /** `abcdef…7890`. */
    fun shortAccount(account: String): String = if (account.length > SHORT_AT) "${account.take(6)}…${account.takeLast(4)}" else account

    /** Their profile name, else a short account id. */
    fun label(
        name: String,
        account: String,
    ): String = name.trim().ifEmpty { shortAccount(account) }

    /** Up to two initials from a label. */
    fun initials(
        name: String,
        account: String,
    ): String {
        val label = label(name, account)
        val words = label.split(' ', '-', '_').filter { it.isNotEmpty() }
        val letters = words.take(2).joinToString("") { it.first().toString() }
        return letters.ifEmpty { label.take(2) }.uppercase()
    }

    /** A stable hue (0..<360) for an account's avatar; the same as the iOS app's. */
    fun avatarHue(account: String): Int {
        var hash = FNV_OFFSET
        for (byte in account.toByteArray(Charsets.UTF_8)) {
            hash = hash xor (byte.toUInt() and 0xFFu)
            hash *= FNV_PRIME
        }
        return (hash % HUES).toInt()
    }
}

/**
 * KPI values are stored as typed ("$1.2M", "38%"); these read the number out for deltas and
 * sparklines, exactly as the web's `parseMetric` / `deltaLabel`.
 */
object Metrics {
    enum class Direction { UP, DOWN, FLAT }

    private val number = Regex("""(-?\d+(?:\.\d+)?)\s*(?:([kKmMbB])(?![a-zA-Z]))?""")
    private const val PERCENT = 100.0
    private const val WHOLE_FROM = 10.0

    /** The number in a KPI value, with a k/m/b suffix applied. Null when there is none. */
    fun parse(value: String): Double? {
        val match = number.find(value.replace(",", "")) ?: return null
        val n = match.groupValues[1].toDoubleOrNull()?.takeIf { it.isFinite() } ?: return null
        val multiplier =
            when (match.groupValues[2].lowercase()) {
                "k" -> 1e3
                "m" -> 1e6
                "b" -> 1e9
                else -> 1.0
            }
        return n * multiplier
    }

    /** "+12%", "−4%" (a real minus sign), "±0%", or null when either side has no number. */
    fun delta(
        previous: String,
        next: String,
    ): String? {
        val a = parse(previous)
        val b = parse(next)
        if (a == null || b == null || a == 0.0) return null
        val pct = (b - a) / abs(a) * PERCENT
        if (!pct.isFinite()) return null
        val rounded = if (abs(pct) >= WHOLE_FROM) roundAway(pct) else roundAway(pct * WHOLE_FROM) / WHOLE_FROM
        return if (rounded == 0.0) "±0%" else "${if (rounded > 0) "+" else "−"}${trim(abs(rounded))}%"
    }

    fun direction(delta: String?): Direction =
        when {
            delta == null -> Direction.FLAT
            delta.startsWith("+") -> Direction.UP
            delta.startsWith("−") -> Direction.DOWN
            else -> Direction.FLAT
        }

    /** The numbers of a series, for a sparkline; values with no number are skipped. */
    fun points(values: List<String>): List<Double> = values.mapNotNull { parse(it) }

    /** The previous report of a post's KPI. */
    fun previous(
        name: String,
        postId: String,
        series: List<MetricSeries>,
    ): MetricPoint? {
        val line = series.firstOrNull { it.name.equals(name, ignoreCase = true) } ?: return null
        val index = line.points.indexOfFirst { it.postId == postId }
        return if (index > 0) line.points[index - 1] else null
    }

    /** The latest reported value of a metric, for "last: $42k" in the composer. */
    fun last(
        name: String,
        series: List<MetricSeries>,
    ): String? {
        val key = name.trim()
        if (key.isEmpty()) return null
        return series
            .firstOrNull { it.name.equals(key, ignoreCase = true) }
            ?.points
            ?.lastOrNull()
            ?.value
    }

    /** The latest value's change since the report before it. */
    fun latestDelta(series: MetricSeries): String? {
        val p = series.points
        return if (p.size >= 2) delta(p[p.size - 2].value, p[p.size - 1].value) else null
    }

    private fun roundAway(v: Double): Double = if (v < 0) -Math.round(-v).toDouble() else Math.round(v).toDouble()

    private fun trim(v: Double): String = if (v == Math.floor(v)) v.toLong().toString() else v.toString()
}

/** The kinds of help an ask can request. */
data class AskKind(
    val id: String,
    val label: String,
    val hint: String,
) {
    companion object {
        val all =
            listOf(
                AskKind("intro", "Intro", "An introduction to a person or company"),
                AskKind("hire", "Hiring", "A candidate referral"),
                AskKind("customer", "Customer", "A lead or a design partner"),
                AskKind("advice", "Advice", "Expertise or a second opinion"),
                AskKind("fundraising", "Fundraising", "An investor intro or a term-sheet read"),
                AskKind("other", "Other", "Anything else"),
            )

        fun of(id: String): AskKind = all.firstOrNull { it.id == id } ?: all.last()
    }
}

/** What the app offers to react with, and the rest of the web's fixed lists. */
object Catalog {
    val reactions = listOf("👍", "🎉", "❤️", "🚀", "👀", "🙏")

    val categoryColors = listOf("#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#525252")

    data class Cadence(
        val days: UInt,
        val label: String,
    )

    val cadences =
        listOf(
            Cadence(0u, "No reminder"),
            Cadence(7u, "Weekly"),
            Cadence(14u, "Every two weeks"),
            Cadence(30u, "Monthly"),
            Cadence(91u, "Quarterly"),
        )

    data class StarterCategory(
        val name: String,
        val emoji: String,
        val color: String,
    )

    val starterCategories =
        listOf(
            StarterCategory("Monthly update", "📅", "#2563eb"),
            StarterCategory("Fundraising", "💰", "#16a34a"),
            StarterCategory("Product", "🚀", "#7c3aed"),
            StarterCategory("Hiring", "🧑‍💻", "#d97706"),
            StarterCategory("Board", "🏛️", "#525252"),
        )

    /** `#rrggbb` to 0xRRGGBB, null when it is not one. */
    fun rgb(hex: String): Long? {
        val s = hex.trim().removePrefix("#")
        if (s.length != 6) return null
        return s.toLongOrNull(16)
    }
}
