package network.calimero.issues.core

import com.calimero.mero.AppError
import com.calimero.mero.ConfirmCancelled
import com.calimero.mero.LoginRequired
import com.calimero.mero.WrongNode
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TrackerFormatTest {
    @Test fun `short issue id`() {
        assertEquals("9f3a2b", TrackerFormat.shortIssueId("issue-1712345678901-9f3a2b7c"))
        assertEquals("somethin", TrackerFormat.shortIssueId("something-long-id"))
        assertEquals("abc", TrackerFormat.shortIssueId("abc"))
    }

    @Test fun `relative time`() {
        val now = 1_700_000_000_000L
        assertEquals("now", TrackerFormat.relativeTime(now - 10_000, now))
        assertEquals("5m", TrackerFormat.relativeTime(now - 300_000, now))
        assertEquals("2h", TrackerFormat.relativeTime(now - 7_200_000, now))
        assertEquals("3d", TrackerFormat.relativeTime(now - 3 * 86_400_000L, now))
        assertEquals("2w", TrackerFormat.relativeTime(now - 14 * 86_400_000L, now))
        assertEquals("", TrackerFormat.relativeTime(0, now))
        assertEquals("just now", TrackerFormat.ago(now - 10_000, now))
        assertEquals("5m ago", TrackerFormat.ago(now - 300_000, now))
    }

    @Test fun `swatch matches the web hash`() {
        var h = 0
        for (c in "label:bug") h = h * 31 + c.code
        assertEquals((Math.abs(h.toLong()) % 8).toInt(), TrackerFormat.labelSwatch("bug"))
    }

    @Test fun `search and labels`() {
        val issue = FakeTracker.issue("issue-1-a", title = "Sync stalls", labels = listOf("crdt"))
        assertTrue(TrackerFormat.matches(issue, "  "))
        assertTrue(TrackerFormat.matches(issue, "STALL"))
        assertTrue(TrackerFormat.matches(issue, "crd"))
        assertFalse(TrackerFormat.matches(issue, "zzz"))
        assertEquals(listOf("sync", "crdt"), TrackerFormat.parseLabels(" sync, crdt , ,"))
    }

    @Test fun `repo name from url`() {
        assertEquals("core", TrackerFormat.repoNameFromUrl("https://github.com/acme/core.git"))
        assertEquals("web", TrackerFormat.repoNameFromUrl("https://github.com/acme/web/"))
        assertNull(TrackerFormat.repoNameFromUrl(""))
        assertNull(TrackerFormat.repoNameFromUrl("core"))
    }

    @Test fun `fix prompt matches the web`() {
        val issue = FakeTracker.issue("issue-1-a", title = "Crash")
        val prompt = TrackerFormat.fixPrompt(issue, "https://github.com/a/b")
        assertTrue(prompt.startsWith("You are fixing a tracked issue."))
        assertTrue(prompt.contains("Issue issue-1-a: Crash\nRepository: https://github.com/a/b\n\n## Summary\nS"))
        assertFalse(TrackerFormat.fixPrompt(issue, " ").contains("Repository:"))
    }

    @Test fun `key truncation`() {
        assertEquals("abab…abab", TrackerFormat.truncateKey("ab".repeat(32)))
        assertEquals("Ana", TrackerFormat.truncateKey("Ana"))
    }

    @Test fun `contract refusals in words`() {
        fun app(
            code: String,
            vararg fields: Pair<String, String>,
        ) = AppError(
            "refused",
            buildJsonObject {
                put("code", code)
                put("fields", buildJsonObject { fields.forEach { (k, v) -> put(k, v) } })
            },
        )
        assertEquals("Only the author may edit a comment.", TrackerFormat.errorText(app("Forbidden", "message" to "only the author may edit a comment")))
        assertEquals("That issue no longer exists. It may have been deleted.", TrackerFormat.errorText(app("NotFound", "id" to "issue-1-ab")))
        assertEquals("That comment no longer exists.", TrackerFormat.errorText(app("NotFound", "id" to "comment-1-ab")))
        assertEquals("Title must be 1 to 64 characters.", TrackerFormat.errorText(app("Invalid", "message" to "title must be 1 to 64 characters")))
    }

    @Test fun `cluster errors in words`() {
        assertEquals("The passkey prompt was cancelled.", TrackerFormat.errorText(ConfirmCancelled()))
        assertEquals("Your session ended. Sign in again.", TrackerFormat.errorText(LoginRequired("expired")))
        assertTrue(TrackerFormat.errorText(WrongNode("moved")).contains("Sign in again"))
    }
}
