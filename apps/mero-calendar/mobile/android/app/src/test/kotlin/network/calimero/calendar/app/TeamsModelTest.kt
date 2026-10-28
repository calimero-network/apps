package network.calimero.calendar.app

import com.calimero.mero.app.AppNamespace
import com.calimero.mero.testkit.InMemoryAppBackend
import kotlinx.coroutines.test.runTest
import network.calimero.calendar.data.LocalNames
import network.calimero.calendar.data.MemoryKeyValueStore
import network.calimero.calendar.data.TeamInvites
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TeamsModelTest {
    private val names = LocalNames(MemoryKeyValueStore())

    @Test
    fun `lists the account's teams, named by the relay or this device`() =
        runTest {
            val backend = InMemoryAppBackend()
            val a = "a1".repeat(32)
            val b = "b2".repeat(32)
            backend.namespaces = listOf(AppNamespace(a, "Design", backend.applicationId), AppNamespace(b, null, backend.applicationId))
            names.setTeam(b, "Ops")
            val model = TeamsModel(backend, names)
            model.load()
            assertEquals(
                listOf("Design", "Ops"),
                model.state.value.teams
                    .map { it.name },
            )
            assertEquals(false, model.state.value.loading)
        }

    @Test
    fun `a relayless account is asked to join`() =
        runTest {
            val backend = InMemoryAppBackend().apply { hasRelay = false }
            val model = TeamsModel(backend, names)
            model.load()
            assertTrue(model.state.value.noRelay)
        }

    @Test
    fun `creating a team founds a namespace and remembers its name`() =
        runTest {
            val backend = InMemoryAppBackend()
            val model = TeamsModel(backend, names)
            val created = model.create("  Design team ")
            assertNull(created.warning)
            assertEquals("Design team", created.team.name)
            assertEquals("foundNamespace Design team", backend.log.first { it.startsWith("foundNamespace") })
            assertEquals(
                "Design team",
                model.state.value.teams
                    .single()
                    .name,
            )
        }

    @Test
    fun `a team the cloud will not host says so`() =
        runTest {
            val backend = InMemoryAppBackend().apply { haEnabled = false }
            val warning = TeamsModel(backend, names).create("Ops").warning
            assertTrue(warning!!.startsWith("Team created, but invitations will not work yet"))
        }

    @Test
    fun `invite links round-trip and join the team`() =
        runTest {
            val inviter = InMemoryAppBackend()
            val team = Team("c3".repeat(32), "Design", inviter.applicationId)
            val link = TeamsModel(inviter, names).inviteLink(team)
            assertTrue(link.startsWith("https://links.calimero.network/com.calimero.mero-calendar/join?invitation="))

            val parsed = TeamInvites.parse(link)!!
            assertEquals(team.id, parsed.namespaceId)
            assertEquals("Design", parsed.teamName)

            val joinerNames = LocalNames(MemoryKeyValueStore())
            val joiner = InMemoryAppBackend(account = "cd".repeat(32)).apply { hasRelay = false }
            val model = TeamsModel(joiner, joinerNames)
            assertEquals(team.id, model.join(link))
            assertTrue(joiner.hasRelay)
            assertEquals("Design", joinerNames.team(team.id))
            assertTrue(team.id in model.justJoined)
        }

    @Test(expected = IllegalArgumentException::class)
    fun `another app's link is refused`() =
        runTest {
            val inviter = InMemoryAppBackend()
            val link = TeamsModel(inviter, names).inviteLink(Team("c3".repeat(32), "Design", "")).replace("com.calimero.mero-calendar", "com.calimero.chat")
            TeamsModel(InMemoryAppBackend(), names).join(link)
        }
}
