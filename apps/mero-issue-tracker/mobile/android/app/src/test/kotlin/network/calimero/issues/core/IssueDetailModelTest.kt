package network.calimero.issues.core

import kotlinx.coroutines.test.runTest
import network.calimero.issues.generated.CommentView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class IssueDetailModelTest {
    private val ctx = "ctx-1"
    private val me = "ab".repeat(32)
    private val them = "cd".repeat(32)

    private fun model(
        fake: FakeTracker,
        id: String = "i1",
    ) = IssueDetailModel(issueTrackerClient(fake.backend.contract, ctx), id, me)

    @Test fun `properties and labels`() =
        runTest {
            val fake = FakeTracker(me)
            fake.seed(FakeTracker.issue("i1", labels = listOf("ci")), ctx)
            val m = model(fake)
            m.load()
            assertTrue(m.isCreator)
            m.setStatus("In progress")
            m.setPriority("urgent")
            m.setAssignee("  Ana ")
            m.addLabel("sync")
            m.removeLabel("ci")
            val issue = m.state.value.issue!!
            assertEquals("In progress", issue.status)
            assertEquals("urgent", issue.priority)
            assertEquals("Ana", issue.assignee)
            assertEquals(listOf("sync"), issue.labels)
            m.setAssignee("")
            assertNull(
                m.state.value.issue!!
                    .assignee,
            )
            assertFalse(
                "assignee" in
                    fake.backend.recording
                        .calls("set_assignee")
                        .last()
                        .args
                        .toString(),
            )
        }

    @Test fun `comments are author gated`() =
        runTest {
            val fake = FakeTracker(me)
            fake.seed(FakeTracker.issue("i1", createdBy = them), ctx)
            fake.seedComment(CommentView("c0", "i1", them, "theirs", 0u), ctx)
            val m = model(fake)
            m.load()
            assertFalse(m.isCreator)
            m.addComment("  Seen on main. ")
            var comments = m.state.value.comments
            assertEquals(listOf("theirs", "Seen on main."), comments.map { it.body })
            assertFalse(m.isMine(comments[0]))
            assertTrue(m.isMine(comments[1]))
            m.editComment(comments[1].id, "Seen twice")
            comments = m.state.value.comments
            assertEquals("Seen twice", comments[1].body)
            assertNotNull(comments[1].editedAt)
            m.deleteComment(comments[1].id)
            assertEquals(
                listOf("c0"),
                m.state.value.comments
                    .map { it.id },
            )
        }

    @Test fun `save sections sends only changes`() =
        runTest {
            val fake = FakeTracker(me)
            fake.seed(FakeTracker.issue("i1"), ctx)
            val m = model(fake)
            m.load()
            val draft = SectionsDraft(m.state.value.issue!!).copy(impact = "Everyone", repro = "1. boot\n2. crash")
            assertTrue(m.saveSections(draft))
            assertEquals(
                listOf("set_impact", "set_repro"),
                fake.backend.recording.calls
                    .map { it.method }
                    .filter { it.startsWith("set_") },
            )
            assertEquals(
                "1. boot\n2. crash",
                m.state.value.issue!!
                    .repro,
            )
            assertFalse(m.saveSections(draft.copy(summary = " ")))
            assertEquals("All four sections are required.", m.state.value.notice)
        }

    @Test fun `delete and fix prompt`() =
        runTest {
            val fake = FakeTracker(me)
            fake.seed(FakeTracker.issue("i1", title = "Crash"), ctx)
            val m = model(fake)
            m.load()
            assertTrue(m.fixPrompt(null)!!.contains("Issue i1: Crash"))
            assertTrue(m.delete())
            assertTrue(m.state.value.isGone)
            assertNull(fake.issue("i1", ctx))
        }

    @Test fun `missing issue`() =
        runTest {
            val m = model(FakeTracker(me), "nope")
            m.load()
            val phase = m.state.value.phase
            assertTrue(phase is LoadPhase.Failed && phase.message.startsWith("Issue not found."))
        }
}
