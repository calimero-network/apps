package network.calimero.crm

import com.calimero.mero.AppError
import com.calimero.mero.app.AppContextEvent
import com.calimero.mero.app.AppNamespace
import com.calimero.mero.app.SignedOutException
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.testkit.InMemoryAppBackend
import com.calimero.mero.testkit.RecordedContractCall
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import network.calimero.crm.app.LocalNames
import network.calimero.crm.app.MemoryStore
import network.calimero.crm.app.PipelineModel
import network.calimero.crm.app.WorkspacesModel
import network.calimero.crm.core.Account
import network.calimero.crm.core.ActivityDraft
import network.calimero.crm.core.ActivityKind
import network.calimero.crm.core.CrmInvitation
import network.calimero.crm.core.Days
import network.calimero.crm.core.DealDraft
import network.calimero.crm.core.ErrorText
import network.calimero.crm.core.SuggestedActivity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

/** The same cases as the iOS app's ModelTests.swift. */
class ModelsTest {
    /** A u64 as the contract takes it: a decimal string. */
    private fun u64(value: Long) = JsonPrimitive(value.toString())

    @Test
    fun `workspaces found a workspace with its first pipeline and currency`() =
        runTest {
            val backend = backendWith(Script())
            val model = WorkspacesModel(backend, applicationId = null, names = LocalNames(MemoryStore()))
            val pipeline = model.createWorkspace(" Acme Inc ", "Enterprise", "eur")!!
            assertEquals("foundNamespace Acme Inc", backend.log.first())
            assertTrue(backend.log.any { it.startsWith("createContext ${pipeline.namespaceId} ${backend.applicationId} Enterprise") })
            assertEquals(listOf(pipeline.contextId), backend.rootContexts[pipeline.namespaceId])
            assertEquals(JsonObject(emptyMap()), backend.initArgs[pipeline.contextId])
            val currency = backend.recording.calls("setCurrency").first()
            assertEquals(RecordedContractCall.Path.EXECUTE, currency.path)
            assertEquals(pipeline.contextId, currency.contextId)
            assertEquals(JsonPrimitive("EUR"), args(currency)["currency"])
            assertEquals("Enterprise", pipeline.name)

            backend.namespaces = listOf(AppNamespace(pipeline.namespaceId, "Acme Inc", backend.applicationId))
            model.load()
            assertEquals(listOf("Acme Inc"), model.workspaces.value.map { it.title })
            assertEquals(
                listOf("Enterprise"),
                model.workspaces.value[0]
                    .pipelines
                    .map { it.name },
            )

            assertNull(model.createWorkspace("X", "", "EURO"))
            assertEquals("Use a three-letter currency code, e.g. USD or EUR.", model.error.value)
        }

    @Test
    fun `USD pipelines skip the currency write and unnamed ones are numbered`() =
        runTest {
            val backend = backendWith(Script())
            val model = WorkspacesModel(backend, "app", LocalNames(MemoryStore()))
            backend.namespaces = listOf(AppNamespace("ns1", "Team", "app"))
            backend.rootContexts = mapOf("ns1" to listOf("c1", "c2"))
            model.load()
            assertEquals(
                listOf("Pipeline 1", "Pipeline 2"),
                model.workspaces.value[0]
                    .pipelines
                    .map { it.name },
            )
            val added = model.addPipeline(model.workspaces.value[0], "", "USD")!!
            assertEquals("Sales", added.name)
            assertTrue(backend.recording.calls("setCurrency").isEmpty())
            assertEquals(
                3,
                model.workspaces.value[0]
                    .pipelines.size,
            )
        }

    @Test
    fun `joining redeems the invitation and lists the workspace`() =
        runTest {
            val backend = backendWith(Script())
            val model = WorkspacesModel(backend, "app", LocalNames(MemoryStore()))
            val ns = "34".repeat(32)
            val invitation = CrmInvitation(InMemoryAppBackend.invitation(ns), "Globex")
            assertEquals(ns, model.join(invitation))
            assertTrue(backend.log.contains("joinNamespace $ns"))
            assertEquals("Globex", model.workspace(ns)?.title)
            val link = model.inviteLink(model.workspace(ns)!!)!!
            assertEquals(ns, CrmInvitation.parse(link)?.namespaceId)
        }

