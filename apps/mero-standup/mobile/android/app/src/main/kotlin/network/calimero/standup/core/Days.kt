package network.calimero.standup.core

import java.time.Clock
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.util.Locale

/**
 * Standup days, as the contract keys them: `YYYY-MM-DD`, the member's LOCAL date (the web app's
 * `lib/days.ts`). The contract cannot know a time zone, so "today" is decided on the phone.
 */
object Days {
    /** [date] as `YYYY-MM-DD`. */
    fun dayOf(date: LocalDate): String = date.toString()

    /** Today, in [clock]'s zone. */
    fun today(clock: Clock = Clock.systemDefaultZone()): String = dayOf(LocalDate.now(clock))

    /** The date [day] names, or null when it is not a real `YYYY-MM-DD` date. */
    fun parse(day: String): LocalDate? {
        if (!DAY.matches(day)) return null
        return try {
            LocalDate.parse(day)
        } catch (_: DateTimeParseException) {
            null
        }
    }

    /** [day] moved by [delta] days; [day] unchanged when it is not a date. */
    fun shift(
        day: String,
        delta: Int,
    ): String = parse(day)?.plusDays(delta.toLong())?.let(::dayOf) ?: day

    /** "Today", "Yesterday", "Tomorrow", or a short weekday and date. */
    fun describe(
        day: String,
        clock: Clock = Clock.systemDefaultZone(),
        locale: Locale = Locale.getDefault(),
    ): String {
        val now = LocalDate.now(clock)
        val date = parse(day) ?: return day
        return when (date) {
            now -> "Today"
            now.minusDays(1) -> "Yesterday"
            now.plusDays(1) -> "Tomorrow"
            else -> date.format(DateTimeFormatter.ofPattern(if (date.year == now.year) "EEE, MMM d" else "EEE, MMM d, yyyy", locale))
        }
    }

    /** A contract timestamp (nanoseconds) as an instant. */
    fun instant(nanos: ULong): Instant = Instant.ofEpochMilli((nanos / 1_000_000uL).toLong())

    /** "just now", "5m ago", "3h ago", "yesterday", or a short date. */
    fun relative(
        nanos: ULong,
        clock: Clock = Clock.systemDefaultZone(),
        locale: Locale = Locale.getDefault(),
    ): String {
        if (nanos == 0uL) return ""
        val then = instant(nanos)
        val seconds = Math.round((clock.instant().toEpochMilli() - then.toEpochMilli()) / 1000.0)
        val minutes = Math.round(seconds / 60.0)
        val hours = Math.round(minutes / 60.0)
        val thenDay = then.atZone(clock.zone).toLocalDate()
        val today = LocalDate.now(clock)
        return when {
            seconds < 45 -> "just now"
            minutes < 60 -> "${minutes}m ago"
            thenDay == today && hours < 24 -> "${hours}h ago"
            thenDay == today.minusDays(1) -> "yesterday"
            else -> thenDay.format(DateTimeFormatter.ofPattern(if (thenDay.year == today.year) "MMM d" else "MMM d, yyyy", locale))
        }
    }

    /** The Monday of [day]'s week. Standup weeks start on Monday. */
    fun weekStart(day: String): String {
        val date = parse(day) ?: return day
        val offset = date.dayOfWeek.value - DayOfWeek.MONDAY.value
        return dayOf(date.minusDays(offset.toLong()))
    }

    /** The seven days from [start]. */
    fun weekDays(start: String): List<String> = (0 until 7).map { shift(start, it) }

    /** "Mon", "Tue", … for a day. */
    fun weekdayShort(
        day: String,
        locale: Locale = Locale.getDefault(),
    ): String = parse(day)?.format(DateTimeFormatter.ofPattern("EEE", locale)) ?: day

    /** The day of the month, "28". */
    fun dayNumber(day: String): String = (day.takeLast(2).toIntOrNull() ?: 0).toString()

    /** "Oct 12 – 18", or across months "Oct 27 – Nov 2". */
    fun describeWeek(
        start: String,
        locale: Locale = Locale.getDefault(),
    ): String {
        val a = parse(start) ?: return start
        val b = a.plusDays(6)
        val short = DateTimeFormatter.ofPattern("MMM d", locale)
        val right = if (a.month == b.month) b.dayOfMonth.toString() else b.format(short)
        return "${a.format(short)} – $right"
    }

    /** "October 2026", for the decision timeline. */
    fun monthTitle(
        nanos: ULong,
        zone: ZoneId = ZoneId.systemDefault(),
        locale: Locale = Locale.getDefault(),
    ): String = instant(nanos).atZone(zone).format(DateTimeFormatter.ofPattern("MMMM yyyy", locale))

    /** "Oct 12", for a timeline entry. */
    fun shortDate(
        nanos: ULong,
        zone: ZoneId = ZoneId.systemDefault(),
        locale: Locale = Locale.getDefault(),
    ): String = instant(nanos).atZone(zone).format(DateTimeFormatter.ofPattern("MMM d", locale))

    private val DAY = Regex("""^\d{4}-\d{2}-\d{2}$""")
}
