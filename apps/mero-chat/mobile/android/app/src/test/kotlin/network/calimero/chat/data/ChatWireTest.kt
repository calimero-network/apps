package network.calimero.chat.data

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Contract outputs (fixtures in the shape serde writes them) decode into the app's models. */
class ChatWireTest {
    private val me = "MeMeMeMeMeMeMeMeMeMeMeMeMeMeMeMeMeMeMeMeMeMe"

    private fun fixture(name: String): String =
        checkNotNull(javaClass.getResource("/fixtures/$name")).readText().replace("{{ME}}", me)

    @Test
    fun `a get_messages page decodes, reactions, attachments, edits and threads included`() {
        val page = chatJson.decodeFromString(ChatMessagePage.serializer(), fixture("get_messages.json"))
        assertEquals(42L, page.totalCount)
        assertEquals(0L, page.startPosition)
        assertEquals(listOf(40L, 41L), page.messages.map { it.index })

        val first = page.messages[0]
        assertEquals("hello from the web", first.text)
        assertEquals("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", first.sender)
        assertEquals(1_760_800_000L, first.timestamp)
        assertEquals(listOf("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", me), first.reactions!!["👍"])
        assertEquals("cat.png", first.images.single().name)
        assertEquals(1_760_800_000_123_456_789L, first.images.single().uploadedAt)
        assertEquals(2, first.threadCount)
        assertFalse(first.isDeleted)
        assertFalse(first.isEdited)

        val second = page.messages[1]
        assertTrue(second.isEdited)
        assertEquals(1_760_800_300L, second.editedOn)
        assertTrue(second.reactions!!.isEmpty())
    }

    @Test
    fun `a deleted message comes back blank with no reactions`() {
        val page = chatJson.decodeFromString(ChatMessagePage.serializer(), fixture("get_messages_from.json"))
        assertEquals(20L, page.startPosition)
        val deleted = page.messages.single { it.index == 21L }
        assertTrue(deleted.isDeleted)
        assertEquals("", deleted.text)
        assertNull(deleted.reactions)
    }

    @Test
    fun `send_message's Message (no index, no reactions) decodes too`() {
        val sent = chatJson.decodeFromString(ChatMessage.serializer(), fixture("send_message.json"))
        assertEquals("sent from Android", sent.text)
        assertEquals(me, sent.sender)
        assertEquals(0L, sent.index)
        assertNull(sent.reactions)
    }

    @Test
    fun `get_info and get_profiles decode`() {
        val info = chatJson.decodeFromString(ChatContextInfo.serializer(), fixture("get_info.json"))
        assertEquals("general", info.name)
        assertFalse(info.isDm)
        assertTrue(chatJson.decodeFromString(ChatContextInfo.serializer(), """{"name":"x","context_type":"Dm"}""").isDm)

        val profiles = chatJson.decodeFromString(ListSerializer(ChatProfile.serializer()), fixture("get_profiles.json"))
        assertEquals(mapOf("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" to "alice", me to "droid"), profiles.associate { it.identity to it.username })
    }

    @Test
    fun `fields a newer contract adds are ignored`() {
        val json = """{"total_count":1,"messages":[{"index":0,"id":"a_1","text":"t","sender":"s","timestamp":1,"brand_new":true}],"start_position":0,"cursor":"x"}"""
        assertEquals(
            "t",
            chatJson
                .decodeFromString(ChatMessagePage.serializer(), json)
                .messages
                .single()
                .text,
        )
        // Sanity: a strict decoder would have refused it.
        assertTrue(runCatching { Json.decodeFromString(ChatMessagePage.serializer(), json) }.isFailure)
    }
}
