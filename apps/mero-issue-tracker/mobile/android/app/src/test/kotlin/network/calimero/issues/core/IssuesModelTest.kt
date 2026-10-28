package network.calimero.issues.core

import com.calimero.mero.testkit.RecordedContractCall
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.SocketTimeoutException

class IssuesModelTest {
    private val ctx = "ctx-1"

    private fun model(fake: FakeTracker) = IssuesModel(issueTrackerClient(fake.backend.contract, ctx), ctx)

    @Test fun `load groups by status newest first`() =
        runTest {
            val fake = FakeTracker()
            fake.seed(FakeTracker.issue("i1", status = "Open", createdAt = 1), ctx)
            fake.seed(FakeTracker.issue("i2", status = "Done", createdAt = 2), ctx)
            fake.seed(FakeTracker.issue("i3", status = "Open", createdAt = 3), ctx)
            val m = model(fake)
            m.load()
            val s = m.state.value
            assertEquals(LoadPhase.Loaded, s.phase)
            assertEquals(listOf("Open", "Done"), s.sections.map { it.status })
            assertEquals(listOf("i3", "i1"), s.sections[0].issues.map { it.id })
            assertEquals(emptyList<String>(), s.column("In progress").map { it.id })
            assertEquals(
                RecordedContractCall.Path.QUERY,
                fake.backend.recording
                    .calls("list_issues")
                    .first()
                    .path,
            )
        }

    @Test fun `filters and search`() =
        runTest {
            val fake = FakeTracker()
            fake.seed(FakeTracker.issue("i1", title = "Crash on boot", priority = "urgent", assignee = "Ana", labels = listOf("ci")), ctx)
            fake.seed(FakeTracker.issue("i2", title = "Slow sync", priority = "low", labels = listOf("sync")), ctx)
            val m = model(fake)
            m.load()
            m.setFilters(IssueFilters(priority = "urgent"))
            assertEquals(
                listOf("i1"),
                m.state.value.visible
                    .map { it.id },
            )
            m.setFilters(IssueFilters(assignee = "ana"))
            assertEquals(
                listOf("i1"),
                m.state.value.visible
                    .map { it.id },
            )
            m.setFilters(IssueFilters(label = "sync"))
            assertEquals(
                listOf("i2"),
                m.state.value.visible
                    .map { it.id },
            )
            assertEquals(1, m.state.value.filters.activeCount)
            m.clearFilters()
            m.setQuery("crash")
            assertEquals(
                listOf("i1"),
                m.state.value.visible
                    .map { it.id },
            )
            assertEquals(listOf("ci", "sync"), m.state.value.knownLabels)
            assertEquals(listOf("Ana"), m.state.value.knownAssignees)
        }

    @Test fun `move to another column`() =
        runTest {
            val fake = FakeTracker()
            fake.seed(FakeTracker.issue("i1"), ctx)
            val m = model(fake)
            m.load()
            m.move("i1", "Blocked")
            assertEquals(
                listOf("i1"),
                m.state.value
                    .column("Blocked")
                    .map { it.id },
            )
            assertEquals("Blocked", fake.issue("i1", ctx)?.status)
            assertEquals(
                RecordedContractCall.Path.EXECUTE,
                fake.backend.recording
                    .calls("set_status")
                    .first()
                    .path,
            )
        }

    @Test fun `a failed move is put back`() =
        runTest {
            val fake = FakeTracker()
            fake.seed(FakeTracker.issue("i1"), ctx)
            val m = model(fake)
            m.load()
            fake.failWrites = SocketTimeoutException()
            m.move("i1", "Done")
            assertEquals(
                listOf("i1"),
                m.state.value
                    .column("Open")
                    .map { it.id },
            )
            assertEquals("The relay took too long to answer. Try again.", m.state.value.notice)
        }

    @Test fun `create sends the four sections`() =
        runTest {
            val fake = FakeTracker()
            val m = model(fake)
            var draft = IssueDraft(title = "Crash")
            assertFalse(draft.isValid)
            draft = draft.copy(summary = " s ", impact = "i", repro = "r", resolution = "c", priority = "medium", labels = "ci, sync")
            val id = m.create(draft)
            val made = fake.issue(id, ctx)!!
            assertEquals("s", made.summary)
            assertEquals("medium", made.priority)
            assertEquals(listOf("ci", "sync"), made.labels)
            assertEquals(
                listOf(id),
                m.state.value.issues
                    .map { it.id },
            )
        }

    @Test fun `failed first load`() =
        runTest {
            val fake = FakeTracker()
            fake.backend.hasRelay = false
            val m = model(fake)
            m.load()
            val phase = m.state.value.phase
            assertTrue(phase is LoadPhase.Failed && phase.message.contains("No relay"))
        }
}
