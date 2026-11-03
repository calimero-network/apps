package network.calimero.kombat.app

import com.calimero.mero.ConsentRequest
import com.calimero.mero.ConsentResult
import com.calimero.mero.Governance
import com.calimero.mero.PendingApprovals
import com.calimero.mero.PendingRelease
import com.calimero.mero.PendingUpgrade
import com.calimero.mero.ReleaseDeadline
import com.calimero.mero.ReportScope
import com.calimero.mero.releaseConsent
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** What waits for the account's approval, and asking for it. (Swift `ApprovalsTests`.) */
class ApprovalsTest {
    /** One unapproved release, one app with a newer version; [operator] holds release approvals instead. */
    private fun pending(
        scope: ReportScope = ReportScope.Account,
        operator: Boolean = false,
    ) = PendingApprovals(
        scope = scope,
        governance = Governance(releases = if (operator) "operator" else "owner"),
        approvedReleases = listOf("2.3.109"),
        releases = listOf(PendingRelease("2.3.110", 3, !operator, "", "", ReleaseDeadline("2.3.110", "2026-11-30T00:00:00Z"))),
        upgrades = listOf(PendingUpgrade("app1", "Crate kit", "com.calimero.app", "1.0.0", "1.1.0", listOf("1.1.0"), true)),
        stalledBy = null,
        actionable = true,
    )

    @Test
    fun `the account's decisions become items`() {
        val items = ApprovalItem.from(pending())
        assertEquals(
            listOf(
                ApprovalItem.Release(ReportScope.Account, "2.3.110", "2026-11-30T00:00:00Z"),
                ApprovalItem.Upgrade("app1", "Crate kit", "1.0.0", "1.1.0"),
            ),
            items,
        )
        assertEquals("Upgrade Crate kit to 1.1.0", items[1].title)
        assertEquals(releaseConsent(ReportScope.Account, "2.3.110", "mero-kombat://consent"), items[0].request("mero-kombat://consent"))
    }

    @Test
    fun `an operator's decision is not the account's`() {
        assertEquals(listOf("upgrade:app1:1.1.0"), ApprovalItem.from(pending(operator = true)).map { it.id })
    }

    @Test
    fun `approving opens the consent page then rereads`() =
        runTest {
            val loads = mutableListOf<String?>()
            val asked = mutableListOf<ConsentRequest>()
            val model =
                ApprovalsModel(
                    load = { org ->
                        loads += org
                        if (org == "denied") error("not an owner")
                        if (org == null) pending() else pending(ReportScope.org(org))
                    },
                    consent = { build, _ ->
                        asked += build("mero-kombat://consent")
                        ConsentResult("r1", "release", "approved")
                    },
                )
            model.refresh(listOf("org1", "denied"))
            assertEquals(listOf(null, "org1", "denied"), loads)
            // The account's release, its upgrade, and the org's release (the same upgrade only once).
            assertEquals(3, model.state.value.items.size)
            model.approve(model.state.value.items[0])
            assertEquals(listOf(releaseConsent(ReportScope.Account, "2.3.110", "mero-kombat://consent")), asked)
            assertEquals("Approved.", model.state.value.message)
            assertNull(model.state.value.busy)
            assertEquals(6, loads.size)
        }

    @Test
    fun `the code is shown first and cancelling opens nothing`() =
        runTest {
            var opened = 0
            val model =
                ApprovalsModel(
                    load = { pending() },
                    consent = { _, confirm ->
                        if (!confirm("ABC-DEF")) return@ApprovalsModel null
                        opened += 1
                        null
                    },
                )
            model.refresh()
            val approving = async { model.approve(model.state.value.items[0]) }
            while (model.state.value.confirmationCode == null) yield()
            assertEquals("ABC-DEF", model.state.value.confirmationCode)
            model.answerConfirmation(false)
            approving.await()
            assertEquals(0, opened)
            assertEquals("Cancelled. Nothing was approved.", model.state.value.message)
            assertNull(model.state.value.confirmationCode)
        }
}
