package network.calimero.standup

import com.calimero.mero.app.AppContextEvent
import com.calimero.mero.app.AppNamespace
import com.calimero.mero.testkit.InMemoryAppBackend
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import network.calimero.standup.app.BoardModel
import network.calimero.standup.app.DecisionsModel
import network.calimero.standup.app.TeamsModel
import network.calimero.standup.app.WeekModel
import network.calimero.standup.contract.HelpView
import network.calimero.standup.contract.TagCount
import network.calimero.standup.core.DecisionDraft
import network.calimero.standup.core.StandupInvitation
import network.calimero.standup.core.UpdateDraft
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ModelsTest {
    private fun args(
        backend: InMemoryAppBackend,
        method: String,
    ): JsonObject =
        backend.recording
            .calls(method)
            .last()
            .args as JsonObject

    @Test
    fun `teams model starts a team in the namespace root and names it`() =
        runTest {
            val script = Script()
            val backend = backendWith(script)
            val model = TeamsModel(backend, applicationId = null)
            val team = model.create("  Platform ")!!
            assertEquals("foundNamespace Platform", backend.log.first())
            assertTrue(backend.log.any { it.startsWith("createContext ${team.namespaceId} ${backend.applicationId} Platform") })
            assertEquals(listOf(team.contextId), backend.rootContexts[team.namespaceId])
            assertEquals(JsonObject(emptyMap()), backend.initArgs[team.contextId])
            val named = backend.recording.calls("setTeamName").single()
            assertEquals(team.contextId, named.contextId)
            assertEquals(JsonPrimitive("Platform"), (named.args as JsonObject)["name"])
            assertEquals(listOf(team), model.teams.value)
        }

    @Test
    fun `teams model lists contexts with their names, and joins`() =
        runTest {
            val script = Script()
            val backend = backendWith(script)
            backend.namespaces = listOf(AppNamespace("ns1", "Space", backend.applicationId))
            backend.rootContexts = mapOf("ns1" to listOf("c1"))
            val model = TeamsModel(backend, backend.applicationId)
            model.load()
            assertEquals(
                "Platform",
                model.teams.value
                    .single()
                    .name,
            )
            assertNull(model.error.value)

            val ns = "cd".repeat(32)
            val team = model.join(StandupInvitation(InMemoryAppBackend.invitation(ns), "joined-ctx"))
            assertEquals("joined-ctx", team?.contextId)
            assertTrue(backend.log.contains("joinNamespace $ns"))

            backend.failure = java.io.IOException("offline")
            model.load()
            assertNotNull(model.error.value)
        }

    @Test
    fun `relayless account lists nothing and loads`() =
        runTest {
            val backend = backendWith(Script())
            backend.hasRelay = false
            val model = TeamsModel(backend, null)
            model.load()
            assertTrue(model.hasLoaded.value)
            assertTrue(model.teams.value.isEmpty())
            assertFalse(model.hasRelay)
        }

    @Test
    fun `board splits mine and others, waits, and carries forward`() =
        runTest {
            val script = Script()
            script.days["2026-10-28"] = listOf(update(ANA, "2026-10-28", name = "Ana", blockers = "CI down"))
            script.days["2026-10-27"] = listOf(update(ME, "2026-10-27", next = "write tests", blockers = "review"))
            val backend = backendWith(script)
            val team = teamOn(backend)
            val board = BoardModel(team, clock)
            board.load()
            assertEquals(ME, team.me.value)
            assertNull(board.mine)
            assertEquals(listOf(ANA), board.others.map { it.author })
            assertEquals(listOf(BO, ME), board.waiting.map { it.account }.sorted())
            assertEquals(UpdateDraft(done = "write tests", blockers = "review"), board.draft)
            assertEquals("2026-10-27", board.carriedFrom)
            assertEquals(1 to true, board.summary("2026-10-28"))
            assertEquals("2026-10-26", args(backend, "getWeek")["start"].let { (it as JsonPrimitive).content })
            assertEquals("2026-10-28", (args(backend, "listDecisions")["fromDay"] as JsonPrimitive).content)

            board.post(UpdateDraft("a", "b", ""))
            val post = args(backend, "postUpdate")
            assertEquals(listOf("day", "done", "next", "blockers"), post.keys.toList())
            assertEquals("2026-10-28", (post["day"] as JsonPrimitive).content)
            assertEquals(1, team.version.value)

            board.select("2026-10-29")
            assertEquals("2026-10-28", board.day.value)
            board.select("2026-10-27")
            assertEquals("2026-10-27", board.day.value)
            assertEquals(ME, board.mine?.author)
            assertTrue(board.waiting.isEmpty())
        }

    @Test
    fun `board help offers and withdrawals`() =
        runTest {
            val script = Script()
            val blocked = update(ANA, "2026-10-28", blockers = "CI", helpers = listOf(HelpView(ME, "Me", "", 1uL)))
            script.days["2026-10-28"] = listOf(blocked)
            val backend = backendWith(script)
            val board = BoardModel(teamOn(backend), clock)
            board.load()
            assertTrue(board.offered(blocked))
            board.offerHelp(blocked, "  pairing ")
            assertEquals(JsonPrimitive("pairing"), args(backend, "offerHelp")["note"])
            board.withdrawHelp(blocked)
            assertEquals(JsonPrimitive(ANA), args(backend, "withdrawHelp")["author"])
            board.withdraw()
            assertEquals(JsonPrimitive("2026-10-28"), args(backend, "clearUpdate")["day"])
        }

    @Test
    fun `week model reads a week and stops at this one`() =
        runTest {
            val script = Script()
            script.days["2026-10-27"] = listOf(update(ANA, "2026-10-27", name = "Ana"))
            val backend = backendWith(script)
            val week = WeekModel(teamOn(backend), clock)
            week.load()
            assertTrue(week.isThisWeek)
            assertEquals(listOf("Ana"), week.people.map { it.name })
            week.shift(1)
            assertEquals("2026-10-26", week.start.value)
            week.shift(-1)
            assertEquals("2026-10-19", week.start.value)
            assertTrue(week.people.isEmpty())
        }

    @Test
    fun `decisions model filters, pages and logs with the web's argument shape`() =
        runTest {
            val script = Script()
            script.decisions = listOf(decision("d2", "New", createdAt = 1_790_000_000_000_000_000uL), decision("d1", "Old", supersededBy = "d2"))
            script.nextCursor = "d1"
            script.tags = listOf(TagCount("infra", 2u))
            val backend = backendWith(script)
            val model = DecisionsModel(teamOn(backend), java.time.ZoneOffset.UTC)
            model.load()
            assertEquals(2, model.items.value.size)
            assertTrue(model.hasMore.value)
            val first = args(backend, "listDecisions")
            // Unknown keys are refused by the component contract; absent options go as null, as the web app sends them.
            assertEquals(setOf("search", "tag", "fromDay", "standingOnly", "cursor", "limit"), first.keys)
            assertEquals(JsonNull, first["search"])
            assertEquals("25", (first["limit"] as JsonPrimitive).content)

            model.showOlder()
            assertEquals("50", (args(backend, "listDecisions")["limit"] as JsonPrimitive).content)
            model.search.value = " ship "
            model.toggleTag("infra")
            val filtered = args(backend, "listDecisions")
            assertEquals(JsonPrimitive("ship"), filtered["search"])
            assertEquals(JsonPrimitive("infra"), filtered["tag"])
            assertEquals("25", (filtered["limit"] as JsonPrimitive).content)
            assertTrue(model.isFiltered)
            assertEquals("New", model.title("d2"))
            assertEquals(1, model.months.size)

            val id = model.log(DecisionDraft(title = " Ship ", decision = "Weekly", tagsInput = "Release Process, infra", with = setOf(BO, ANA), fromDay = "2026-10-28", supersedes = model.items.value[0]))
            assertEquals("new-id", id)
            val logged = args(backend, "logDecision")
            assertEquals(JsonPrimitive("Ship"), logged["title"])
            assertEquals(JsonPrimitive("d2"), logged["supersedes"])
            assertEquals(JsonPrimitive("2026-10-28"), logged["fromDay"])
            assertEquals("[\"infra\",\"release-process\"]", logged["tags"].toString())
            assertEquals("[\"$ANA\",\"$BO\"]", logged["with"].toString())

            model.log(DecisionDraft(title = "T", decision = "D"))
            val plain = args(backend, "logDecision")
            assertEquals(JsonNull, plain["supersedes"])
            assertEquals(JsonNull, plain["fromDay"])
        }

    @Test
    fun `team model reads identity, renames and follows events`() =
        runTest {
            val script = Script()
            val backend = backendWith(script)
            val team = teamOn(backend)
            team.load()
            assertEquals("Me", team.myName.value)
            assertEquals("You", team.name(ME, "Me"))
            assertEquals("Ana", team.name(ANA, ""))
            assertFalse(team.needsName)
            team.renameTeam(" Core ")
            assertEquals("Core", team.teamName.value)
            assertEquals(JsonPrimitive("Core"), args(backend, "setTeamName")["name"])

            val link = team.inviteLink()
            assertEquals("ctx", StandupInvitation.parse(link)?.contextId)

            team.pollWithStreamMs = 60_000
            val start = team.version.value
            withContext(Dispatchers.Default) {
                val job = launch { team.follow() }
                withTimeout(5_000) { while (backend.subscriberCount == 0) kotlinx.coroutines.delay(10) }
                backend.emit(AppContextEvent("ctx", "StateMutation"))
                backend.emit(AppContextEvent("ctx", "StateMutation"))
                withTimeout(5_000) { while (team.version.value == start) kotlinx.coroutines.delay(10) }
                kotlinx.coroutines.delay(400)
                job.cancel()
            }
            assertEquals(start + 1, team.version.value)
        }
}
