package network.calimero.calendar.data

import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.TimeZone

/**
 * An event's `start` / `end` as the web app writes them: JavaScript's `Date.prototype.toString()`,
 * e.g. `Wed Oct 28 2026 10:00:00 GMT+0100 (Central European Standard Time)`, which the web app
 * reads back with `new Date(…)`. The phone writes the same form so both sides read each other's
 * events, and also accepts ISO-8601.
 */
object EventTime {
    private val js = DateTimeFormatter.ofPattern("EEE MMM dd yyyy HH:mm:ss 'GMT'xx", Locale.US)

    /** [instant] in [zone], in `Date.prototype.toString()` form. */
    fun format(
        instant: Instant,
        zone: ZoneId = ZoneId.systemDefault(),
    ): String {
        val local = ZonedDateTime.ofInstant(instant, zone)
        val tz = TimeZone.getTimeZone(zone)
        val name = tz.getDisplayName(tz.inDaylightTime(java.util.Date.from(instant)), TimeZone.LONG, Locale.US)
        return "${js.format(local)} ($name)"
    }

    /** Read a stored `start` / `end`; null when it is neither form. */
    fun parse(raw: String): Instant? {
        val text = raw.trim()
        if (text.isEmpty()) return null
        val bare = text.substringBefore(" (").trim()
        val readers =
            listOf<() -> Instant>(
                { OffsetDateTime.parse(bare, js).toInstant() },
                { Instant.parse(text) },
                { OffsetDateTime.parse(text).toInstant() },
                {
                    java.time.LocalDateTime
                        .parse(text)
                        .atZone(ZoneId.systemDefault())
                        .toInstant()
                },
            )
        return readers.firstNotNullOfOrNull { read -> runCatching(read).getOrNull() }
    }
}
