package network.calimero.calendar.app

import com.calimero.mero.testkit.InMemoryAppBackend
import com.calimero.mero.testkit.RecordedContractCall
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import network.calimero.calendar.data.LocalNames
import network.calimero.calendar.data.MemoryKeyValueStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class CalendarModelTest {
    // Account ids, as a 1.0 node names them.
    private val me = "acc_me"
    private val alice = "acc_alice"
    private val zone = ZoneId.of("Europe/Berlin")
    private val store = MemoryKeyValueStore()
    private val names = LocalNames(store)
    private val team = Team("aa".repeat(32), "Design", "ap".repeat(32))
    private val calendar = CalendarRef("cc".repeat(32), "gg".repeat(32), "Release")

    private fun sharedEvent(
        id: String,
        owner: String,
        peers: List<String> = emptyList(),
        private: Boolean = false,
    ) = buildJsonObject {
        put("id", id)
        put("title", "Planning")
        put("description", "")
        put("owner", owner)
        put("start", "Wed Oct 28 2026 10:00:00 GMT+0100 (Central European Standard Time)")
        put("end", "Wed Oct 28 2026 11:00:00 GMT+0100 (Central European Standard Time)")
        put("event_type", "event")
        put("color", "#2aa775")
        put("peers", buildJsonArray { peers.forEach { add(JsonPrimitive(it)) } })
        put("private", private)
    }

    private fun backend(
        events: List<JsonElement> = emptyList(),
        mine: List<JsonElement> = emptyList(),
    ): InMemoryAppBackend {
        val backend = InMemoryAppBackend(account = me)
        backend.recording.handler = { call: RecordedContractCall ->
            when (call.method) {
                "getEvents" -> JsonArray(events)
                "getPrivateEvents" -> JsonArray(mine)
                "getMembers" ->
                    buildJsonArray {
                        add(
                            buildJsonObject {
                                put("id", alice)
                                put("username", "Alice")
                                put("joinedAt", "1761650000000000001")
                                put("usernameUpdatedAt", "1")
                            },
                        )
                    }
                "createEvent", "createPrivateEvent" -> JsonPrimitive("new-1")
                "updateEvent", "updatePrivateEvent", "deleteEvent", "deletePrivateEvent" -> call.args.jsonObject["eventId"]
                else -> JsonNull
            }
        }
        return backend
    }

    private fun model(backend: InMemoryAppBackend) = CalendarModel(backend, team, calendar, names, zone = zone)

    private fun draft(peers: List<String> = emptyList()) =
        network.calimero.calendar.data.EventDraft
            .newOn(LocalDate.of(2026, 10, 29))
            .copy(title = "Dentist", peers = peers)

    private fun arg(
        call: RecordedContractCall,
        vararg path: String,
    ): String {
        var e: JsonElement = call.args
        path.forEach { e = e.jsonObject[it]!! }
        return e.jsonPrimitive.content
    }

    @Test
    fun `loads shared and private events from the contract`() =
        runTest {
            val backend = backend(listOf(sharedEvent("s1", alice, listOf(me))), listOf(sharedEvent("p1", me, private = true)))
            val model = model(backend)
            model.load()
            val events = model.state.value.events
            assertEquals(2, events.size)
            val shared = events.single { it.id == "s1" }
            assertEquals(alice, shared.owner)
            assertEquals(listOf(me), shared.peers)
            assertFalse(shared.isPrivate)
            assertFalse(model.canEdit(shared))
            val mine = events.single { it.id == "p1" }
            assertTrue(mine.isPrivate)
            assertTrue(model.canEdit(mine))
            assertEquals("Alice", model.nameOf(alice))
            assertEquals(
                RecordedContractCall.Path.QUERY,
                backend.recording
                    .calls("getPrivateEvents")
                    .single()
                    .path,
            )
        }

    @Test
    fun `a private event goes to createPrivateEvent, a peerless one to createEvent`() =
        runTest {
            val backend = backend()
            val model = model(backend)
            model.save(null, draft())
            model.save(null, draft(listOf(alice)).withPrivate(true))
            // The contract keeps a peerless createEvent private itself.
            assertEquals(1, backend.recording.calls("createEvent").size)
            val call = backend.recording.calls("createPrivateEvent").single()
            assertEquals("Dentist", arg(call, "eventData", "title"))
            assertTrue(
                call.args.jsonObject["eventData"]!!
                    .jsonObject["peers"]!!
                    .jsonArray
                    .isEmpty(),
            )
        }

    @Test
    fun `an event with teammates goes to createEvent with account peers and no timestamp`() =
        runTest {
            val backend = backend()
            model(backend).save(null, draft(listOf(alice)))
            val call = backend.recording.calls("createEvent").single()
            assertEquals(RecordedContractCall.Path.EXECUTE, call.path)
            assertEquals(calendar.contextId, call.contextId)
            val data = call.args.jsonObject["eventData"]!!.jsonObject
            assertEquals(
                alice,
                data["peers"]!!
                    .jsonArray
                    .single()
                    .jsonPrimitive.content,
            )
            assertEquals("event", data["event_type"]!!.jsonPrimitive.content)
            assertEquals("Thu Oct 29 2026 09:00:00 GMT+0100 (Central European Standard Time)", data["start"]!!.jsonPrimitive.content)
            assertEquals(setOf("eventData"), call.args.jsonObject.keys)
        }

    @Test
    fun `editing and deleting go to the shared or the private methods`() =
        runTest {
            val backend = backend(listOf(sharedEvent("s1", me, listOf(alice))), listOf(sharedEvent("p1", me, private = true)))
            val model = model(backend)
            model.load()
            val shared =
                model.state.value.events
                    .single { it.id == "s1" }
            model.save(
                shared,
                network.calimero.calendar.data.EventDraft
                    .from(shared, zone)
                    .copy(title = "Moved"),
            )
            val update = backend.recording.calls("updateEvent").single()
            assertEquals("s1", arg(update, "eventId"))
            assertEquals("Moved", arg(update, "eventData", "title"))
            model.delete(shared)
            assertEquals("s1", arg(backend.recording.calls("deleteEvent").single(), "eventId"))

            // A private event that gains a teammate is promoted by updatePrivateEvent.
            val mine =
                model.state.value.events
                    .single { it.id == "p1" }
            model.save(
                mine,
                network.calimero.calendar.data.EventDraft
                    .from(mine, zone)
                    .withPrivate(false)
                    .copy(peers = listOf(alice)),
            )
            val promote = backend.recording.calls("updatePrivateEvent").single()
            assertEquals("p1", arg(promote, "eventId"))
            assertEquals(
                alice,
                promote.args.jsonObject["eventData"]!!
                    .jsonObject["peers"]!!
                    .jsonArray
                    .single()
                    .jsonPrimitive.content,
            )
            model.delete(mine)
            assertEquals("p1", arg(backend.recording.calls("deletePrivateEvent").single(), "eventId"))
            assertEquals(1, backend.recording.calls("deleteEvent").size)
        }

    @Test
    fun `a stored name is registered on open, otherwise it is asked for`() =
        runTest {
            val backend = backend()
            val model = model(backend)
            model.start()
            assertTrue(model.state.value.askName)
            assertTrue(backend.recording.calls("setUsername").isEmpty())
            model.saveName(" Bob ")
            assertFalse(model.state.value.askName)
            val call = backend.recording.calls("setUsername").single()
            assertEquals(
                "Bob",
                call.args.jsonObject["username"]!!
                    .jsonPrimitive.content,
            )

            val again = model(backend)
            again.start()
            assertFalse(again.state.value.askName)
            assertEquals(2, backend.recording.calls("setUsername").size)
            assertEquals("Bob", again.lastName)
        }

    @Test
    fun `navigation steps by the mode's period`() {
        val model = model(backend())
        model.select(LocalDate.of(2026, 10, 28))
        model.setMode(CalendarMode.WEEK)
        model.step(1)
        assertEquals(LocalDate.of(2026, 11, 4), model.state.value.selected)
        model.setMode(CalendarMode.MONTH)
        model.step(-1)
        assertEquals(LocalDate.of(2026, 10, 1), model.state.value.selected)
    }
}
