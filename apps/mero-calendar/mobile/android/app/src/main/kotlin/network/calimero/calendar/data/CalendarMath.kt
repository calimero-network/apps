package network.calimero.calendar.data

import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.TemporalAdjusters

/** Calendar geometry: grids, weeks, which events fall on a day, and side-by-side layout. Weeks start on Monday. */
object CalendarMath {
    /** The 42 days (6 weeks) a month grid shows, Monday first. */
    fun monthGrid(month: LocalDate): List<LocalDate> {
        val first = month.withDayOfMonth(1)
        val start = first.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
        return (0 until GRID_DAYS).map { start.plusDays(it.toLong()) }
    }

    /** The Monday-to-Sunday week holding [day]. */
    fun week(day: LocalDate): List<LocalDate> {
        val start = day.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
        return (0 until WEEK_DAYS).map { start.plusDays(it.toLong()) }
    }

    /** Whether [event] covers any part of [day]. */
    fun occursOn(
        event: CalEvent,
        day: LocalDate,
        zone: ZoneId = ZoneId.systemDefault(),
    ): Boolean {
        val dayStart = day.atStartOfDay(zone).toInstant()
        val dayEnd = day.plusDays(1).atStartOfDay(zone).toInstant()
        val end = if (event.end.isAfter(event.start)) event.end else event.start.plusSeconds(1)
        return event.start.isBefore(dayEnd) && end.isAfter(dayStart)
    }

    /** [events] on [day]: all-day ones first, then by start. */
    fun eventsOn(
        events: List<CalEvent>,
        day: LocalDate,
        zone: ZoneId = ZoneId.systemDefault(),
    ): List<CalEvent> = events.filter { occursOn(it, day, zone) }.sortedWith(compareBy<CalEvent>({ !it.allDay }, { it.start }, { it.title }))

    /** A timed event placed in a day column: minutes from midnight and its column among overlaps. */
    data class Placed(
        val event: CalEvent,
        val startMinute: Int,
        val endMinute: Int,
        val column: Int,
        val columns: Int,
    )

    /** Lay out [day]'s timed events so overlapping ones sit side by side. */
    fun layoutDay(
        events: List<CalEvent>,
        day: LocalDate,
        zone: ZoneId = ZoneId.systemDefault(),
    ): List<Placed> {
        val dayStart = day.atStartOfDay(zone).toInstant()
        val timed =
            events
                .filter { !it.allDay && occursOn(it, day, zone) }
                .map { e ->
                    val s = minutesFrom(dayStart, e.start).coerceIn(0, DAY_MINUTES - MIN_BLOCK)
                    val en = minutesFrom(dayStart, e.end).coerceIn(s + MIN_BLOCK, DAY_MINUTES)
                    Triple(e, s, en)
                }.sortedWith(compareBy({ it.second }, { -it.third }))
        val out = mutableListOf<Placed>()
        var cluster = mutableListOf<Triple<CalEvent, Int, Int>>()
        var clusterEnd = -1

        fun flush() {
            if (cluster.isEmpty()) return
            val columnEnds = mutableListOf<Int>()
            val assigned =
                cluster.map { item ->
                    val col = columnEnds.indexOfFirst { it <= item.second }.let { if (it < 0) columnEnds.size else it }
                    if (col == columnEnds.size) columnEnds.add(item.third) else columnEnds[col] = item.third
                    item to col
                }
            assigned.forEach { (item, col) -> out += Placed(item.first, item.second, item.third, col, columnEnds.size) }
            cluster = mutableListOf()
        }
        for (item in timed) {
            if (item.second >= clusterEnd) {
                flush()
                clusterEnd = item.third
            } else {
                clusterEnd = maxOf(clusterEnd, item.third)
            }
            cluster += item
        }
        flush()
        return out
    }

    private fun minutesFrom(
        start: Instant,
        at: Instant,
    ): Int = ((at.epochSecond - start.epochSecond) / SECONDS_PER_MINUTE).toInt()

    const val GRID_DAYS = 42
    const val WEEK_DAYS = 7
    const val DAY_MINUTES = 24 * 60
    private const val MIN_BLOCK = 20
    private const val SECONDS_PER_MINUTE = 60
}
