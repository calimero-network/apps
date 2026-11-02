package network.calimero.issues.core

import com.calimero.mero.ConsentRequest
import com.calimero.mero.ConsentStarted
import com.calimero.mero.Governance
import com.calimero.mero.NotFound
import com.calimero.mero.PendingApprovals
import com.calimero.mero.PendingRelease
import com.calimero.mero.PendingUpgrade
import com.calimero.mero.ReportScope
import com.calimero.mero.upgradeConsent
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ApprovalsModelTest {
    private fun pending(
        org: String?,
        actionable: Boolean = true,
    ) = PendingApprovals(
        scope = org?.let { ReportScope.org(it) } ?: ReportScope.Account,
        governance = Governance(),
        approvedReleases = listOf("2.3.109"),
        releases = listOf(PendingRelease("2.3.110", 3, actionable, "", "", null)),
        upgrades =
            listOf(
                PendingUpgrade("app-1", "Launches", Tracker.PACKAGE_NAME, "1.0.0", "1.2.0", listOf("1.1.0", "1.2.0"), actionable),
                PendingUpgrade("app-2", null, "com.other.app", "1.0.0", "2.0.0", listOf("2.0.0"), actionable),
            ),
        stalledBy = null,
        actionable = actionable,
    )

    @Test fun `items keep this app's upgrades and actionable releases`() {
        val items = ApprovalsModel.items(pending("org1"), "org1", Tracker.PACKAGE_NAME, "Mero Issue Tracker")
        assertEquals(listOf("upgrade:app-1:1.2.0", "release:org1:2.3.110"), items.map { it.id })
        assertEquals("Mero Issue Tracker 1.2.0 is available", items[0].title)
        assertEquals(upgradeConsent("app-1", "1.2.0", "mero-issues://consent"), items[0].request("mero-issues://consent"))
        assertTrue(ApprovalsModel.items(pending(null, actionable = false), null, Tracker.PACKAGE_NAME, "x").isEmpty())
    }

    @Test fun `the confirmation code is shown before the page opens`() =
        runTest {
            val requested = mutableListOf<ConsentRequest>()
            var opened = 0
            val model =
                ApprovalsModel(
                    Tracker.PACKAGE_NAME,
                    "Mero Issue Tracker",
                    fetch = { org -> if (org == null) throw NotFound("no account report") else pending(org) },
                    consent = { build, confirm ->
                        requested += build("mero-issues://consent")
                        val started = ConsentStarted("r1", "https://n/consent/r1", 1, "ABC-DEF")
                        if (confirm(started)) {
                            opened += 1
                            started
                        } else {
                            null
                        }
                    },
                )
            model.load(listOf("org1"))
            assertEquals(2, model.items.value.size)

            val declined = async { model.approve(model.items.value[0]) }
            while (model.confirmationCode.value == null) yield()
            assertEquals("ABC-DEF", model.confirmationCode.value)
            model.answerConfirmation(false)
            assertFalse(declined.await())
            assertEquals(0, opened)
            assertNull(model.error.value)

            val approving = async { model.approve(model.items.value[0]) }
            while (model.confirmationCode.value == null) yield()
            model.answerConfirmation(true)
            assertTrue(approving.await())
            assertEquals(1, opened)
            assertEquals(upgradeConsent("app-1", "1.2.0", "mero-issues://consent"), requested.last())
            assertNull(model.approving.value)
            assertNull(model.confirmationCode.value)
        }
}
