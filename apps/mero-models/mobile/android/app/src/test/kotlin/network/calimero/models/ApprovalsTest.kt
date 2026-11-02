package network.calimero.models

import com.calimero.mero.AppsReport
import com.calimero.mero.ConsentRequest
import com.calimero.mero.ConsentResult
import com.calimero.mero.ConsentScope
import com.calimero.mero.ConsentStale
import com.calimero.mero.ConsentStarted
import com.calimero.mero.PendingApprovals
import com.calimero.mero.ReleaseRules
import com.calimero.mero.ReportScope
import com.calimero.mero.confirmationCode
import com.calimero.mero.pendingApprovalsFrom
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import network.calimero.models.core.ApprovalItem
import network.calimero.models.core.ApprovalsModel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

/** The same cases as the iOS `ApprovalsTests`. */
@OptIn(ExperimentalCoroutinesApi::class)
class ApprovalsTest {
    private val json = Json { ignoreUnknownKeys = true }

    /** A report as `GET /auth/apps` answers it: one unapproved release, one app with a newer version. */
    private fun pending(
        scope: String = """{"kind":"account"}""",
        releasesHeldBy: String = "owner",
    ): PendingApprovals {
        val governance = """{"releases":"$releasesHeldBy","appUpgrades":"owner","outbound":"owner"}"""
        val report =
            json.decodeFromString(
                AppsReport.serializer(),
                """
                {"scope":$scope,"governance":$governance,"approvedReleases":["2.3.109"],
                 "clusterReleases":[{"release":"2.3.110","nodes":3,"approved":false},{"release":"2.3.109","nodes":3,"approved":true}],
                 "apps":[{"app":"app1","group":1,"scope":$scope,"bundle":"b","package":{"package":"com.calimero.mero-models","version":"1.0.0"},
                   "upgradesHeldBy":"owner","replicas":[],"name":"Crate kit","availableVersions":["1.1.0"]}]}
                """,
            )
        val rules =
            json.decodeFromString(
                ReleaseRules.serializer(),
                """{"governance":$governance,"deadlines":[{"version":"2.3.110","after":"2026-11-30T00:00:00Z","afterSecs":1796000000}]}""",
            )
        return pendingApprovalsFrom(report, rules, now = 0)
    }

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
        assertEquals(
            ConsentRequest.Release(ConsentScope.Account, "2.3.110", "mero-models://consent"),
            items[0].request("mero-models://consent"),
        )
    }

    @Test
    fun `an operator's decision is not the account's`() {
        assertEquals(listOf("upgrade:app1:1.1.0"), ApprovalItem.from(pending(releasesHeldBy = "operator")).map { it.id })
    }

    @Test
    fun `approving shows the code, opens the page, then rereads`() =
        runTest {
            val account = pending()
            val org = pending(scope = """{"kind":"org","org":"org1"}""")
            val loads = mutableListOf<String?>()
            val asked = mutableListOf<ConsentRequest>()
            var opened = false
            val model =
                ApprovalsModel(
                    load = { scope ->
                        loads += scope
                        if (scope == "denied") throw IOException("not an owner")
                        if (scope == null) account else org
                    },
                    consent = { build, confirm ->
                        asked += build("mero-models://consent")
                        opened = confirm(ConsentStarted("r1", "https://n/consent/r1"))
                        if (opened) ConsentResult("r1", "release", "approved") else null
                    },
                )
            model.refresh(listOf("org1", "denied"))
            assertEquals(listOf(null, "org1", "denied"), loads)
            // The account's release, its upgrade, and the org's release (the same upgrade only once).
            assertEquals(3, model.items.value.size)
            val approving = launch { model.approve(model.items.value[0]) }
            runCurrent()
            // A node that predates `code`: the app works it out from the request id, as the page does.
            assertEquals(confirmationCode("r1"), model.code.value)
            model.continueToPage()
            approving.join()
            assertTrue(opened)
            assertNull(model.code.value)
            assertEquals(listOf(ConsentRequest.Release(ConsentScope.Account, "2.3.110", "mero-models://consent")), asked)
            assertEquals("Approved.", model.message.value)
            assertNull(model.busy.value)
            assertEquals(6, loads.size)
        }

    @Test
    fun `stopping at the code approves nothing`() =
        runTest {
            val model =
                ApprovalsModel(
                    load = { pending() },
                    consent = { _, confirm ->
                        confirm(ConsentStarted("r2", "https://n/consent/r2", code = "ABC-DEF"))
                        null
                    },
                )
            model.refresh()
            val approving = launch { model.approve(model.items.value[0]) }
            runCurrent()
            assertEquals("ABC-DEF", model.code.value)
            model.cancelCode()
            approving.join()
            assertEquals("Nothing was approved.", model.message.value)
        }

    @Test
    fun `a failed request is said in words`() =
        runTest {
            val model = ApprovalsModel(load = { pending() }, consent = { _, _ -> throw ConsentStale("changed") })
            model.refresh()
            model.approve(model.items.value[0])
            assertEquals("What you were asked to approve changed in the meantime. Review it again.", model.message.value)
        }
}
