package network.calimero.calendar.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

class EventTimeTest {
    /** What the web app's `new Date(2026, 9, 28, 10).toString()` writes in Berlin. */
    private val webFixture = "Wed Oct 28 2026 10:00:00 GMT+0100 (Central European Standard Time)"
    private val berlin = ZoneId.of("Europe/Berlin")

    @Test
    fun `reads the web app's Date toString form`() {
        assertEquals(Instant.parse("2026-10-28T09:00:00Z"), EventTime.parse(webFixture))
    }

    @Test
    fun `writes the same form the web app writes`() {
        assertEquals(webFixture, EventTime.format(Instant.parse("2026-10-28T09:00:00Z"), berlin))
    }

    @Test
    fun `summer time carries its own offset and name`() {
        val text = EventTime.format(Instant.parse("2026-07-01T08:30:00Z"), berlin)
        assertEquals("Wed Jul 01 2026 10:30:00 GMT+0200 (Central European Summer Time)", text)
        assertEquals(Instant.parse("2026-07-01T08:30:00Z"), EventTime.parse(text))
    }

    @Test
    fun `round-trips in UTC and reads ISO`() {
        val instant = Instant.parse("2026-01-05T23:59:00Z")
        assertEquals(instant, EventTime.parse(EventTime.format(instant, ZoneId.of("UTC"))))
        assertEquals(instant, EventTime.parse("2026-01-05T23:59:00Z"))
        assertEquals(instant, EventTime.parse("2026-01-06T00:59:00+01:00"))
        assertNull(EventTime.parse("not a date"))
    }
}
