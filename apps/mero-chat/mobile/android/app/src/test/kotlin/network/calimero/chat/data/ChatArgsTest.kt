package network.calimero.chat.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Argument objects, key for key against what the web app sends (clientApiDataSource.ts,
 * ChatContainer.tsx, createChannel.ts) and the contract's parameter names (lib.rs). An optional
 * argument the web leaves `undefined` is absent here too.
 */
class ChatArgsTest {
    private fun assertJson(
        expected: String,
        actual: JsonObject,
    ) = assertEquals(Json.parseToJsonElement(expected), actual)

    @Test
    fun `get_messages asks for the newest page the way the web app does`() {
        assertJson("""{"limit":20,"offset":0}""", ChatArgs.getMessages())
        assertJson("""{"limit":20,"offset":40}""", ChatArgs.getMessages(offset = 40))
    }

    @Test
    fun `get_messages carries a thread parent and a search term only when given`() {
        assertJson(
            """{"parent_message":"m_1","limit":10,"offset":0,"search_term":"cat"}""",
            ChatArgs.getMessages(limit = 10, parentMessage = "m_1", searchTerm = "cat"),
        )
        assertJson("""{"limit":20,"offset":0}""", ChatArgs.getMessages(searchTerm = ""))
    }

    @Test
    fun `get_messages_from takes an absolute start and a limit`() {
        assertJson("""{"start":20,"limit":20}""", ChatArgs.getMessagesFrom(20, 20))
    }

    @Test
    fun `send_message has the required vectors and a timestamp in seconds, and nothing else`() {
        assertJson(
            """{"message":"hi","mentions":[],"mentions_usernames":[],"timestamp":1760900000}""",
            ChatArgs.sendMessage("hi", 1_760_900_000),
        )
        assertJson(
            """{"message":"hi @alice","mentions":["9xQe"],"mentions_usernames":["alice"],"parent_message":"p_1","timestamp":1}""",
            ChatArgs.sendMessage("hi @alice", 1, mentions = listOf("9xQe"), mentionUsernames = listOf("alice"), parentMessage = "p_1"),
        )
    }

    @Test
    fun `edit, delete and react name the message the way the contract does`() {
        assertJson("""{"message_id":"m_1","new_message":"fixed","timestamp":5}""", ChatArgs.editMessage("m_1", "fixed", 5))
        assertJson("""{"message_id":"m_1","new_message":"fixed","timestamp":5,"parent_id":"p"}""", ChatArgs.editMessage("m_1", "fixed", 5, "p"))
        assertJson("""{"message_id":"m_1"}""", ChatArgs.deleteMessage("m_1"))
        assertJson("""{"message_id":"m_1","parent_id":"p"}""", ChatArgs.deleteMessage("m_1", "p"))
        assertJson("""{"message_id":"m_1","emoji":"👍","add":true}""", ChatArgs.updateReaction("m_1", "👍", true))
        assertJson("""{"message_id":"m_1","emoji":"👍","add":false}""", ChatArgs.updateReaction("m_1", "👍", false))
    }

    @Test
    fun `set_profile sends an explicit null avatar, mark_as_read a timestamp`() {
        assertJson("""{"username":"droid","avatar":null}""", ChatArgs.setProfile("droid"))
        assertJson("""{"timestamp":1760900000}""", ChatArgs.markAsRead(1_760_900_000))
        assertJson("{}", ChatArgs.none())
    }

    @Test
    fun `a channel is initialised with init's five arguments, as UTF-8 JSON bytes`() {
        val init = ChatArgs.channelInit("général", 1_760_900_000, "droid")
        assertJson(
            """{"name":"général","context_type":"Channel","description":"","created_at":1760900000,"creator_username":"droid"}""",
            init,
        )
        val bytes = initBytes(init)
        assertEquals(init.toString(), ByteArray(bytes.size) { bytes[it].toByte() }.toString(Charsets.UTF_8))
        assert(bytes.all { it in 0..255 })
    }

    @Test
    fun `inputs the contract would refuse are caught before anything is sent`() {
        assertNotNull(ChatValidation.messageError("   "))
        assertNotNull(ChatValidation.messageError("x".repeat(ChatArgs.MAX_MESSAGE_BYTES + 1)))
        assertNull(ChatValidation.messageError("hello"))
        assertNotNull(ChatValidation.usernameError(""))
        assertNotNull(ChatValidation.usernameError("n".repeat(51)))
        assertNull(ChatValidation.usernameError("droid"))
        assertNotNull(ChatValidation.channelNameError("é".repeat(33)))
        assertNull(ChatValidation.channelNameError("random"))
        assertNotNull(ChatValidation.emojiError(""))
        assertNotNull(ChatValidation.emojiError("a\u001fb"))
        assertNull(ChatValidation.emojiError("🎉"))
    }
}