    @Test
    fun `load reads the whole pipeline and joins the context first`() =
        runTest {
            val script = Script()
            script.deals = listOf(deal("d1", stage = "qualified"), deal("d2", status = "won"))
            script.contacts = listOf(contact("c2", "Bo"), contact("c1", "Ana"))
            script.stages = stages.reversed()
            val backend = backendWith(script)
            val m = PipelineModel(ref, backend)
            m.load()
            assertTrue(backend.log.contains("joinContext ctx"))
            val s = m.state.value
            assertTrue(s.hasLoaded)
            assertEquals(stages.map { it.id }, s.stages.map { it.id })
            assertEquals(listOf("Ana", "Bo"), s.contacts.map { it.name })
            assertEquals("EUR", m.currency)
            assertEquals(listOf("d1"), m.openDeals("qualified").map { it.id })
            assertEquals(1, s.version)
            assertEquals(
                setOf("listStages", "listDeals", "listContacts", "listActivities", "listAutomations", "getSettings"),
                backend.recording.calls
                    .map { it.method }
                    .toSet(),
            )
            assertTrue(backend.recording.calls.all { it.path == RecordedContractCall.Path.QUERY && it.contextId == "ctx" })
        }

    @Test
    fun `a context still syncing is warming up, not an error`() =
        runTest {
            val script = Script()
            script.failRead = AppError("Context state not initialized, awaiting state sync")
            val m = modelOn(backendWith(script))
            m.load()
            assertTrue(m.state.value.warmingUp)
            assertNull(m.state.value.error)
            script.failRead = java.io.IOException("offline")
            m.load()
            assertFalse(m.state.value.warmingUp)
            assertNotNull(m.state.value.error)
            script.failRead = null
            m.load()
            assertNull(m.state.value.error)
            assertTrue(m.state.value.hasLoaded)
        }

    @Test
    fun `creating a deal sends the contract's arguments and can create its person`() =
        runTest {
            val script = Script()
            val backend = backendWith(script)
            val m = modelOn(backend)
            m.load()
            val draft =
                DealDraft(
                    title = "  Acme — 50 seats ",
                    value = "12.5k",
                    organization = "Acme",
                    stageId = "qualified",
                    owner = m.me,
                    expectedClose = LocalDate.of(2026, 10, 28),
                    creatingContact = true,
                    newContactName = "Ana Diaz",
                    newContactEmail = "ana@acme.test",
                )
            assertEquals("new-createDeal", m.createDeal(draft))
            val person = args(backend.recording.calls("createContact").first())
            assertEquals(JsonPrimitive("Ana Diaz"), person["name"])
            assertEquals(JsonPrimitive("Acme"), person["organization"])
            val call = backend.recording.calls("createDeal").first()
            val sent = args(call)
            assertEquals(RecordedContractCall.Path.EXECUTE, call.path)
            assertEquals(JsonPrimitive("Acme — 50 seats"), sent["title"])
            assertEquals(u64(12_500), sent["value"])
            assertEquals(JsonPrimitive("new-createContact"), sent["contactId"])
            assertEquals(JsonPrimitive("qualified"), sent["stageId"])
            assertEquals(JsonPrimitive(m.me), sent["owner"])
            assertEquals(u64(Days.noon(LocalDate.of(2026, 10, 28), utc).toLong()), sent["expectedClose"])
            assertEquals("Deal added", m.notice.value?.text)
            assertEquals(2, backend.recording.calls("listDeals").size)
        }

    @Test
    fun `moving, closing and reopening deals`() =
        runTest {
            val script = Script()
            val d = deal("d1")
            script.deals = listOf(d)
            val backend = backendWith(script)
            val m = modelOn(backend)
            m.load()
            assertTrue(m.move(d, "meeting"))
            assertEquals(JsonPrimitive("meeting"), args(backend.recording.calls("moveDeal").first())["stageId"])
            assertEquals("Moved to Meeting", m.notice.value?.text)
            assertTrue(m.move(d, "lead"))
            assertEquals(1, backend.recording.calls("moveDeal").size)
            assertTrue(m.markWon(d))
            assertEquals("Won “Acme — 50 seats” — €12,000", m.notice.value?.text)
            assertTrue(m.markLost(d, " Price "))
            assertEquals(JsonPrimitive("Price"), args(backend.recording.calls("markLost").first())["reason"])
            assertTrue(m.reopen(d))
            assertEquals(1, backend.recording.calls("reopenDeal").size)
        }

