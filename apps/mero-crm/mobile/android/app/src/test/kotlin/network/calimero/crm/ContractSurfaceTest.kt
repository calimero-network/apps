package network.calimero.crm

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import network.calimero.crm.generated.ContextContractCalling
import network.calimero.crm.generated.CrmClient
import network.calimero.crm.generated.DealView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The client against the contract's component ABI (`logic/res/abi.json`): every method by its
 * camelCase name, sent the right way (view or call), with exactly the ABI's parameters, `none` as
 * an explicit null and a u64 as a decimal string; answers with u64s as strings decode. (iOS:
 * `ContractSurfaceTests`.)
 */
class ContractSurfaceTest {
    private class Sent(
        val method: String,
        val view: Boolean,
        val args: JsonObject,
    )

    private class Recorder : ContextContractCalling {
        val sent = mutableListOf<Sent>()

        override suspend fun query(
            method: String,
            argsJson: String,
        ): String {
            sent += Sent(method, true, Json.parseToJsonElement(argsJson).jsonObject)
            return ANSWERS[method] ?: "null"
        }

        override suspend fun execute(
            method: String,
            argsJson: String,
        ): String {
            sent += Sent(method, false, Json.parseToJsonElement(argsJson).jsonObject)
            return ANSWERS[method] ?: "null"
        }
    }

    @Test
    fun `every method is the ABI's name with its parameters`() =
        runTest {
            val r = Recorder()
            val c = CrmClient(r)
            c.addActivity(kind = "call", subject = "Call", dueAt = 1u, note = "")
            c.addAutomation("s", "call", "x", 2u)
            c.addNote("d", "b")
            c.addStage("n", 10u)
            c.createContact("n", "", "", "", "")
            c.createDeal(title = "t", value = 1u, organization = "", stageId = "s", source = "")
            c.deleteActivity("a")
            c.deleteAutomation("r")
            c.deleteContact("c")
            c.deleteDeal("d")
            c.deleteNote("n")
            c.deleteStage("s")
            c.getDeal("d")
            c.getSettings()
            c.listActivities()
            c.listAutomations()
            c.listContacts()
            c.listDeals()
            c.listStages()
            c.markLost("d", "Price")
            c.markWon("d")
            c.moveDeal("d", "s")
            c.reopenDeal("d")
            c.reorderStages(listOf("a", "b"))
            c.rescheduleActivity("a", 2u)
            c.setActivityDone("a", true)
            c.setAutomationEnabled("r", false)
            c.setCurrency("EUR")
            c.setRottingDays(14u)
            c.updateContact("c", "n", "", "", "", "")
            c.updateDeal(dealId = "d", title = "t", value = 1u, organization = "", source = "")
            c.updateStage("s", "n", 20u)

            assertEquals(ABI.keys, r.sent.map { it.method }.toSet())
            assertEquals(VIEWS, CrmClient.VIEWS)
            assertEquals(ABI.keys - VIEWS, CrmClient.CALLS)
            for (request in r.sent) {
                assertEquals(request.method, ABI[request.method]!!.toSet(), request.args.keys)
                assertEquals(request.method, request.method in VIEWS, request.view)
            }
        }

    @Test
    fun `a none is a null and a u64 is a decimal string`() =
        runTest {
            val r = Recorder()
            CrmClient(r).createDeal(title = "t", value = 12_500u, organization = "", stageId = "s", expectedClose = 1_793_181_600_000u, source = "")
            val args = r.sent.first().args
            assertEquals(JsonPrimitive("12500"), args["value"])
            assertEquals(JsonPrimitive("1793181600000"), args["expectedClose"])
            assertEquals(JsonNull, args["contactId"])
            assertEquals(JsonNull, args["owner"])
        }

