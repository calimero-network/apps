package network.calimero.updates

import com.calimero.mero.app.ContextContractCalling
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import network.calimero.updates.core.ComponentWire
import network.calimero.updates.generated.AskInput
import network.calimero.updates.generated.MetricPoint
import network.calimero.updates.generated.PostPage
import network.calimero.updates.generated.UpdateInput
import network.calimero.updates.generated.client.UpdatesClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The generated client's calls reach the contract as its component ABI takes them. (Swift `ComponentWireTests`.) */
class ComponentWireTest {
    private class Recorder : ContextContractCalling {
        val sent = mutableListOf<Triple<String, Boolean, JsonObject>>()

        override suspend fun query(
            method: String,
            argsJson: String,
        ): String = record(method, argsJson, true)

        override suspend fun execute(
            method: String,
            argsJson: String,
        ): String = record(method, argsJson, false)

        private fun record(
            method: String,
            args: String,
            view: Boolean,
        ): String {
            sent += Triple(method, view, Json.parseToJsonElement(args).jsonObject)
            return "null"
        }
    }

    @Suppress("LongMethod")
    @Test
    fun `every client method is in the ABI`() =
        runTest {
            val wire = Recorder()
            val c = UpdatesClient(wire)
            val input = UpdateInput("Oct", "s", "c", emptyList(), emptyList(), listOf(AskInput(null, "intro", "t", "d")))
            runCatching { c.getMe() }
            runCatching { c.getOverview() }
            runCatching { c.getSettings() }
            runCatching { c.getEngagement() }
            runCatching { c.getPost("p") }
            runCatching { c.listAsks() }
            runCatching { c.listCategories() }
            runCatching { c.listComments("p") }
            runCatching { c.listContributions(42uL) }
            runCatching { c.listDrafts() }
            runCatching { c.listMetrics() }
            runCatching { c.listPeople() }
            runCatching { c.listPosts(limit = 20u) }
            runCatching { c.addComment("p", body = "b") }
            runCatching { c.addTeammate("a") }
            runCatching { c.archiveCategory("c") }
            runCatching { c.askQuestion("t", "b") }
            runCatching { c.createCategory("n", "e", "c") }
            runCatching { c.deleteComment("c") }
            runCatching { c.deleteDraft("d") }
            runCatching { c.deletePost("p") }
            runCatching { c.editCategory("c", "n", "e", "c") }
            runCatching { c.editComment("c", "b") }
            runCatching { c.editUpdate("p", input) }
            runCatching { c.markRead("p") }
            runCatching { c.offerHelp("a", "n") }
            runCatching { c.publishUpdate(input) }
            runCatching { c.react("p", "e", true) }
            runCatching { c.removeTeammate("a") }
            runCatching { c.saveDraft(title = "t", payload = "{}") }
            runCatching { c.setAskStatus("a", "resolved") }
            runCatching { c.setMutedCategories(listOf("c")) }
            runCatching { c.setOfferStatus("a", "b", "accepted") }
            runCatching { c.setProfile("n", "f") }
            runCatching { c.setQuestionStatus("p", "answered") }
            runCatching { c.setSettings("Acme", 14u) }
            runCatching { c.withdrawOffer("a") }

            assertEquals(ComponentWire.METHODS.keys, wire.sent.map { it.first }.toSet())
            for ((method, view, args) in wire.sent) {
                val spec = ComponentWire.METHODS.getValue(method)
                assertEquals(method, spec.view, view)
                assertEquals(method, spec.params.toSet(), args.keys)
            }
            assertEquals(JsonPrimitive("42"), wire.sent.first { it.first == "listContributions" }.third["since"])
            assertEquals(JsonNull, wire.sent.first { it.first == "saveDraft" }.third["draftId"])
            val published = wire.sent.first { it.first == "publishUpdate" }.third["input"] as JsonObject
            assertEquals(JsonPrimitive("c"), published["categoryId"])
        }

    @Test
    fun `answers come back in the client's shape`() {
        val answer =
            """{"items":[{"id":"p1","kind":"update","author":"a","authorName":"Ana","authorIsTeam":true,"title":"Oct",""" +
                """"summary":"s","categoryId":"c","status":"","createdAt":"1767225600000","editedAt":"0","commentCount":"3",""" +
                """"askCount":"1","openAskCount":"1","metricCount":"0","readCount":"2","readByMe":false,""" +
                """"reactions":[{"emoji":"e","count":"4","mine":true}]}],"nextCursor":null}"""
        val json = Json { ignoreUnknownKeys = true }
        val page = json.decodeFromString(PostPage.serializer(), answer)
        assertEquals(1_767_225_600_000uL, page.items[0].createdAt)
        assertEquals(3uL, page.items[0].commentCount)
        assertEquals(4uL, page.items[0].reactions[0].count)
        assertEquals("Ana", page.items[0].authorName)
        assertNull(page.nextCursor)
        // A metric's value is not a u64 field: an all-digit string stays a string.
        val point = json.decodeFromString(MetricPoint.serializer(), """{"postId":"p","postTitle":"t","at":"5","value":"12"}""")
        assertEquals("12", point.value)
        assertEquals(5uL, point.at)
    }
}
