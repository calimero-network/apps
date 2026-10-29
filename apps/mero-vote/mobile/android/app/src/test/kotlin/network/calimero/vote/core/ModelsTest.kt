package network.calimero.vote.core

import com.calimero.mero.app.AppNamespace
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import network.calimero.vote.generated.Identity
import network.calimero.vote.generated.Phase
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class GroupsModelTest {
    @Test
    fun `lists workspaces with their groups and poll counts`() =
        runTest {
            val (backend, script) = makeBackend()
            backend.namespaces = listOf(AppNamespace(NS, "Team", backend.applicationId))
            backend.rootContexts = mapOf(NS to listOf(CTX))
            script.on("list_polls") { listOf(summary("p1", Phase.Voting, 1uL), summary("p2", Phase.Closed, 5uL, "Newest")) }
            val model = GroupsModel(backend, backend.applicationId)
            model.load()
            assertEquals(LoadPhase.Loaded, model.phase.value)
            val row =
                model.sections.value
                    .single()
                    .groups
                    .single()
            assertEquals(CTX, row.ref.contextId)
            assertEquals(2, row.polls)
            assertEquals(1, row.open)
            assertEquals("Newest", row.latest)
            assertEquals("Team", row.ref.workspaceName)
        }

    @Test
    fun `a new workspace founds a namespace and puts a group directly in it`() =
        runTest {
            val (backend, _) = makeBackend()
            val model = GroupsModel(backend, backend.applicationId)
            val ref = model.createWorkspace("  Board ")
            assertEquals("Board", ref.workspaceName)
            assertTrue(backend.log.contains("foundNamespace Board"))
            assertEquals(JsonObject(emptyMap()), backend.initArgs[ref.contextId])
            assertEquals(listOf(ref.contextId), backend.rootContexts[ref.namespaceId])
            try {
                model.createWorkspace(" ")
                fail("a blank name is refused")
            } catch (e: VoteModelException) {
                assertEquals("Give the workspace a name.", e.message)
            }
        }

    @Test
    fun `another group goes into the same workspace`() =
        runTest {
            val (backend, _) = makeBackend()
            backend.namespaces = listOf(AppNamespace(NS, "Team", backend.applicationId))
            val model = GroupsModel(backend, "")
            model.load()
            val ref = model.createGroup(model.sections.value.single())
            assertEquals(NS, ref.namespaceId)
            assertEquals(listOf(ref.contextId), backend.rootContexts[NS])
        }
}

class GroupModelTest {
    @Test
    fun `refresh reads who you are, the roster and the polls, newest first`() =
        runTest {
            val (backend, script) = makeBackend()
            script.on("whoami") { Identity(ME) }
            script.on("roster") { listOf(member(BOB, "Bob")) }
            script.on("list_polls") { listOf(summary("old", createdAt = 1uL), summary("new", createdAt = 9uL)) }
            val model = GroupModel(backend, group())
            model.refresh()
            assertEquals(ME, model.me.value)
            assertEquals(listOf("new", "old"), model.polls.value.map { it.pollId })
            assertNull(model.myName)
            assertEquals("Bob", model.label(BOB))
            assertEquals(listOf(ME, BOB), model.people.map { it.account })
            assertEquals(
                CTX,
                backend.recording
                    .calls("whoami")
                    .single()
                    .contextId,
            )
        }

    @Test
    fun `set name joins the roster`() =
        runTest {
            val (backend, script) = makeBackend()
            script.on("whoami") { Identity(ME) }
            script.on("roster") { listOf(member(ME, "Ana")) }
            script.on("list_polls") { emptyList<String>() }
            val model = GroupModel(backend, group())
            model.setName(" Ana ")
            assertEquals(
                "Ana",
                backend.recording
                    .calls("set_name")
                    .single()
                    .string("name"),
            )
            assertEquals("Ana", model.myName)
        }

