package network.calimero.calendar.app

import com.calimero.mero.ConsentRequest
import com.calimero.mero.ConsentStarted
import com.calimero.mero.Governance
import com.calimero.mero.PendingApprovals
import com.calimero.mero.PendingRelease
import com.calimero.mero.PendingUpgrade
import com.calimero.mero.ReportScope
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.yield
import network.calimero.calendar.data.CalendarConstants
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ApprovalsModelTest {
    private fun pending(actionable: Boolean = true) =
        PendingApprovals(
            scope = ReportScope("org", "org1"),
            governance = Governance("owner", "owner", "owner"),
            approvedReleases = listOf("2.3.109"),
            releases = listOf(PendingRelease("2.3.110", 3, actionable, "", "", null)),
            upgrades =
                listOf(
                    PendingUpgrade("app-1", "Launches", CalendarConstants.PACKAGE_NAME, "1.0.0", "1.2.0", listOf("1.2.0"), actionable),
                    PendingUpgrade("app-2", null, "com.other.app", "1.0.0", "2.0.0", listOf("2.0.0"), actionable),
                ),
            stalledBy = null,
            actionable = actionable,
        )

    @Test
    fun `keeps this app's upgrades and actionable releases`() {
        val items = ApprovalsModel.items(pending(), "org1", CalendarConstants.PACKAGE_NAME, "Mero Calendar")
        assertEquals(
            listOf(ApprovalItem.Kind.Upgrade("app-1", "1.2.0"), ApprovalItem.Kind.Release("org1", "2.3.110")),
            items.map { it.kind },
        )
        assertEquals(ConsentRequest.Upgrade("app-1", "1.2.0", "x://y"), items[0].request("x://y"))
        assertTrue(ApprovalsModel.items(pending(actionable = false), null, CalendarConstants.PACKAGE_NAME, "Mero Calendar").isEmpty())
    }

    @Test
    fun `the confirmation code is shown before the page opens`() =
        runTest {
            var opened = false
            val model =
                ApprovalsModel(
                    CalendarConstants.PACKAGE_NAME,
                    "Mero Calendar",
                    fetch = { pending() },
                    consent = { _, confirm ->
                        if (confirm(ConsentStarted("r1", "https://node/consent/r1", 1, "ABC-DEF"))) opened = true
                        true
                    },
                    returnTo = "mero-calendar://consent",
                )
            model.load(listOf("org1"))
            val item =
                model.state.value.items
                    .first()
            val approving = async { model.approve(item) }
            while (model.state.value.confirmationCode == null) yield()
            assertEquals("ABC-DEF", model.state.value.confirmationCode)
            model.answerConfirmation(false)
            assertFalse(approving.await())
            assertFalse(opened)
            assertNull(model.state.value.confirmationCode)
            assertNull("declining the code is not an error", model.state.value.error)
        }
}
