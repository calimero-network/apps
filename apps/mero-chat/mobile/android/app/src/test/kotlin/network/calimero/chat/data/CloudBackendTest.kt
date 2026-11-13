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
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The chat layer over kotlin-sdk's app backend, through the generated `ChatClient` and the component
 * ABI's wire (`logic/res/abi.json`), as the web's `meroChat.ts` sends and reads it. (Swift
 * `CloudBackendTests`, `ComponentChatContractTests`.)
 */
class CloudBackendTest {
    private val org = "aa".repeat(32)

    @Test
    fun `arguments go out in the ABI's names, u64s as strings`() =
        runBlocking {
            val app = InMemoryAppBackend()
            app.recording.handler = { call ->
                if (call.method == "getMessagesFrom") Json.parseToJsonElement("""{"totalCount":0,"messages":[],"startPosition":40}""") else null
            }
            val repo = ChatRepository(MeroChatBackend(app), nowSecs = { 1_760_000_000 })
            repo.edit("app-general", "m", "t")
            assertEquals(40L, repo.messagesFrom("app-general", 40, 20).startPosition)
            val (edit, from) = app.recording.calls
            assertEquals("editMessage", edit.method)
            assertEquals(
                Json.parseToJsonElement("""{"messageId":"m","newMessage":"t","timestamp":"1760000000"}"""),
                edit.args,
            )
            assertEquals("getMessagesFrom", from.method)
            assertEquals(Json.parseToJsonElement("""{"start":"40","limit":20}"""), from.args)
        }

    @Test
    fun `answers in the ABI's shape become the app's models`() =
        runBlocking {
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
            val app = InMemoryAppBackend()
            app.recording.handler = { call -> if (call.method == "getMessages") answer else Json.parseToJsonElement("\"12\"") }
            val message =
                ChatRepository(MeroChatBackend(app))
                    .newestMessages("app-general")
                    .messages
                    .single()
            assertEquals("m_1", message.id)
            assertEquals(7L, message.index)
            assertEquals(1_760_000_000L, message.timestamp)
            assertEquals(1_760_000_002L, message.threadLastTimestamp)
            assertEquals(listOf("ana"), message.mentionsUsernames)
            assertEquals("image/png", message.images.single().mimeType)
            assertEquals(10L, message.images.single().size)
            assertEquals(mapOf("👍" to listOf("acc")), message.reactions)
            assertEquals(12uL, MeroChatBackend(app).chat("app-general").getMessageCount())
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
