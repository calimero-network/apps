package network.calimero.standup

import com.calimero.mero.AppError
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
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import network.calimero.standup.app.ApprovalItem
import network.calimero.standup.app.ApprovalsModel
import network.calimero.standup.contract.StandupAppCode
import network.calimero.standup.contract.StandupMethods
import network.calimero.standup.contract.UpdateView
import network.calimero.standup.core.ErrorText
import network.calimero.standup.core.StandupInvitation
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class ContractTest {
    @Test
    fun `the method and error lists are the component ABI's`() {
        assertEquals(18, (StandupMethods.CALLS + StandupMethods.VIEWS).toSet().size)
        assertEquals(11, StandupAppCode.entries.size)
    }

    @Test
    fun `timestamps are decimal strings`() {
        val json = Json { ignoreUnknownKeys = true }
        val update =
            json.decodeFromString(
                UpdateView.serializer(),
                """{"day":"2026-10-28","author":"acc_a","authorName":"Ana","done":"d","next":"n","blockers":"","createdAt":"1761652800000000001","editedAt":"2","helpers":[]}""",
            )
        assertEquals(1_761_652_800_000_000_001uL, update.createdAt)
        assertEquals(2uL, update.editedAt)
        assertEquals("Ana", update.authorName)
    }

    @Test
    fun `contract errors in words`() {
        fun refusal(
            code: String,
            fields: JsonObject = JsonObject(emptyMap()),
        ) = AppError(
            "refused",
            buildJsonObject {
                put("code", code)
                put("fields", fields)
            },
        )
        assertEquals("You can't offer help with your own blocker.", ErrorText.describe(refusal("OwnBlocker")))
        assertEquals(
            "Done is too long (at most 2000 characters).",
            ErrorText.describe(refusal("TooLong", JsonObject(mapOf("field" to JsonPrimitive("done"), "limit" to JsonPrimitive(2000))))),
        )
        assertEquals("Title can't be empty.", ErrorText.describe(refusal("Empty", JsonObject(mapOf("field" to JsonPrimitive("title"))))))
    }

    private fun pending() =
        PendingApprovals(
            scope = ReportScope("org", "org1"),
            governance = Governance("owner", "owner", "owner"),
            approvedReleases = listOf("2.3.109"),
            releases = listOf(PendingRelease("2.3.110", 3, true, "", "", null)),
            upgrades = listOf(PendingUpgrade("app-1", "Platform", StandupInvitation.PACKAGE_NAME, "1.0.0", "1.2.0", listOf("1.2.0"), true)),
            stalledBy = null,
            actionable = true,
        )

    @Test
    fun `approvals show the confirmation code before the page opens`() =
        runTest {
            var opened = false
            val model =
                ApprovalsModel(
                    StandupInvitation.PACKAGE_NAME,
                    "Mero Standup",
                    fetch = { org -> checkNotNull(org) { "no account report" }.let { pending() } },
                    consent = { _, confirm ->
                        if (confirm(ConsentStarted("r1", "https://node/consent/r1", 1, "ABC-DEF"))) opened = true
                        true
                    },
                    returnTo = "mero-standup://consent",
                )
            model.load(listOf("org1"))
            val items = model.state.value.items
            assertEquals(listOf(ApprovalItem.Kind.Upgrade("app-1", "1.2.0"), ApprovalItem.Kind.Release("org1", "2.3.110")), items.map { it.kind })
            assertEquals(ConsentRequest.Upgrade("app-1", "1.2.0", "x://y"), items[0].request("x://y"))
            val approving = async { model.approve(items[0]) }
            while (model.state.value.confirmationCode == null) yield()
            assertEquals("ABC-DEF", model.state.value.confirmationCode)
            model.answerConfirmation(false)
            assertFalse(approving.await())
            assertFalse(opened)
            assertNull(model.state.value.error)
        }
}
