package network.calimero.chat.app

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import network.calimero.chat.data.Channel
import network.calimero.chat.data.ChatRepository
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The open channel's logic: paging, catch-up, writes, reactions, live updates or polling. */
class ChannelModelTest {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val chat = InMemoryChat()
    private val repo = ChatRepository(chat, nowSecs = { 1_760_900_000 })
    private val channel = Channel("c".repeat(64), "g".repeat(64), "n".repeat(64), "general")

    @After
    fun tearDown() = scope.cancel()

    private fun model(pollMs: Long = 60_000) = ChannelModel(repo, scope, channel, pollIntervalMs = pollMs)

    private suspend fun eventually(check: () -> Boolean) =
        withTimeout(5_000) {
            while (!check()) delay(10)
        }

    @Test
    fun `opening reads the newest page, names senders and marks the channel read`() =
        runBlocking {
            repeat(45) { chat.post("m$it") }
            val m = model()
            m.start().join()
            m.stop()

            val s = m.state.value
            assertFalse(s.loading)
            assertEquals((25..44).map { "m$it" }, s.messages.map { it.message.text })
            assertTrue(s.hasOlder)
            assertEquals("alice", s.messages.first().author)
            assertEquals(listOf("get_messages", "get_profiles", "mark_as_read"), chat.methods())
            assertEquals(
                20,
                chat.calls[0]
                    .second["limit"]!!
                    .jsonPrimitive.int,
            )
            assertEquals(
                0,
                chat.calls[0]
                    .second["offset"]!!
                    .jsonPrimitive.int,
            )
        }

    @Test
    fun `scrolling back reads the window before the oldest message by absolute position`() =
        runBlocking {
            repeat(45) { chat.post("m$it") }
            val m = model()
            m.start().join()
            m.stop()

            m.loadOlder().join()
            val older = chat.calls.last { it.first == "get_messages_from" }.second
            assertEquals(5L, older["start"]!!.jsonPrimitive.long)
            assertEquals(20, older["limit"]!!.jsonPrimitive.int)
            assertEquals(40, m.state.value.messages.size)

            m.loadOlder().join()
            val first = chat.calls.last { it.first == "get_messages_from" }.second
            assertEquals(0L, first["start"]!!.jsonPrimitive.long)
            assertEquals(5, first["limit"]!!.jsonPrimitive.int)
            assertEquals(
                (0..44).map { "m$it" },
                m.state.value.messages
                    .map { it.message.text },
            )
            assertFalse(m.state.value.hasOlder)

            val calls = chat.calls.size
            m.loadOlder().join()
            assertEquals("nothing older to read", calls, chat.calls.size)
        }

    @Test
    fun `a refresh after more than a page arrived reads the gap, so nothing is skipped`() =
        runBlocking {
            repeat(10) { chat.post("m$it") }
            val m = model()
            m.start().join()
            m.stop()
            repeat(30) { chat.post("n$it") } // 10..39 arrive while away; the newest page is 20..39

            m.refreshNow()
            val gap = chat.calls.last { it.first == "get_messages_from" }.second
            assertEquals(10L, gap["start"]!!.jsonPrimitive.long)
            assertEquals(10, gap["limit"]!!.jsonPrimitive.int)
            assertEquals(40, m.state.value.messages.size)
            assertEquals(
                (0L..39L).toList(),
                m.state.value.messages
                    .map { it.message.index },
            )
        }

    @Test
    fun `far behind, the window restarts at the newest page instead of reading everything`() =
        runBlocking {
            repeat(5) { chat.post("m$it") }
            val m = model()
            m.start().join()
            m.stop()
            repeat(ChannelModel.MAX_CATCH_UP + 50) { chat.post("n$it") }

            m.refreshNow()
            assertTrue(chat.calls.none { it.first == "get_messages_from" })
            assertEquals(20, m.state.value.messages.size)
            assertTrue(m.state.value.hasOlder)
        }

    @Test
    fun `sending writes, then reads the message back as the account's own`() =
        runBlocking {
            chat.post("hello")
            val m = model()
            m.start().join()
            m.stop()

            m.send("hi from Android").join()
            val mine =
                m.state.value.messages
                    .last()
            assertEquals("hi from Android", mine.message.text)
            assertTrue(mine.mine)
            assertEquals("droid", mine.author)
            assertTrue(
                m.state.value.pending
                    .isEmpty(),
            )
            assertTrue("send_message" in chat.methods())

            val writes = chat.calls.size
            m.send("   ").join()
            assertEquals("a blank message is not sent", writes, chat.calls.size)
            assertNotNull(m.state.value.error)
        }

    @Test
    fun `a reaction toggles off when it is already the account's`() =
        runBlocking {
            chat.post("react to me")
            val m = model()
            m.start().join()
            m.stop()
            val id =
                m.state.value.messages
                    .single()
                    .id

            m.toggleReaction(id, "🎉").join()
            assertEquals(
                1,
                m.state.value.messages
                    .single()
                    .reactions
                    .single()
                    .count,
            )
            assertTrue(
                m.state.value.messages
                    .single()
                    .reactions
                    .single()
                    .mine,
            )
            assertTrue(
                chat.calls
                    .last { it.first == "update_reaction" }
                    .second["add"]!!
                    .jsonPrimitive.content == "true",
            )

            m.toggleReaction(id, "🎉").join()
            assertTrue(
                chat.calls
                    .last { it.first == "update_reaction" }
                    .second["add"]!!
                    .jsonPrimitive.content == "false",
            )
            assertTrue(
                m.state.value.messages
                    .single()
                    .reactions
                    .isEmpty(),
            )
        }

    @Test
    fun `only the account's own messages can be edited or deleted`() =
        runBlocking {
            chat.post("theirs")
            chat.post("mine", sender = chat.me)
            val m = model()
            m.start().join()
            m.stop()
            val (theirs, mine) = m.state.value.messages

            m.edit(theirs.id, "hijack").join()
            assertNotNull(m.state.value.error)
            assertTrue(chat.methods().none { it == "edit_message" })

            m.edit(mine.id, "mine, fixed").join()
            assertEquals(
                "mine, fixed",
                m.state.value.messages
                    .last()
                    .message.text,
            )
            assertTrue(
                m.state.value.messages
                    .last()
                    .message.isEdited,
            )
            m.delete(mine.id).join()
            assertTrue(
                m.state.value.messages
                    .last()
                    .message.isDeleted,
            )
        }

    @Test
    fun `live events trigger a re-read`() =
        runBlocking {
            val events = MutableSharedFlow<Unit>(extraBufferCapacity = 8)
            chat.live = events
            chat.post("first")
            val m = model()
            m.start().join()
            eventually { m.state.value.live == LiveMode.STREAM }

            chat.post("second")
            eventually { events.subscriptionCount.value > 0 }
            events.emit(Unit)
            eventually { m.state.value.messages.size == 2 }
            m.stop()
            assertEquals(LiveMode.OFF, m.state.value.live)
        }

    @Test
    fun `without a live stream the channel polls`() =
        runBlocking {
            chat.post("first")
            val m = model(pollMs = 20)
            m.start().join()
            eventually { m.state.value.live == LiveMode.POLLING }
            chat.post("second")
            eventually { m.state.value.messages.size == 2 }
            m.stop()
        }

    @Test
    fun `a failed read shows an error and leaves what was shown`() =
        runBlocking {
            chat.post("first")
            val m = model()
            m.start().join()
            m.stop()
            chat.failNext = IllegalStateException("relay down")
            m.refreshNow()
            assertNotNull(m.state.value.error)
            assertEquals(1, m.state.value.messages.size)
        }
}
