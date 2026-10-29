package network.calimero.calendar.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.ZoneId

class CalendarMathTest {
    private val zone = ZoneId.of("UTC")

    private fun event(
        id: String,
        start: String,
        end: String,
        allDay: Boolean = false,
    ) = CalEvent(id, id, "", "ab".repeat(32), java.time.Instant.parse(start), java.time.Instant.parse(end), allDay, "#3b6fe0", emptyList(), false)

    @Test
    fun `month grid is six Monday-first weeks`() {
        val grid = CalendarMath.monthGrid(LocalDate.of(2026, 10, 15))
        assertEquals(42, grid.size)
        assertEquals(LocalDate.of(2026, 9, 28), grid.first())
        assertEquals(DayOfWeek.MONDAY, grid.first().dayOfWeek)
        assertTrue(LocalDate.of(2026, 10, 31) in grid)
        assertEquals(LocalDate.of(2026, 11, 8), grid.last())
    }

    @Test
    fun `week runs Monday to Sunday`() {
        val week = CalendarMath.week(LocalDate.of(2026, 10, 28))
        assertEquals(LocalDate.of(2026, 10, 26), week.first())
        assertEquals(LocalDate.of(2026, 11, 1), week.last())
    }

    @Test
    fun `a multi-day event shows on each day it covers, and not on the day it ends at midnight`() {
        val e = event("trip", "2026-10-27T10:00:00Z", "2026-10-29T00:00:00Z")
        assertTrue(CalendarMath.occursOn(e, LocalDate.of(2026, 10, 27), zone))
        assertTrue(CalendarMath.occursOn(e, LocalDate.of(2026, 10, 28), zone))
        assertFalse(CalendarMath.occursOn(e, LocalDate.of(2026, 10, 29), zone))
    }

    @Test
    fun `overlapping events sit side by side`() {
        val day = LocalDate.of(2026, 10, 28)
        val placed =
            CalendarMath
                .layoutDay(
                    listOf(
                        event("a", "2026-10-28T09:00:00Z", "2026-10-28T10:00:00Z"),
                        event("b", "2026-10-28T09:30:00Z", "2026-10-28T11:00:00Z"),
                        event("c", "2026-10-28T12:00:00Z", "2026-10-28T13:00:00Z"),
                        event("all", "2026-10-28T00:00:00Z", "2026-10-28T23:59:00Z", allDay = true),
                    ),
                    day,
                    zone,
                ).associateBy { it.event.id }
        assertEquals(setOf("a", "b", "c"), placed.keys)
        assertEquals(2, placed.getValue("a").columns)
        assertEquals(0, placed.getValue("a").column)
        assertEquals(1, placed.getValue("b").column)
        assertEquals(1, placed.getValue("c").columns)
        assertEquals(540, placed.getValue("a").startMinute)
        assertEquals(660, placed.getValue("b").endMinute)
    }

    @Test
    fun `draft validation and wire form`() {
        val start = LocalDate.of(2026, 10, 28).atTime(10, 0)
        val draft = EventDraft(title = "", start = start, end = start.plusHours(1))
        assertEquals("Add a title", draft.error)
        assertEquals("The event has to end after it starts", draft.copy(title = "x", end = start).error)
        val allDay = draft.copy(title = "Off", allDay = true, end = start).fields(zone)
        assertEquals("long-event", allDay.type)
        assertEquals("Wed Oct 28 2026 00:00:00 GMT+0000 (Coordinated Universal Time)", allDay.start)
        assertEquals("Wed Oct 28 2026 23:59:00 GMT+0000 (Coordinated Universal Time)", allDay.end)
        val moved = draft.copy(title = "x").withStart(start.plusDays(1))
        assertEquals(start.plusDays(1).plusHours(1), moved.end)
        assertEquals(emptyList<String>(), draft.copy(peers = listOf("p")).withPrivate(true).peers)
    }
}
