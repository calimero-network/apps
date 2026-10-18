package network.calimero.chat.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The paging rules: by stable index, newest page first, older windows and gaps by absolute position. */
class MessageWindowTest {
    private fun msg(
        index: Long,
        text: String = "m$index",
    ) = ChatMessage(index = index, id = "id$index", text = text, timestamp = 1_000 + index)

    private fun range(
        from: Long,
        to: Long,
    ) = (from..to).map { msg(it) }

    @Test
    fun `merging keeps one entry per id, ascending by index, the fresher copy winning`() {
        val w = MessageWindow().merge(range(20, 39), total = 40)
        assertEquals(20L, w.oldestIndex)
        assertEquals(39L, w.newestIndex)
        assertEquals(40L, w.totalCount)

        val edited = w.merge(listOf(msg(25, "edited"), msg(40)), total = 41)
        assertEquals(21, edited.messages.size)
        assertEquals("edited", edited.messages.single { it.index == 25L }.text)
        assertEquals((20L..40L).toList(), edited.messages.map { it.index })
        assertEquals(41L, edited.totalCount)
    }

    @Test
    fun `older pages end where the window begins, and stop at the first message`() {
        val w = MessageWindow().merge(range(20, 39))
        assertEquals(RangeRequest(0, 20), w.olderRequest())
        assertEquals(RangeRequest(5, 15), MessageWindow().merge(range(20, 30)).olderRequest(pageSize = 15))
        assertEquals(RangeRequest(0, 5), MessageWindow().merge(range(5, 10)).olderRequest(pageSize = 20))
        assertNull(MessageWindow().merge(range(0, 10)).olderRequest())
        assertNull(MessageWindow().olderRequest())
        assertTrue(w.hasOlder)
        assertFalse(MessageWindow().merge(range(0, 3)).hasOlder)
    }

    @Test
    fun `a fresher page that does not touch the window leaves a gap to read`() {
        val w = MessageWindow().merge(range(20, 39))
        assertNull(w.gapBefore(range(30, 49)))
        assertNull(w.gapBefore(range(40, 59)))
        assertEquals(RangeRequest(40, 10), w.gapBefore(range(50, 69)))
        assertNull(MessageWindow().gapBefore(range(0, 19)))
        assertNull(w.gapBefore(emptyList()))
    }

    @Test
    fun `an empty page changes nothing but the count`() {
        val w = MessageWindow().merge(range(0, 2), total = 3)
        assertEquals(w.messages, w.merge(emptyList(), total = 3).messages)
        assertEquals(7L, w.merge(emptyList(), total = 7).totalCount)
    }
}
