package network.calimero.crm.core

import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale
import kotlin.math.roundToLong

/** The kinds of activity the contract knows, in the web app's order. */
enum class ActivityKind(
    val raw: String,
    val label: String,
) {
    CALL("call", "Call"),
    MEETING("meeting", "Meeting"),
    TASK("task", "Task"),
    EMAIL("email", "Email"),
    DEADLINE("deadline", "Deadline"),
    ;

    companion object {
        fun of(raw: String): ActivityKind? = entries.firstOrNull { it.raw == raw }

        /** The label for a stored kind, or the kind itself for one this app does not know. */
        fun label(raw: String): String = of(raw)?.label ?: raw
    }
}

/** Money is whole units of the pipeline's currency (`u64`), never a float. */
object Money {
    private val symbols =
        mapOf(
            "USD" to "$",
            "EUR" to "€",
            "GBP" to "£",
            "JPY" to "¥",
            "CNY" to "CN¥",
            "INR" to "₹",
            "CAD" to "CA$",
            "AUD" to "A$",
            "NZD" to "NZ$",
            "BRL" to "R$",
            "CHF" to "CHF ",
            "KRW" to "₩",
            "MXN" to "MX$",
        )

    /** `$12,400` or, compact, `$12.4K`. A code with no known symbol reads `12,400 XYZ`. */
    fun format(
        value: ULong,
        currency: String,
        compact: Boolean = false,
    ): String {
        val code = currency.trim().uppercase()
        val number = if (compact) compactNumber(value) else grouped(value)
        symbols[code]?.let { return it + number }
        return if (code.isEmpty()) number else "$number $code"
    }

    /** `12,400`. */
    fun grouped(value: ULong): String {
        val digits = value.toString()
        val out = StringBuilder()
        digits.forEachIndexed { i, d ->
            if (i > 0 && (digits.length - i) % 3 == 0) out.append(',')
            out.append(d)
        }
        return out.toString()
    }

    /** `950`, `12.4K`, `1.5M`, `2B`. */
    fun compactNumber(value: ULong): String {
        val steps = listOf(1_000_000_000uL to "B", 1_000_000uL to "M", 1_000uL to "K")
        for ((size, suffix) in steps) {
            if (value >= size) {
                val tenths = (value * 10uL + size / 2uL) / size
                val whole = tenths / 10uL
                val frac = tenths % 10uL
                return if (frac == 0uL || whole >= 100uL) "$whole$suffix" else "$whole.$frac$suffix"
            }
        }
        return value.toString()
    }

    /** What a person types into a value field: `12k`, `1.5m`, `$12,400`. Empty is 0; null when it is not a number. */
    fun parse(input: String): ULong? {
        var s = input.lowercase().filter { !it.isWhitespace() && it !in ",$€£¥" }
        if (s.isEmpty()) return 0uL
        var mult = 1.0
        if (s.endsWith("k")) {
            mult = 1_000.0
            s = s.dropLast(1)
        } else if (s.endsWith("m")) {
            mult = 1_000_000.0
            s = s.dropLast(1)
        }
        val parts = s.split('.')
        if (s.isEmpty() || parts.size > 2 || parts.any { p -> p.isEmpty() || !p.all { it in '0'..'9' } }) return null
        val value = (s.toDouble() * mult).roundToLong()
        return if (value < 0) null else value.toULong()
    }

    /** Whether a currency code is three letters. */
    fun isValidCode(code: String): Boolean {
        val c = code.trim()
        return c.length == 3 && c.all { it in 'a'..'z' || it in 'A'..'Z' }
    }
}

/** How urgent a due date reads. */
enum class DueTone { OVERDUE, TODAY, SOON, LATER }

data class DueLabel(
    val text: String,
    val tone: DueTone,
)

/** Dates as the contract keeps them (milliseconds since the epoch) and as people read them. */
object Days {
    private fun local(
        ms: ULong,
        zone: ZoneId,
    ): ZonedDateTime = Instant.ofEpochMilli(ms.toLong()).atZone(zone)

    fun startOfDay(
        ms: ULong,
        zone: ZoneId,
    ): ULong =
        local(ms, zone)
            .toLocalDate()
            .atStartOfDay(zone)
            .toInstant()
            .toEpochMilli()
            .toULong()

    /** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
    fun between(
        from: ULong,
        to: ULong,
        zone: ZoneId,
    ): Int = ChronoUnit.DAYS.between(local(from, zone).toLocalDate(), local(to, zone).toLocalDate()).toInt()

    /** A due time `days` from now, at 10:00 local: when people actually call. */
    fun dueIn(
        days: Int,
        now: ULong,
        zone: ZoneId,
    ): ULong = atTime(local(now, zone).toLocalDate().plusDays(days.toLong()), TEN, zone)

    /** A picked calendar day at local noon, so a timezone shift never moves the day. */
    fun noon(
        day: LocalDate,
        zone: ZoneId,
    ): ULong = atTime(day, NOON, zone)

    fun atTime(
        day: LocalDate,
        hour: Int,
        zone: ZoneId,
    ): ULong =
        day
            .atTime(LocalTime.of(hour, 0))
            .atZone(zone)
            .toInstant()
            .toEpochMilli()
            .toULong()

    fun localDate(
        ms: ULong,
        zone: ZoneId,
    ): LocalDate = local(ms, zone).toLocalDate()

    /** "Overdue 3d" / "Today" / "Tomorrow" / "In 4 days" / "Mar 3". */
    fun dueLabel(
        due: ULong,
        now: ULong,
        zone: ZoneId,
    ): DueLabel {
        val d = between(now, due, zone)
        return when {
            d < 0 -> DueLabel("Overdue ${-d}d", DueTone.OVERDUE)
            d == 0 -> DueLabel("Today", DueTone.TODAY)
            d == 1 -> DueLabel("Tomorrow", DueTone.SOON)
            d < 7 -> DueLabel("In $d days", DueTone.SOON)
            else -> DueLabel(short(due, zone, now), DueTone.LATER)
        }
    }

    /** "Mar 3", or "Mar 3, 2025" outside the current year. */
    fun short(
        ms: ULong,
        zone: ZoneId,
        now: ULong = System.currentTimeMillis().toULong(),
        locale: Locale = Locale.getDefault(),
    ): String {
        val date = local(ms, zone)
        val sameYear = date.year == local(now, zone).year
        return date.format(DateTimeFormatter.ofPattern(if (sameYear) "MMM d" else "MMM d, yyyy", locale))
    }

    /** "just now", "5m ago", "3h ago", "2d ago", then the date. */
    fun ago(
        ms: ULong,
        now: ULong,
        zone: ZoneId,
    ): String {
        val seconds = maxOf(0L, (now.toLong() - ms.toLong()) / 1000)
        return when {
            seconds < MINUTE -> "just now"
            seconds < HOUR -> "${seconds / MINUTE}m ago"
            seconds < DAY -> "${seconds / HOUR}h ago"
            seconds < DAY * 30 -> "${seconds / DAY}d ago"
            else -> short(ms, zone, now)
        }
    }

    private const val TEN = 10
    private const val NOON = 12
    private const val MINUTE = 60L
    private const val HOUR = 3600L
    private const val DAY = 86_400L
}
