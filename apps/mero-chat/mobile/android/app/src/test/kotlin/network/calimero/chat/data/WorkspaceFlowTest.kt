package network.calimero.chat.data

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import network.calimero.chat.ChatRig
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Workspaces and channels through the delegated layer: founding a namespace through the relay,
 * channels as a subgroup plus a context created by a creation warrant (`context-intents`), the
 * channel walk, and joining from an invitation link by direct admission (`/namespaces/{id}/admit`).
 */
class WorkspaceFlowTest {
    private lateinit var rig: ChatRig

    @Before
    fun setUp() =
        runBlocking {
            rig = ChatRig()
            rig.signIn()
        }

    @After
    fun tearDown() = rig.close()

    private fun governancePosts() = rig.cloud.recorded("/governance-intents").filter { it.method == "POST" }

    private fun contextIntentPosts() = rig.cloud.recorded("/context-intents").filter { it.method == "POST" }

    @Test
    fun `creating a channel makes its subgroup, then chat's context in it, initialised with the creator`() =
        runBlocking {
            val ns = "aa".repeat(32)
            val channel = rig.repo.createChannel(ns, "#random", public = true, username = "droid")

            assertEquals("random", channel.name)
            assertEquals(ns, channel.workspaceId)
            assertTrue(channel.joined)
            // The subgroup: a root op on the namespace, then its name and visibility on the subgroup.
            val governance = governancePosts()
            assertEquals("/admin-api/groups/$ns/governance-intents", governance.first().path)
            assertTrue(governance.drop(1).all { it.path == "/admin-api/groups/${channel.groupId}/governance-intents" })
            assertTrue(governance.size >= 2)

            // The context, by creation warrant on the subgroup, with init's arguments.
            val creation = contextIntentPosts().single()
            assertEquals("/admin-api/groups/${channel.groupId}/context-intents", creation.path)
            assertEquals(
                Json.parseToJsonElement(
                    """{"name":"random","context_type":"Channel","description":"","created_at":${ChatRig.NOW},"creator_username":"droid"}""",
                ),
                creation.bodyJson!!["initArgs"],
            )
            // Then the creator's name is registered in it, as a warrant.
            val profile = rig.intents().single()
            assertEquals("/admin-api/contexts/${channel.contextId}/intents", profile.path)
            assertEquals("set_profile", rig.methodOf(profile.bodyJson))
            assertEquals(0, rig.node.rpcCalls)
        }

    @Test
    fun `a new workspace is founded through the relay for chat's application, with #general in it`() =
        runBlocking {
            val founded = rig.repo.createWorkspace("Team", "droid")

            val genesis = governancePosts().first()
            assertEquals("/admin-api/groups/${founded.namespaceId}/governance-intents", genesis.path)
            // The registry resolved chat's package, and the namespace runs it.
            assertTrue(rig.cloud.recorded("/api/v2/bundles").isNotEmpty())
            val general = contextIntentPosts().single()
            assertEquals(
                "general",
                general.bodyJson!!["initArgs"]!!
                    .jsonObject["name"]!!
                    .jsonPrimitive.content,
            )
            assertNull(founded.warning)
        }

    @Test
    fun `an invitation is minted for sharing, and redeeming it is a direct admission`() =
        runBlocking {
            val ns = "ab".repeat(32)
            val link = rig.repo.invitationLink(Workspace(ns, "Team"))
            assertTrue(link.startsWith("https://links.calimero.network/com.calimero.chat/join?invitation="))

            val invite = ChatInvites.parse(link)!!
            assertEquals(ns, invite.namespaceId)
            assertEquals("Team", invite.workspaceName)

            val joined = rig.repo.joinWorkspace(invite)
            assertEquals(ns, joined.namespaceId)
            assertTrue(joined.published)
            val admit = rig.cloud.recorded("/admit").single()
            assertEquals("POST", admit.method)
            assertEquals("/admin-api/namespaces/$ns/admit", admit.path)
        }

