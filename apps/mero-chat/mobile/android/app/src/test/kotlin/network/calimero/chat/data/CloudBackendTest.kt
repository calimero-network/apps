package network.calimero.chat.data

import com.calimero.mero.AppError
import com.calimero.mero.ConfirmCancelled
import com.calimero.mero.WrongNode
import com.calimero.mero.app.AppContextEntry
import com.calimero.mero.app.AppNamespace
import com.calimero.mero.app.AppSubgroup
import com.calimero.mero.testkit.InMemoryAppBackend
import com.calimero.mero.testkit.RecordedContractCall
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The chat layer over kotlin-sdk's app backend, and the component ABI's wire (`logic/res/abi.json`)
 * as the web's `meroChat.ts` converts it. (Swift `CloudBackendTests`, `ComponentChatContractTests`.)
 */
class CloudBackendTest {
    private val org = "aa".repeat(32)

    @Test
    fun `methods and arguments go to camelCase, u64s as strings`() {
        assertEquals("getMessagesFrom", ComponentChatContract.method("get_messages_from"))
        val args = ComponentChatContract.args(ChatArgs.sendMessage("hi", 1_760_000_000, mentionUsernames = listOf("ana"), parentMessage = "m_1"))
        assertEquals(JsonPrimitive("1760000000"), args["timestamp"])
        assertEquals(JsonPrimitive("m_1"), args["parentMessage"])
        assertEquals(JsonArray(listOf(JsonPrimitive("ana"))), args["mentionsUsernames"])
        assertEquals(
            Json.parseToJsonElement("""{"start":"40","limit":20}"""),
            ComponentChatContract.args(ChatArgs.getMessagesFrom(40, 20)),
        )
        assertEquals(
            Json.parseToJsonElement("""{"messageId":"m","newMessage":"t","timestamp":"5","parentId":"p"}"""),
            ComponentChatContract.args(ChatArgs.editMessage("m", "t", 5, parentId = "p")),
        )
    }

    @Test
    fun `answers come back in v1 shapes`() {
        val answer =
            Json.parseToJsonElement(
                """
                {"totalCount":1,"startPosition":0,"messages":[{"index":"7","timestamp":"1760000000","sender":"acc",
                 "mentions":[],"mentionsUsernames":["ana"],"files":[],"images":[{"name":"a.png","mimeType":"image/png",
                 "size":"10","blobId":"b","uploadedAt":"1760000001"}],"id":"m_1","text":"hi","editedOn":null,
                 "reactions":{"👍":["acc"]},"deleted":null,"threadCount":2,"threadLastTimestamp":"1760000002",
                 "parentMessageId":null}]}
                """,
            )
        val v1 = ComponentChatContract.result(answer, "get_messages")!!.jsonObject
        val message = v1["messages"]!!.jsonArray[0].jsonObject
        assertEquals(JsonPrimitive(7L), message["index"])
        assertEquals(JsonPrimitive(1_760_000_000L), message["timestamp"])
        assertEquals(JsonPrimitive(1_760_000_002L), message["thread_last_timestamp"])
        assertEquals(JsonPrimitive("image/png"), message["images"]!!.jsonArray[0].jsonObject["mime_type"])
        assertEquals(JsonArray(listOf(JsonPrimitive("acc"))), message["reactions"]!!.jsonObject["👍"])
        val page = chatJson.decodeFromJsonElement(ChatMessagePage.serializer(), v1)
        assertEquals("m_1", page.messages.single().id)
        assertEquals(JsonPrimitive(12L), ComponentChatContract.result(JsonPrimitive("12"), "get_message_count"))
    }

    @Test
    fun `contract calls reach the app instance in the ABI's names`() =
        runBlocking {
            val app = InMemoryAppBackend()
            app.recording.handler = { call ->
                if (call.method == "getInfo") {
                    Json.parseToJsonElement("""{"name":"general","contextType":"Channel","description":"","createdAt":"1760000000","creator":"x"}""")
                } else {
                    null
                }
            }
            val repo = ChatRepository(MeroChatBackend(app), nowSecs = { 1_760_000_000 })
            assertEquals("general", repo.info("app-general").name)
            repo.send("app-general", "hi")
            assertEquals(listOf("getInfo", "sendMessage"), app.recording.calls.map { it.method })
            assertEquals(listOf(RecordedContractCall.Path.QUERY, RecordedContractCall.Path.EXECUTE), app.recording.calls.map { it.path })
            assertEquals(
                JsonPrimitive("1760000000"),
                app.recording.calls[1]
                    .args.jsonObject["timestamp"],
            )
        }

    @Test
    fun `channels are the org's own instances and its teams'`() =
        runBlocking {
            val app = InMemoryAppBackend()
            app.namespaces = listOf(AppNamespace(org, "Team", app.applicationId))
            app.rootContexts = mapOf(org to listOf("app-general"))
            app.subgroups = mapOf(org to listOf(AppSubgroup("$org/t1", "secret", listOf("app-secret"))))
            app.contextNames = mapOf("app-general" to "general", "app-secret" to "secret")
            app.members = setOf("app-general", "app-secret")
            val listing = ChatRepository(MeroChatBackend(app)).channels(org)
            assertEquals(listOf("general", "secret"), listing.channels.map { it.name })
            assertEquals(listOf(org, "$org/t1"), listing.channels.map { it.groupId })
            assertEquals(AppContextEntry("app-general", "general"), MeroChatBackend(app).listGroupContexts(org).single())
        }

    @Test
    fun `a private channel gets a team that admits by invitation`() =
        runBlocking {
            val app = InMemoryAppBackend()
            app.namespaces = listOf(AppNamespace(org, "Team", app.applicationId))
            ChatRepository(MeroChatBackend(app)).createChannel(org, "secret", public = false, username = "")
            assertTrue(app.log.contains("createSubgroup $org secret restricted"))
        }

    @Test
    fun `the node's and the contract's errors read as words`() {
        assertEquals("You dismissed the passkey prompt, so nothing changed.", describeChatError(ConfirmCancelled()))
        assertEquals(
            "This node runs a release your account hasn't approved. Try another node of the cluster.",
            describeChatError(WrongNode("not approved")),
        )
        val banned =
            AppError(
                "app error",
                buildJsonObject {
                    put("code", "Banned")
                    put("fields", buildJsonObject { put("message", "you are banned from this channel") })
                },
            )
        assertEquals("you are banned from this channel", describeChatError(banned))
        assertEquals("You can't do that in this channel.", describeChatError(AppError("app error", buildJsonObject { put("code", "Forbidden") })))
    }
}
