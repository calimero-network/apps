package network.calimero.chat.data

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The contract's answers (fixtures in the ABI's wire shape, named for their method) read by the
 * generated client and turned into the app's models by [ChatRepository].
 */
class ChatWireTest {
    private val me = "MeMeMeMeMeMeMeMeMeMeMeMeMeMeMeMeMeMeMeMeMeMe"

    private fun fixture(name: String): String = checkNotNull(javaClass.getResource("/fixtures/$name")).readText().replace("{{ME}}", me)

    /** A repository whose contract answers each method with `fixtures/<method>.json`, or with [override]. */
    private fun repo(override: Map<String, String> = emptyMap()): ChatRepository {
        val contract =
            RecordingChatContract { method, _ ->
                Json.parseToJsonElement(override[method] ?: fixture("$method.json"))
            }
        return ChatRepository(TestChatBackend(contract))
    }

    @Test
    fun `a getMessages page decodes, reactions, attachments, edits and threads included`() =
        runBlocking {
            val page = repo().newestMessages("ctx")
            assertEquals(42L, page.totalCount)
            assertEquals(0L, page.startPosition)
            assertEquals(listOf(40L, 41L), page.messages.map { it.index })

            val first = page.messages[0]
            assertEquals("hello from the web", first.text)
            assertEquals("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", first.sender)
            assertEquals(1_760_800_000L, first.timestamp)
            assertEquals(listOf("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", me), first.reactions!!["👍"])
            assertEquals("cat.png", first.images.single().name)
            assertEquals("image/png", first.images.single().mimeType)
            assertEquals(1_760_800_000_123_456_789L, first.images.single().uploadedAt)
            assertEquals(2, first.threadCount)
            assertEquals(1_760_800_100L, first.threadLastTimestamp)
            assertFalse(first.isDeleted)
            assertFalse(first.isEdited)

            val second = page.messages[1]
            assertTrue(second.isEdited)
            assertEquals(1_760_800_300L, second.editedOn)
            assertTrue(second.reactions!!.isEmpty())
        }

    @Test
    fun `a deleted message comes back blank with no reactions`() =
        runBlocking {
            val page = repo().messagesFrom("ctx", 20, 20)
            assertEquals(20L, page.startPosition)
            val deleted = page.messages.single { it.index == 21L }
            assertTrue(deleted.isDeleted)
            assertEquals("", deleted.text)
            assertNull(deleted.reactions)
        }

    @Test
    fun `sendMessage's answer is the stored message`() =
        runBlocking {
            val sent = repo().send("ctx", "sent from Android")!!
            assertEquals("sent from Android", sent.text)
            assertEquals(me, sent.sender)
            assertEquals(42L, sent.index)
            assertEquals(1_760_900_000L, sent.timestamp)
        }

    @Test
    fun `getInfo and getProfiles decode`() =
        runBlocking {
            val info = repo().info("ctx")
            assertEquals("general", info.name)
            assertEquals(1_760_600_000L, info.createdAt)
            assertFalse(info.isDm)
            val dm = """{"name":"x","contextType":"Dm","description":"","createdAt":"0","creator":"c"}"""
            assertTrue(repo(mapOf("getInfo" to dm)).info("ctx").isDm)

            val profiles = repo().profiles("ctx")
            assertEquals(mapOf("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" to "alice", me to "droid"), profiles.associate { it.identity to it.username })
        }

    @Test
    fun `fields a newer contract adds are ignored`() =
        runBlocking {
            val message = """{"index":"0","id":"a_1","text":"t","sender":"s","timestamp":"1","mentions":[],"mentionsUsernames":[],"files":[],"images":[],"threadCount":0,"threadLastTimestamp":"0","brandNew":true}"""
            val json = """{"totalCount":1,"messages":[$message],"startPosition":0,"cursor":"x"}"""
            assertEquals(
                "t",
                repo(mapOf("getMessages" to json))
                    .newestMessages("ctx")
                    .messages
                    .single()
                    .text,
            )
        }

    @Test
    fun `an answer this app cannot read names the method`() =
        runBlocking {
            val error = runCatching { repo(mapOf("getInfo" to """{"name":"x"}""")).info("ctx") }.exceptionOrNull()
            assertTrue(error is IllegalStateException)
            assertTrue(error!!.message!!.startsWith("getInfo answered something this app cannot read"))
        }
}
