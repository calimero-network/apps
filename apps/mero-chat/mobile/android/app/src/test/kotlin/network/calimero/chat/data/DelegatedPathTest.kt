package network.calimero.chat.data

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import network.calimero.chat.ChatRig
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Every contract call goes through the account's relay, never a node's `/jsonrpc`: views through
 * the account-scoped `/query`, writes as signed warrants on `/intents`. Driven through the SDK's
 * real MeroClient against mero-testkit's FakeNode (cloud manager + hosted relay).
 */
class DelegatedPathTest {
    private lateinit var rig: ChatRig
    private val ctx = "c0".repeat(32)

    @Before
    fun setUp() =
        runBlocking {
            rig = ChatRig()
            rig.signIn()
            assertTrue("the relay session is up", rig.client.state.value.sessionReady)
        }

    @After
    fun tearDown() = rig.close()

    @Test
    fun `views are queries on the relay, with the web app's arguments`() =
        runBlocking {
            rig.cloud.outputs["get_messages"] = rig.fixture("get_messages.json")
            rig.cloud.outputs["get_messages_from"] = rig.fixture("get_messages_from.json")
            rig.cloud.outputs["get_profiles"] = rig.fixture("get_profiles.json")
            rig.cloud.outputs["get_info"] = rig.fixture("get_info.json")
            rig.cloud.outputs["get_unread_count"] = JsonPrimitive(3)

            val page = rig.repo.newestMessages(ctx)
            assertEquals(2, page.messages.size)
            rig.repo.messagesFrom(ctx, 20, 20)
            assertEquals(
                "droid",
                rig.repo
                    .profiles(ctx)
                    .single { it.identity == rig.me }
                    .username,
            )
            assertEquals("general", rig.repo.info(ctx).name)
            assertEquals(3, rig.repo.unreadCount(ctx))

            val queries = rig.queries()
            assertEquals(
                listOf("get_messages", "get_messages_from", "get_profiles", "get_info", "get_unread_count"),
                queries.map { rig.methodOf(it.bodyJson) },
            )
            assertTrue(queries.all { it.path == "/admin-api/contexts/$ctx/query" })
            assertTrue("queries carry the relay session", queries.all { it.headers["Authorization"].orEmpty().startsWith("Bearer ") })
            assertEquals(Json.parseToJsonElement("""{"limit":20,"offset":0}"""), rig.argsOf(queries[0].bodyJson))
            assertEquals(Json.parseToJsonElement("""{"start":20,"limit":20}"""), rig.argsOf(queries[1].bodyJson))
            assertTrue("no view spent a warrant", rig.intents().isEmpty())
            assertEquals("nothing went to a node's JSON-RPC", 0, rig.node.rpcCalls)
        }

    @Test
    fun `writes are warrants on the relay's intents route, signed for the account`() =
        runBlocking {
            rig.cloud.outputs["send_message"] = rig.fixture("send_message.json")
            val sent = rig.repo.send(ctx, "sent from Android")
            assertEquals("sent from Android", sent!!.text)
            rig.repo.edit(ctx, "m_1", "fixed")
            rig.repo.delete(ctx, "m_1")
            rig.repo.react(ctx, "m_1", "🎉", add = true)
            rig.repo.setProfile(ctx, " droid ")
            rig.repo.markRead(ctx)

            val intents = rig.intents()
            assertEquals(
                listOf("send_message", "edit_message", "delete_message", "update_reaction", "set_profile", "mark_as_read"),
                intents.map { rig.methodOf(it.bodyJson) },
            )
            intents.forEach { req ->
                assertEquals("/admin-api/contexts/$ctx/intents", req.path)
                val body = req.bodyJson!!
                assertEquals(setOf("method", "argsJson", "warrant", "authorProof"), body.keys)
                assertNotNull(body["warrant"])
                assertTrue((body["authorProof"] as JsonPrimitive).content.isNotEmpty())
            }
            val now = ChatRig.NOW
            assertEquals(
                listOf(
                    """{"message":"sent from Android","mentions":[],"mentions_usernames":[],"timestamp":$now}""",
                    """{"message_id":"m_1","new_message":"fixed","timestamp":$now}""",
                    """{"message_id":"m_1"}""",
                    """{"message_id":"m_1","emoji":"🎉","add":true}""",
                    """{"username":"droid","avatar":null}""",
                    """{"timestamp":$now}""",
                ).map { Json.parseToJsonElement(it) },
                intents.map { rig.argsOf(it.bodyJson) },
            )
            assertEquals("nothing went to a node's JSON-RPC", 0, rig.node.rpcCalls)
        }

    @Test
    fun `a refused intent comes back as the relay's reason`() =
        runBlocking {
            rig.cloud.refuseNextIntent = "You can only edit your own messages"
            val error = runCatching { rig.repo.edit(ctx, "m_1", "x") }.exceptionOrNull()!!
            assertTrue(describeChatError(error), describeChatError(error).contains("You can only edit your own messages"))
        }

    @Test
    fun `nothing is sent for input the contract would refuse`() =
        runBlocking {
            assertTrue(runCatching { rig.repo.send(ctx, "   ") }.isFailure)
            assertTrue(runCatching { rig.repo.react(ctx, "m", "", add = true) }.isFailure)
            assertTrue(rig.intents().isEmpty())
        }

    @Test
    fun `workspaces are the account's namespaces running chat`() =
        runBlocking {
            rig.cloud.listedNamespaces += namespace("aa".repeat(32), rig.applicationId, "Team")
            rig.cloud.listedNamespaces += namespace("bb".repeat(32), "99".repeat(32), "Some other app")
            rig.cloud.listedNamespaces += namespace("cc".repeat(32), rig.applicationId, null)

            val list = rig.repo.workspaces()
            assertEquals(listOf("aa".repeat(32), "cc".repeat(32)), list.map { it.id })
            assertEquals("Team", list[0].name)
            assertTrue(list[1].name.startsWith("Workspace cccccccc"))
        }

    private fun namespace(
        id: String,
        app: String,
        name: String?,
    ): JsonObject =
        buildJsonObject {
            put("namespaceId", id)
            put("appKey", "11".repeat(32))
            put("targetApplicationId", app)
            put("createdAt", 1)
            name?.let { put("name", it) }
            put("memberCount", 2)
            put("contextCount", 1)
            put("subgroupCount", 1)
        }
}
