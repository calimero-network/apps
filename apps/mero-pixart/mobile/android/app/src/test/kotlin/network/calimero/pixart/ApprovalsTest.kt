package network.calimero.pixart

import com.calimero.mero.ConsentRequest
import com.calimero.mero.ConsentResult
import com.calimero.mero.ConsentStarted
import com.calimero.mero.Governance
import com.calimero.mero.PendingApprovals
import com.calimero.mero.PendingRelease
import com.calimero.mero.PendingUpgrade
import com.calimero.mero.ReleaseDeadline
import com.calimero.mero.ReportScope
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.yield
import network.calimero.pixart.core.ApprovalItem
import network.calimero.pixart.core.ApprovalsModel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

/** (iOS `ApprovalsTests`.) */
class ApprovalsTest {
    private fun pending(
        scope: ReportScope = ReportScope.Account,
        operatorHoldsReleases: Boolean = false,
    ) = PendingApprovals(
        scope = scope,
        governance = Governance(),
        approvedReleases = listOf("2.3.109"),
        releases = listOf(PendingRelease("2.3.110", 3, !operatorHoldsReleases, "", "", ReleaseDeadline("2.3.110", "2026-11-30T00:00:00Z"))),
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
        assertEquals(listOf("upgrade:app1:1.1.0"), ApprovalItem.from(pending(operatorHoldsReleases = true)).map { it.id })
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
                        asked += build("mero-pixart://consent")
                        ConsentResult("r1", "release", "approved")
                    },
                )
            model.refresh(listOf("org1", "denied"))
            assertEquals(listOf(null, "org1", "denied"), loads)
            assertEquals(3, model.items.value.size)
            model.approve(model.items.value[0])
            assertEquals(1, asked.size)
            assertEquals("Approved.", model.message.value)
            assertNull(model.busy.value)
            assertEquals(6, loads.size)
        }

    @Test
    fun `the confirmation code waits for the person`() =
        runTest {
            var opened = false
            val model =
                ApprovalsModel(
                    load = { pending() },
                    consent = { _, confirm ->
                        opened = confirm(ConsentStarted("r1", "https://node/consent/r1", 0, "ABC-DEF"))
                        null
                    },
                )
            model.refresh()
            val approving = async { model.approve(model.items.value[0]) }
            while (model.confirmationCode.value == null) yield()
            assertEquals("ABC-DEF", model.confirmationCode.value)
            model.answerCode(false)
            approving.await()
            assertFalse(opened)
            assertNull(model.confirmationCode.value)
            assertNull(model.message.value)
        }
}
