package network.calimero.forum.core

import com.calimero.mero.ConsentRequest
import com.calimero.mero.ConsentStarted
import com.calimero.mero.Governance
import com.calimero.mero.NotFound
import com.calimero.mero.PendingApprovals
import com.calimero.mero.PendingRelease
import com.calimero.mero.PendingUpgrade
import com.calimero.mero.ReportScope
import com.calimero.mero.releaseConsent
import com.calimero.mero.upgradeConsent
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** (iOS `ApprovalsTests`.) */
@OptIn(ExperimentalCoroutinesApi::class)
class ApprovalsTest {
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
                PendingUpgrade("app-1", "Design", ForumConstants.PACKAGE_NAME, "1.0.0", "1.2.0", listOf("1.1.0", "1.2.0"), actionable),
                PendingUpgrade("app-2", null, "com.other.app", "1.0.0", "2.0.0", listOf("2.0.0"), actionable),
            ),
        stalledBy = null,
        actionable = actionable,
    )

    private val started = ConsentStarted("r1", "https://node/consent/r1", 0, "ABC-123")

    @Test
    fun `items keep this apps upgrades and actionable releases`() {
        val items = ApprovalsModel.items(pending("org1"), "org1", ForumConstants.PACKAGE_NAME, "Mero Forum")
        assertEquals(
            listOf(ApprovalsModel.Item.Kind.Upgrade("app-1", "1.2.0"), ApprovalsModel.Item.Kind.Release("org1", "2.3.110")),
            items.map { it.kind },
        )
        assertEquals(upgradeConsent("app-1", "1.2.0", "mero-forum://consent"), items[0].request("mero-forum://consent"))
        assertEquals(releaseConsent(ReportScope.org("org1"), "2.3.110", "x://y"), items[1].request("x://y"))
    }

    @Test
    fun `operator held decisions are not offered`() {
        assertTrue(ApprovalsModel.items(pending(null, actionable = false), null, ForumConstants.PACKAGE_NAME, "Mero Forum").isEmpty())
    }

    private fun model(requested: MutableList<ConsentRequest>) =
        ApprovalsModel(
            packageName = ForumConstants.PACKAGE_NAME,
            appName = "Mero Forum",
            returnTo = "mero-forum://consent",
            fetch = { org -> if (org == null) throw NotFound("no account report") else pending(org) },
            consent = { request, confirm ->
                if (confirm(started)) requested += request
                started
            },
        )

    @Test
    fun `approve shows the code then opens consent`() =
        runTest {
            val requested = mutableListOf<ConsentRequest>()
            val model = model(requested)
            model.load(listOf("org1"))
            assertEquals(2, model.state.value.items.size)
            val item = model.state.value.items[0]
            val approving = async { model.approve(item) }
            runCurrent()
            assertEquals(
                "ABC-123",
                model.state.value.confirmation
                    ?.code,
            )
            assertEquals(
                item.title,
                model.state.value.confirmation
                    ?.title,
            )
            assertTrue("the page waits for the code", requested.isEmpty())
            model.answer(true)
            assertTrue(approving.await())
            assertEquals(listOf(upgradeConsent("app-1", "1.2.0", "mero-forum://consent")), requested)
            assertNull(model.state.value.approving)
            assertNull(model.state.value.confirmation)
        }

    @Test
    fun `cancelling the code keeps the page closed`() =
        runTest {
            val requested = mutableListOf<ConsentRequest>()
            val model = model(requested)
            model.load(listOf("org1"))
            val approving = async { model.approve(model.state.value.items[0]) }
            runCurrent()
            model.answer(false)
            assertFalse(approving.await())
            assertTrue(requested.isEmpty())
            assertNull("cancelling is not an error", model.state.value.error)
        }
}
