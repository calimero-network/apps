package network.calimero.chat.data

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What [ChatRepository] sends through the generated client, key for key against the component ABI
 * (`logic/res/abi.json`) and what the web app sends (`src/api/meroChat.ts`): camelCase names, `u64`s
 * as decimal strings, an optional the app leaves unset as `null` (the contract reads it as `None`).
 */
class ChatArgsTest {
    private val contract = RecordingChatContract()
    private val repo = ChatRepository(TestChatBackend(contract), nowSecs = { 1_760_900_000 })

    private fun assertJson(
        expected: String,
        actual: JsonObject,
    ) = assertEquals(Json.parseToJsonElement(expected), actual)

    private fun answering(block: (String) -> JsonElement) {
        contract.answer = { method, _ -> block(method) }
    }

    @Test
    fun `getMessages asks for the newest page the way the web app does`() =
        runBlocking {
            answering { ChatAbi.page(ChatMessagePage()) }
            repo.newestMessages("ctx")
            assertJson("""{"parentMessage":null,"limit":20,"offset":0,"searchTerm":null}""", contract.last("getMessages"))
            repo.newestMessages("ctx", limit = 10)
            assertJson("""{"parentMessage":null,"limit":10,"offset":0,"searchTerm":null}""", contract.last("getMessages"))
            assertTrue(contract.calls.all { it.isView })
        }

    @Test
    fun `getMessagesFrom takes an absolute start as a u64 and a limit`() =
        runBlocking {
            answering { ChatAbi.page(ChatMessagePage()) }
            repo.messagesFrom("ctx", 20, 20)
            assertJson("""{"start":"20","limit":20}""", contract.last("getMessagesFrom"))
            repo.messagesFrom("ctx", -1, 5)
            assertJson("""{"start":"0","limit":5}""", contract.last("getMessagesFrom"))
        }

    @Test
    fun `sendMessage has the required vectors and a timestamp in seconds, the rest unset`() =
        runBlocking {
            answering { ChatAbi.messageJson(ChatMessage(id = "m_1", text = "hi")) }
            val sent = repo.send("ctx", "hi")
            assertJson(
                """{"message":"hi","mentions":[],"mentionsUsernames":[],"parentMessage":null,"timestamp":"1760900000","files":null,"images":null}""",
                contract.last("sendMessage"),
            )
            assertEquals("m_1", sent?.id)
            assertTrue(contract.calls.none { it.isView })
        }

    @Test
    fun `a sent message whose answer cannot be read still counts as sent`() =
        runBlocking {
            answering { JsonPrimitive("ok") }
            assertNull(repo.send("ctx", "hi"))
            assertEquals(listOf("sendMessage"), contract.methods())
        }

    @Test
    fun `edit, delete and react name the message the way the contract does`() =
        runBlocking {
            answering { if (it == "editMessage") ChatAbi.messageJson(ChatMessage(id = "m_1", text = "fixed")) else JsonPrimitive("ok") }
            repo.edit("ctx", "m_1", "fixed")
            assertJson("""{"messageId":"m_1","newMessage":"fixed","timestamp":"1760900000","parentId":null}""", contract.last("editMessage"))
            repo.delete("ctx", "m_1")
            assertJson("""{"messageId":"m_1","parentId":null}""", contract.last("deleteMessage"))
            repo.react("ctx", "m_1", "👍", add = true)
            assertJson("""{"messageId":"m_1","emoji":"👍","add":true}""", contract.last("updateReaction"))
            repo.react("ctx", "m_1", "👍", add = false)
            assertJson("""{"messageId":"m_1","emoji":"👍","add":false}""", contract.last("updateReaction"))
        }

    @Test
    fun `setProfile sends an explicit null avatar, markAsRead a timestamp`() =
        runBlocking {
            repo.setProfile("ctx", " droid ")
            assertJson("""{"username":"droid","avatar":null}""", contract.last("setProfile"))
            repo.markRead("ctx")
            assertJson("""{"timestamp":"1760900000"}""", contract.last("markAsRead"))
        }

    @Test
    fun `the argument-less views send an empty object`() =
        runBlocking {
            answering { method ->
                when (method) {
                    "getUnreadCount" -> JsonPrimitive(3)
                    "getProfiles" -> ChatAbi.profiles(emptyList())
                    else -> error(method)
                }
            }
            assertEquals(3, repo.unreadCount("ctx"))
            assertEquals(emptyList<ChatProfile>(), repo.profiles("ctx"))
            assertEquals(listOf("getUnreadCount", "getProfiles"), contract.methods())
            assertTrue(contract.calls.all { it.args.isEmpty() && it.isView })
        }

    /** The component `init`'s names, as the web's `initArgsFrom` sends them. */
    @Test
    fun `a channel is initialised with the component init's arguments`() {
        assertJson(
            """{"name":"général","contextType":"Channel","description":"","creatorUsername":"droid"}""",
            ChatArgs.channelInit("général", "droid"),
        )
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

    @Test
    fun `a refused input is not sent`() =
        runBlocking {
            assertTrue(runCatching { repo.send("ctx", "   ") }.isFailure)
            assertTrue(runCatching { repo.react("ctx", "m_1", "", add = true) }.isFailure)
            assertTrue(contract.calls.isEmpty())
        }
}