    @Test
    fun `the channel walk finds subgroups' contexts, names them, and tells channels, DMs and unjoined apart`() =
        runBlocking {
            val ns = "dd".repeat(32)
            val general = "01".repeat(32)
            val random = "02".repeat(32)
            val dm = "03".repeat(32)
            val (sgGeneral, sgRandom, sgDm) = listOf("a1".repeat(32), "a2".repeat(32), "a3".repeat(32))
            rig.routes["/admin-api/groups/$ns/subgroups"] = {
                ChatRig.json(
                    buildJsonObject {
                        put(
                            "data",
                            buildJsonArray {
                                add(subgroup(sgGeneral, "general"))
                                add(subgroup(sgRandom, "random"))
                                add(subgroup(sgDm, "DM_CONTEXT_x_y"))
                            },
                        )
                    },
                )
            }
            rig.routes["/admin-api/groups/$ns/contexts"] = { ChatRig.json(buildJsonObject { put("data", JsonArray(emptyList())) }) }
            mapOf(sgGeneral to general, sgRandom to random, sgDm to dm).forEach { (sg, ctx) ->
                rig.routes["/admin-api/groups/$sg/contexts"] = {
                    ChatRig.json(buildJsonObject { put("data", buildJsonArray { add(buildJsonObject { put("contextId", ctx) }) }) })
                }
                rig.cloud.contextGroups[ctx] = sg
            }
            // The account is a direct member of #general and the DM, not of #random.
            listOf(sgGeneral, sgDm).forEach { sg -> rig.routes["/admin-api/groups/$sg/members"] = { members(rig.accountHex) } }
            rig.routes["/admin-api/groups/$sgRandom/members"] = { members("ee".repeat(32)) }
            // Per-context contract answers.
            rig.routes["/admin-api/contexts/$general/query"] = { body -> answer(body, info = """{"name":"general","context_type":"Channel"}""", unread = 4) }
            rig.routes["/admin-api/contexts/$dm/query"] = { body -> answer(body, info = """{"name":"dm","context_type":"Dm"}""", unread = 0) }

            val listing = rig.repo.channels(ns)

            assertEquals(listOf("general", "random"), listing.channels.map { it.name })
            val gen = listing.channels[0]
            assertTrue(gen.joined)
            assertEquals(4, gen.unread)
            assertEquals(sgGeneral, gen.groupId)
            val rnd = listing.channels[1]
            assertFalse(rnd.joined)
            assertEquals(0, rnd.unread)
            // A DM is named for the other person in it.
            assertEquals("alice", listing.dms.single().name)
            assertEquals(dm, listing.dms.single().contextId)
        }

    @Test
    fun `joining an open channel registers the person's name in it`() =
        runBlocking {
            val ctx = "04".repeat(32)
            val sg = "a4".repeat(32)
            rig.cloud.contextGroups[ctx] = sg
            val joined = rig.repo.joinChannel(Channel(ctx, sg, "dd".repeat(32), "random", joined = false), "droid")
            assertTrue(joined.joined)
            // MemberJoinedOpen on the channel's subgroup, through the namespace's relay.
            assertTrue(governancePosts().isNotEmpty())
            assertEquals("set_profile", rig.methodOf(rig.intents().single().bodyJson))
        }

    private fun subgroup(
        id: String,
        name: String,
    ): JsonObject =
        buildJsonObject {
            put("groupId", id)
            put("name", name)
        }

    private fun members(vararg accounts: String) =
        ChatRig.json(
            buildJsonObject {
                put(
                    "members",
                    buildJsonArray {
                        accounts.forEach { a ->
                            add(
                                buildJsonObject {
                                    put("identity", a)
                                    put("role", "Member")
                                },
                            )
                        }
                    },
                )
            },
        )

    private fun answer(
        body: String,
        info: String,
        unread: Int,
    ) = ChatRig.returns(
        when (
            Json
                .parseToJsonElement(body)
                .jsonObject["method"]!!
                .jsonPrimitive.content
        ) {
            "get_info" -> Json.parseToJsonElement(info)
            "get_unread_count" -> JsonPrimitive(unread)
            "get_profiles" -> rig.fixture("get_profiles.json")
            else -> JsonPrimitive("unexpected")
        },
    )
}
