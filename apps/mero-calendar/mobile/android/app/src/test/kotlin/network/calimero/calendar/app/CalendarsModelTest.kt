package network.calimero.calendar.app

import com.calimero.mero.app.AppSubgroup
import com.calimero.mero.testkit.InMemoryAppBackend
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import network.calimero.calendar.data.LocalNames
import network.calimero.calendar.data.MemoryKeyValueStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CalendarsModelTest {
    private val names = LocalNames(MemoryKeyValueStore())
    private val nsId = "aa".repeat(32)

    @Test
    fun `lists each subgroup's calendar and the team's own contexts`() =
        runTest {
            val backend = InMemoryAppBackend()
            val cal1 = "c1".repeat(32)
            val cal2 = "c2".repeat(32)
            val root = "c3".repeat(32)
            backend.subgroups = mapOf(nsId to listOf(AppSubgroup("g1".repeat(32), "Release", listOf(cal1)), AppSubgroup("g2".repeat(32), null, listOf(cal2))))
            backend.rootContexts = mapOf(nsId to listOf(root))
            names.setCalendar(cal2, "Holidays")
            val model = CalendarsModel(backend, Team(nsId, "Design", backend.applicationId), names)
            model.load()
            assertEquals(
                listOf("Release", "Holidays", "Calendar c3c3c3"),
                model.state.value.calendars
                    .map { it.name },
            )
        }

    @Test
    fun `creating a calendar makes an open subgroup with the contract's context in it`() =
        runTest {
            val backend = InMemoryAppBackend()
            val team = Team(backend.foundNamespace("Design").namespaceId, "Design", backend.applicationId)
            val model = CalendarsModel(backend, team, names)
            val ref = model.create("")
            assertEquals("Design", ref.name)
            assertTrue(ref.groupId in backend.publicSubgroups)
            assertEquals(JsonObject(emptyMap()), backend.initArgs[ref.contextId])
            assertEquals("Design", names.calendar(ref.contextId))
            assertTrue(backend.log.any { it.startsWith("createContext") })
        }

    @Test
    fun `opening joins a calendar the account is not in, retrying refusals`() =
        runTest {
            val backend = InMemoryAppBackend()
            val ctx = "c9".repeat(32)
            var now = 0L
            var attempts = 0
            val model =
                CalendarsModel(
                    backend,
                    Team(nsId, "Design", backend.applicationId),
                    names,
                    clock = { now },
                    sleep = {
                        now += it
                        attempts++
                        if (attempts == 2) backend.failure = null
                    },
                )
            backend.failure = IllegalStateException("not synced yet")
            model.open(CalendarRef(ctx, "g", "Release"))
            assertTrue(ctx in backend.members)
            assertEquals(null, model.state.value.opening)
        }

    @Test(expected = IllegalStateException::class)
    fun `opening gives up after the settle window`() =
        runTest {
            val backend = InMemoryAppBackend().apply { failure = IllegalStateException("refused") }
            var now = 0L
            val model = CalendarsModel(backend, Team(nsId, "Design", ""), names, clock = { now }, sleep = { now += it })
            model.open(CalendarRef("c8".repeat(32), "g", "x"))
        }
}