    @Test
    fun `scheduling uses the deal's owner else you, and suggestions are due at ten`() =
        runTest {
            val script = Script()
            script.deals = listOf(deal("d1", owner = null), deal("d2", owner = "bob"))
            val backend = backendWith(script)
            val m = modelOn(backend)
            m.load()
            assertTrue(m.schedule(SuggestedActivity(ActivityKind.MEETING, "Book a demo", 3), m.deal("d1")!!))
            val first = args(backend.recording.calls("addActivity").first())
            assertEquals(JsonPrimitive(m.me), first["owner"])
            assertEquals(JsonPrimitive("d1"), first["dealId"])
            assertEquals(JsonPrimitive("c1"), first["contactId"])
            assertEquals(JsonPrimitive("meeting"), first["kind"])
            assertEquals(u64(Days.dueIn(3, now, utc).toLong()), first["dueAt"])
            assertTrue(m.schedule(ActivityDraft(subject = "Call", due = now, dealId = "d2")))
            assertEquals(JsonPrimitive("bob"), args(backend.recording.calls("addActivity")[1])["owner"])

            val a = activity("a1", ms(-1.0))
            assertTrue(m.snooze(a))
            assertEquals(u64(Days.dueIn(1, now, utc).toLong()), args(backend.recording.calls("rescheduleActivity").first())["dueAt"])
            assertTrue(m.setDone(a, true))
            assertEquals(JsonPrimitive(true), args(backend.recording.calls("setActivityDone").first())["done"])
        }

    @Test
    fun `a failed write is reported, not thrown`() =
        runTest {
            val script = Script()
            val backend = backendWith(script)
            val m = modelOn(backend)
            m.load()
            backend.recording.handler = { call ->
                if (call.path == RecordedContractCall.Path.EXECUTE) throw SignedOutException(call.method)
                script.answer(call)
            }
            assertFalse(m.deleteDeal(deal("d1")))
            assertEquals(true, m.notice.value?.isError)
            assertEquals(ErrorText.describe(SignedOutException("deleteDeal")), m.notice.value?.text)
        }

    @Test
    fun `stages reorder and settings validate`() =
        runTest {
            val script = Script()
            val backend = backendWith(script)
            val m = modelOn(backend)
            m.load()
            assertTrue(m.moveStage(m.stages[1], -1))
            assertEquals(
                JsonArray(listOf("qualified", "lead", "meeting", "proposal", "negotiation").map { JsonPrimitive(it) }),
                args(backend.recording.calls("reorderStages").first())["stageIds"],
            )
            assertFalse(m.moveStage(m.stages[0], -1))
            assertFalse(m.setCurrency("dollars"))
            assertTrue(backend.recording.calls("setCurrency").isEmpty())
            assertTrue(m.setCurrency("gbp"))
            assertEquals(JsonPrimitive("GBP"), args(backend.recording.calls("setCurrency").first())["currency"])
            assertTrue(m.setRottingDays(21))
            assertEquals(JsonPrimitive(21), args(backend.recording.calls("setRottingDays").first())["days"])
        }

    @Test
    fun `owners are labelled and offered once`() =
        runTest {
            val script = Script()
            val backend = backendWith(script)
            val bob = "cd".repeat(32)
            val bobB58 = InviteCodec.base58Encode(ByteArray(32) { 0xcd.toByte() })
            script.deals = listOf(deal("d1", owner = bob), deal("d2", owner = bobB58), deal("d3", owner = "Carol"), deal("d4", owner = backend.account))
            val m = modelOn(backend)
            m.load()
            assertEquals(listOf(m.me, bob, "Carol"), m.ownerOptions)
            assertEquals("You", m.ownerLabel(backend.account))
            assertEquals(Account.short(bobB58), m.ownerLabel(bobB58))
            assertEquals("Carol", m.ownerLabel("Carol"))
            assertEquals("Unassigned", m.ownerLabel(null))
            assertTrue(m.isMe(InviteCodec.base58Encode(ByteArray(32) { 0xab.toByte() })))
        }

    @Test
    fun `an event from the context re-reads the pipeline`() =
        runTest {
            val script = Script()
            val backend = backendWith(script)
            val m = modelOn(backend)
            m.coalesceMs = 10
            m.pollMs = 60_000
            withContext(Dispatchers.Default) {
                val job = launch { m.run() }
                withTimeout(5_000) { while (m.state.value.version < 1 || backend.subscriberCount == 0) delay(10) }
                script.deals = listOf(deal("d9"))
                backend.emit(AppContextEvent("ctx", "StateMutation"))
                withTimeout(5_000) { while (m.state.value.version < 2) delay(10) }
                assertEquals(listOf("d9"), m.deals.map { it.id })
                job.cancelAndJoin()
            }
        }
}
