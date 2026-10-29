package network.calimero.calendar.data

import com.calimero.mero.app.ContextContractCalling
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import network.calimero.calendar.generated.CalendarClient
import network.calimero.calendar.generated.CreateCalendarEvent
import org.junit.Assert.assertEquals
import org.junit.Test

class HexIdTransportTest {
    private val owner = "0a".repeat(32)
    private val peer = "ff".repeat(32)

    private class Fake(
        val answer: String,
    ) : ContextContractCalling {
        val sent = mutableListOf<Pair<String, String>>()

        override suspend fun query(
            method: String,
            argsJson: String,
        ): String {
            sent += method to argsJson
            return answer
        }

        override suspend fun execute(
            method: String,
            argsJson: String,
        ): String {
            sent += method to argsJson
            return answer
        }
    }

    @Test
    fun `get_events decodes hex owners and peers through the generated client`() =
        runTest {
            val wire =
                """[{"id":"e1","title":"Standup","description":"","owner":"$owner","start":"s","end":"e",
                "event_type":"event","color":"#3b6fe0","peers":["$peer"],"private":false}]"""
            val client = CalendarClient(HexIdTransport(Fake(wire)))
            val event = client.getEvents().single()
            assertEquals(owner, HexIdTransport.hexOf(event.owner))
            assertEquals(listOf(peer), event.peers.map(HexIdTransport::hexOf))
        }

    @Test
    fun `event writes send peers as hex`() =
        runTest {
            val fake = Fake("\"e9\"")
            val id =
                CalendarClient(HexIdTransport(fake)).createEvent(
                    CreateCalendarEvent("t", "", "s", "e", "event", "#3b6fe0", listOf(HexIdTransport.bytesOf(peer))),
                    1_761_650_000_000uL,
                )
            assertEquals("e9", id)
            val (method, args) = fake.sent.single()
            assertEquals("create_event", method)
            val obj = Json.parseToJsonElement(args).jsonObject
            assertEquals(
                peer,
                obj["event_data"]!!
                    .jsonObject["peers"]!!
                    .jsonArray
                    .single()
                    .jsonPrimitive.content,
            )
            // Untouched numbers keep their literal digits.
            assertEquals("1761650000000", obj["timestamp"]!!.jsonPrimitive.content)
        }

    @Test
    fun `other calls pass through unchanged`() =
        runTest {
            val members = """[{"id":"$owner","username":"Ana","joinedAt":1761650000000123456,"usernameUpdatedAt":1}]"""
            val fake = Fake(members)
            val got = CalendarClient(HexIdTransport(fake)).getMembers().single()
            assertEquals(1_761_650_000_000_123_456uL, got.joinedAt)
            assertEquals("Ana", got.username)
        }
}