    @Test
    fun `create poll sends the frozen definition`() =
        runTest {
            val (backend, script) = makeBackend()
            script.on("whoami") { Identity(ME) }
            script.on("roster") { emptyList<String>() }
            script.on("list_polls") { emptyList<String>() }
            script.on("create_poll") { "poll-1" }
            val model = GroupModel(backend, group())
            val draft =
                PollDraft(ME, emptyList()).copy(
                    title = " Where? ",
                    options = listOf("Lisbon", " ", "Zagreb"),
                    trustees = setOf(ME, BOB, "c1".repeat(32)),
                )
            assertEquals(2, draft.threshold)
            assertEquals("poll-1", model.createPoll(draft))
            val call = backend.recording.calls("create_poll").single()
            assertEquals("Where?", call.string("title"))
            assertEquals(listOf("Lisbon", "Zagreb"), call.arg("options")!!.jsonArray.map { it.jsonPrimitive.content })
            assertEquals(1, call.arg("min_choices")!!.jsonPrimitive.int)
            assertEquals(1, call.arg("max_choices")!!.jsonPrimitive.int)
            assertEquals(2, call.arg("threshold")!!.jsonPrimitive.int)
            assertEquals(JsonArray(emptyList()), call.arg("voters"))

            val approval = draft.copy(mode = PollDraft.Mode.MULTI, maxChoices = 5, everyone = false, voters = setOf(BOB))
            model.createPoll(approval)
            val second = backend.recording.calls("create_poll").last()
            assertEquals(0, second.arg("min_choices")!!.jsonPrimitive.int)
            assertEquals(2, second.arg("max_choices")!!.jsonPrimitive.int)
            assertEquals(listOf(BOB), second.arg("voters")!!.jsonArray.map { it.jsonPrimitive.content })

            try {
                model.createPoll(draft.copy(options = listOf("A", "A")))
                fail("duplicate options are refused")
            } catch (e: VoteModelException) {
                assertEquals("Two options say the same thing.", e.message)
            }
        }

    @Test
    fun `trustee note warns as the web does`() {
        val solo = PollDraft(ME, emptyList())
        assertTrue(solo.trusteeNote(ME)!!.second)
        val all = solo.copy(trustees = setOf(ME, BOB), thresholdPick = 2)
        assertEquals("All 2 must take part to count: most private, least available." to false, all.trusteeNote(ME))
        assertEquals(true, all.copy(thresholdPick = 1).trusteeNote(ME)!!.second)
    }

    @Test
    fun `invite link carries the group and parses back`() =
        runTest {
            val (backend, _) = makeBackend()
            val link = GroupModel(backend, group()).inviteLink()
            assertTrue(link.startsWith("https://links.calimero.network/com.calimero.mero-vote/join?invitation="))
            val parsed = VoteInvitation.parse(link)
            assertNotNull(parsed)
            assertEquals(CTX, parsed!!.contextId)
            assertEquals(NS, parsed.namespaceId)
        }
}

class InvitationModelTest {
    private fun token(namespaceId: String = NS) =
        VoteInvitation(
            com.calimero.mero.testkit.InMemoryAppBackend
                .invitation(namespaceId),
            CTX,
        ).token()

    @Test
    fun `refuses another app's link and accepts this app's`() {
        val model = InvitationModel()
        assertFalse(model.open(InviteLink.invitation(token(), "com.calimero.mero-forum")))
        assertTrue(model.stage.value is InvitationModel.Stage.Failed)
        assertTrue(model.open(InviteLink.invitation(token(), VoteConstants.PACKAGE_NAME)))
        assertEquals(InvitationModel.Stage.Confirm, model.stage.value)
        assertTrue(model.open(token()))
        assertNull(VoteInvitation.parse("not an invitation"))
    }

    @Test
    fun `reads the web's payload`() {
        val json = InviteCodec.decode(token())!!
        assertTrue(json.contains("\"namespaceId\""))
        assertTrue(json.contains("\"contextId\""))
        assertEquals(CTX, VoteInvitation.parseJson(json)!!.contextId)
    }

    @Test
    fun `joins the workspace, then the group`() =
        runTest {
            val (backend, _) = makeBackend()
            backend.hasRelay = false
            val model = InvitationModel(retryDelayMs = 0)
            model.open(token())
            var joined = false
            model.accept(backend = { backend }, didJoin = { joined = true })
            assertTrue(joined)
            val stage = model.stage.value as InvitationModel.Stage.Joined
            assertEquals(GroupRef(NS, "Workspace", CTX), stage.group)
            val log = backend.log
            assertTrue(log.indexOf("joinNamespace $NS") < log.indexOf("joinContext $CTX"))
            assertTrue(CTX in backend.members)
        }

    @Test
    fun `a failed join says why`() =
        runTest {
            val (backend, _) = makeBackend()
            backend.failure = java.io.IOException("Couldn't reach the relay. Try again.")
            val model = InvitationModel(retryDelayMs = 0)
            model.open(token())
            model.accept(backend = { backend }, didJoin = {})
            assertEquals(InvitationModel.Stage.Failed("Couldn't reach the relay. Try again."), model.stage.value)
        }
}