    @Test
    fun `answers read u64s from decimal strings`() =
        runTest {
            val c = CrmClient(Recorder())
            val deal = c.listDeals().first()
            assertEquals(12_500uL, deal.value)
            assertEquals(1_793_181_600_000uL, deal.expectedClose)
            assertNull(deal.closedAt)
            assertEquals(1_793_268_000_000uL, deal.nextActivity?.dueAt)
            assertEquals(deal, c.getDeal("d1").deal)
            val back = Json.decodeFromString(DealView.serializer(), Json.encodeToString(DealView.serializer(), deal))
            assertEquals("encoding writes the wire's strings back", deal, back)
        }

    private companion object {
        /** `methods` of the ABI, without `init`: name to parameter names. */
        val ABI: Map<String, List<String>> =
            mapOf(
                "addActivity" to listOf("dealId", "contactId", "kind", "subject", "dueAt", "owner", "note"),
                "addAutomation" to listOf("stageId", "kind", "subject", "dueInDays"),
                "addNote" to listOf("dealId", "body"),
                "addStage" to listOf("name", "probability"),
                "createContact" to listOf("name", "email", "phone", "organization", "jobTitle"),
                "createDeal" to listOf("title", "value", "organization", "contactId", "stageId", "owner", "expectedClose", "source"),
                "deleteActivity" to listOf("activityId"),
                "deleteAutomation" to listOf("automationId"),
                "deleteContact" to listOf("contactId"),
                "deleteDeal" to listOf("dealId"),
                "deleteNote" to listOf("noteId"),
                "deleteStage" to listOf("stageId"),
                "getDeal" to listOf("dealId"),
                "getSettings" to emptyList(),
                "listActivities" to listOf("dealId", "done"),
                "listAutomations" to emptyList(),
                "listContacts" to emptyList(),
                "listDeals" to listOf("status", "stageId", "owner"),
                "listStages" to emptyList(),
                "markLost" to listOf("dealId", "reason"),
                "markWon" to listOf("dealId"),
                "moveDeal" to listOf("dealId", "stageId"),
                "reopenDeal" to listOf("dealId"),
                "reorderStages" to listOf("stageIds"),
                "rescheduleActivity" to listOf("activityId", "dueAt"),
                "setActivityDone" to listOf("activityId", "done"),
                "setAutomationEnabled" to listOf("automationId", "enabled"),
                "setCurrency" to listOf("currency"),
                "setRottingDays" to listOf("days"),
                "updateContact" to listOf("contactId", "name", "email", "phone", "organization", "jobTitle"),
                "updateDeal" to listOf("dealId", "title", "value", "organization", "contactId", "owner", "expectedClose", "source"),
                "updateStage" to listOf("stageId", "name", "probability"),
            )

        val VIEWS = setOf("getDeal", "getSettings", "listActivities", "listAutomations", "listContacts", "listDeals", "listStages")

        const val DEAL =
            """{"id":"d1","title":"Acme","value":"12500","organization":"Acme","contact_id":null,"contact_name":null,""" +
                """"owner":null,"stage_id":"lead","status":"open","lost_reason":"","expected_close":"1793181600000",""" +
                """"source":"","probability":10,"stage_entered_at":"1793181600000","closed_at":null,""" +
                """"next_activity":{"id":"a1","kind":"call","subject":"Call","due_at":"1793268000000"},""" +
                """"open_activities":1,"last_touch_at":null,"created_by":"me","created_at":"1793181600000"}"""

        val ANSWERS: Map<String, String> =
            mapOf(
                "listDeals" to "[$DEAL]",
                "getDeal" to """{"deal":$DEAL,"contact":null,"activities":[],"notes":[]}""",
                "listStages" to "[]",
                "listContacts" to "[]",
                "listActivities" to "[]",
                "listAutomations" to "[]",
                "getSettings" to """{"currency":"EUR","rotting_days":14}""",
                "addActivity" to "\"a1\"",
                "addAutomation" to "\"r1\"",
                "addNote" to "\"n1\"",
                "addStage" to "\"s1\"",
                "createContact" to "\"c1\"",
                "createDeal" to "\"d1\"",
            )
    }
}
