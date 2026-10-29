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
import network.calimero.calendar.data.PrivateEventStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class CalendarModelTest {
    private val me = "ab".repeat(32)
    private val alice = "a1".repeat(32)
    private val zone = ZoneId.of("Europe/Berlin")
    private val store = MemoryKeyValueStore()
    private val names = LocalNames(store)
    private val privateStore = PrivateEventStore(store)
    private val team = Team("aa".repeat(32), "Design", "ap".repeat(32))
    private val calendar = CalendarRef("cc".repeat(32), "gg".repeat(32), "Release")

    private fun sharedEvent(
        id: String,
        owner: String,
        peers: List<String> = emptyList(),
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
        put("private", false)
    }

    private fun backend(events: List<JsonElement> = emptyList()): InMemoryAppBackend {
        val backend = InMemoryAppBackend(account = me)
        backend.recording.handler = { call: RecordedContractCall ->
            when (call.method) {
                "get_events" -> JsonArray(events)
                "get_members" ->
                    buildJsonArray {
                        add(
                            buildJsonObject {
                                put("id", alice)
                                put("username", "Alice")
                                put("joinedAt", 1)
                                put("usernameUpdatedAt", 1)
                            },
                        )
                    }
                "create_event", "update_event", "delete_event" -> JsonPrimitive("shared-1")
                else -> JsonNull
            }
        }
        return backend
    }

    private fun model(backend: InMemoryAppBackend) = CalendarModel(backend, team, calendar, names, privateStore, zone = zone, now = { 1_761_650_000_000 })

    private fun draft(peers: List<String> = emptyList()) =
        network.calimero.calendar.data.EventDraft
            .newOn(LocalDate.of(2026, 10, 29))
            .copy(title = "Dentist", peers = peers)

    @Test
    fun `loads shared events with this device's private ones`() =
        runTest {
            val backend = backend(listOf(sharedEvent("s1", alice, listOf(me))))
            val model = model(backend)
            model.save(null, draft())
            val events = model.state.value.events
            assertEquals(2, events.size)
            val shared = events.single { it.id == "s1" }
            assertEquals(alice, shared.owner)
            assertEquals(listOf(me), shared.peers)
            assertFalse(model.canEdit(shared))
            val local = events.single { it.isLocal }
            assertTrue(local.isPrivate)
            assertTrue(model.canEdit(local))
            assertEquals("Alice", model.nameOf(alice))
        }

    @Test
    fun `a peerless or private event never reaches the contract`() =
        runTest {
            val backend = backend()
            val model = model(backend)
            model.save(null, draft())
            model.save(null, draft(listOf(alice)).withPrivate(true))
            assertTrue(backend.recording.calls.none { it.method.startsWith("create") })
            assertEquals(2, privateStore.list(privateStore.key(me, team.id), calendar.contextId).size)
        }

    @Test
    fun `an event with teammates goes to create_event with hex peers`() =
        runTest {
            val backend = backend()
            model(backend).save(null, draft(listOf(alice)))
            val call = backend.recording.calls("create_event").single()
            assertEquals(RecordedContractCall.Path.EXECUTE, call.path)
            assertEquals(calendar.contextId, call.contextId)
            val data = call.args.jsonObject["event_data"]!!.jsonObject
            assertEquals(
                alice,
                data["peers"]!!
                    .jsonArray
                    .single()
                    .jsonPrimitive.content,
            )
            assertEquals("Thu Oct 29 2026 09:00:00 GMT+0100 (Central European Standard Time)", data["start"]!!.jsonPrimitive.content)
            assertEquals(
                "1761650000000",
                call.args.jsonObject["timestamp"]!!
                    .jsonPrimitive.content,
            )
        }

    @Test
    fun `a private event that gains teammates is promoted to shared`() =
        runTest {
            val backend = backend()
            val model = model(backend)
            model.save(null, draft())
            val local =
                model.state.value.events
                    .single()
            model.save(local, draft(listOf(alice)))
            assertEquals(1, backend.recording.calls("create_event").size)
            assertTrue(privateStore.list(privateStore.key(me, team.id), calendar.contextId).isEmpty())
        }

    @Test
    fun `editing and deleting a shared event go to the contract, a private one stays here`() =
        runTest {
            val backend = backend(listOf(sharedEvent("s1", me, listOf(alice))))
            val model = model(backend)
            model.load()
            val shared =
                model.state.value.events
                    .single()
            model.save(
                shared,
                network.calimero.calendar.data.EventDraft
                    .from(shared, zone)
                    .copy(title = "Moved"),
            )
            val update = backend.recording.calls("update_event").single()
            assertEquals(
                "s1",
                update.args.jsonObject["event_id"]!!
                    .jsonPrimitive.content,
            )
            assertEquals(
                "Moved",
                update.args.jsonObject["event_data"]!!
                    .jsonObject["title"]!!
                    .jsonPrimitive.content,
            )
            model.delete(shared)
            assertEquals(
                "s1",
                backend.recording
                    .calls("delete_event")
                    .single()
                    .args.jsonObject["event_id"]!!
                    .jsonPrimitive.content,
            )

            model.save(null, draft())
            val local =
                model.state.value.events
                    .single { it.isLocal }
            model.save(
                local,
                network.calimero.calendar.data.EventDraft
                    .from(local, zone)
                    .copy(title = "Renamed"),
            )
            assertEquals(
                "Renamed",
                model.state.value.events
                    .single { it.isLocal }
                    .title,
            )
            model.delete(local)
            assertTrue(
                model.state.value.events
                    .none { it.isLocal },
            )
            assertTrue(backend.recording.calls("update_private_event").isEmpty())
        }

    @Test
    fun `a stored name is registered on open, otherwise it is asked for`() =
        runTest {
            val backend = backend()
            val model = model(backend)
            model.start()
            assertTrue(model.state.value.askName)
            assertTrue(backend.recording.calls("set_username").isEmpty())
            model.saveName(" Bob ")
            assertFalse(model.state.value.askName)
            val call = backend.recording.calls("set_username").single()
            assertEquals(
                "Bob",
                call.args.jsonObject["username"]!!
                    .jsonPrimitive.content,
            )

            val again = model(backend)
            again.start()
            assertFalse(again.state.value.askName)
            assertEquals(2, backend.recording.calls("set_username").size)
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
