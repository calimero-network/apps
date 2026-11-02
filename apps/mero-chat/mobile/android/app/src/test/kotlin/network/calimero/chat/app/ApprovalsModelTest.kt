package network.calimero.chat.app

import com.calimero.mero.AppsReport
import com.calimero.mero.ConsentRequest
import com.calimero.mero.ConsentResult
import com.calimero.mero.ConsentStarted
import com.calimero.mero.PendingApprovals
import com.calimero.mero.ReleaseRules
import com.calimero.mero.confirmationCode
import com.calimero.mero.pendingApprovalsFrom
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import network.calimero.chat.data.ChatInvites
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The same cases as the iOS `ApprovalsTests`. */
@OptIn(ExperimentalCoroutinesApi::class)
class ApprovalsModelTest {
    private val json = Json { ignoreUnknownKeys = true }

    private fun pending(org: String?): PendingApprovals {
        val scope = if (org == null) """{"kind":"account"}""" else """{"kind":"org","org":"$org"}"""
        val governance = """{"releases":"owner","appUpgrades":"owner","outbound":"owner"}"""
        val report =
            json.decodeFromString(
                AppsReport.serializer(),
                """
                {"scope":$scope,"governance":$governance,"clusterReleases":[{"release":"2.3.110","nodes":3,"approved":false}],
                 "apps":[{"app":"app-1","scope":$scope,"package":{"package":"${ChatInvites.APP_SLUG}","version":"1.1.0"},
                   "upgradesHeldBy":"owner","name":"general","availableVersions":["1.2.0"]}]}
                """,
            )
        return pendingApprovalsFrom(report, json.decodeFromString(ReleaseRules.serializer(), """{"governance":$governance}"""), now = 0)
    }

    private fun model(consent: suspend ((String) -> ConsentRequest, suspend (ConsentStarted) -> Boolean) -> ConsentResult?) =
        ApprovalsModel(ChatInvites.APP_SLUG, "Mero Chat", fetch = { org -> if (org == "denied") error("not an owner") else pending(org) }, consent = consent)

    @Test
    fun `approving shows the code, then opens the consent page`() =
        runTest {
            val requested = mutableListOf<ConsentRequest>()
            val model =
                model { build, confirm ->
                    requested += build("mero-chat://consent")
                    if (confirm(ConsentStarted("r1", "https://n/consent/r1", code = "ABC-DEF"))) ConsentResult("r1", "upgrade", "approved") else null
                }
            model.load(listOf("denied"))
            assertEquals(listOf("upgrade:app-1:1.2.0", "release:-:2.3.110"), model.items.value.map { it.id })
            var approved = false
            val job = launch { approved = model.approve(model.items.value[0], emptyList()) }
            runCurrent()
            assertEquals("ABC-DEF", model.code.value)
            model.continueToPage()
            job.join()
            assertTrue(approved)
            assertNull(model.code.value)
            assertEquals(listOf<ConsentRequest>(ConsentRequest.Upgrade("app-1", "1.2.0", "mero-chat://consent")), requested)
        }

    @Test
    fun `stopping at the code opens nothing`() =
        runTest {
            val model =
                model { _, confirm ->
                    confirm(ConsentStarted("r2", "https://n/consent/r2"))
                    null
                }
            model.load(emptyList())
            var approved = true
            val job = launch { approved = model.approve(model.items.value[0], emptyList()) }
            runCurrent()
            assertEquals(confirmationCode("r2"), model.code.value)
            model.cancelCode()
            job.join()
            assertFalse(approved)
            assertNull(model.error.value)
        }
}
