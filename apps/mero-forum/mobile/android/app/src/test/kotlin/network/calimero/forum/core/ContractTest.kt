package network.calimero.forum.core

import com.calimero.mero.AppError
import com.calimero.mero.ConsentStale
import com.calimero.mero.WrongNode
import com.calimero.mero.testkit.InMemoryAppBackend
import com.calimero.mero.testkit.RecordedContractCall
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import network.calimero.forum.contract.ForumContract
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** The typed client against the component contract's wire. (iOS `ContractTests`.) */
class ContractTest {
    private val abiCalls =
        setOf(
            "createComment", "createPost", "deleteComment", "deletePost", "editComment", "editPost", "moderateComment",
            "moderatePost", "setModerators", "setNickname", "vote", "voteComment",
        )
    private val abiViews = setOf("getNickname", "getPost", "listComments", "listPosts", "moderators")

    /** The committed `logic/res/abi.json` when this checkout has the component port, else the lists above (calimero-network/apps#715). */
    private fun abi(): Pair<Set<String>, Set<String>> {
        val methods =
            runCatching { Json.parseToJsonElement(File("../../../logic/res/abi.json").readText()).jsonObject["methods"]?.jsonObject }.getOrNull()
                ?: return abiCalls to abiViews
        if (methods.values.none { (it as? JsonObject)?.get("kind") != null }) return abiCalls to abiViews

        fun kind(k: String) = methods.filter { (it.value as JsonObject)["kind"]?.jsonPrimitive?.content == k }.keys
        return kind("call") to kind("view")
    }

    @Test
    fun `method lists match the abi`() {
        val (calls, views) = abi()
        assertEquals(calls, ForumContract.CALLS.toSet())
        assertEquals(views, ForumContract.VIEWS.toSet())
    }

    @Test
    fun `calls use camel case names and arguments`() =
        runTest {
            val backend = InMemoryAppBackend(account = "ab".repeat(32))
            backend.recording.handler = { call -> if (call.method == "createComment") JsonPrimitive("c1") else JsonNull as JsonElement }
            val client = forumClient(backend.contract, "app1")
            assertEquals("c1", client.createComment("p1", "hi"))
            client.vote("p1", -1)
            client.moderateComment("c1")
            assertEquals(
                buildJsonObject {
                    put("postId", "p1")
                    put("body", "hi")
                },
                backend.recording
                    .calls("createComment")
                    .first()
                    .args,
            )
            assertEquals(
                buildJsonObject {
                    put("postId", "p1")
                    put("value", -1)
                },
                backend.recording
                    .calls("vote")
                    .first()
                    .args,
            )
            assertEquals(
                RecordedContractCall.Path.EXECUTE,
                backend.recording
                    .calls("moderateComment")
                    .first()
                    .path,
            )
        }

    @Test
    fun `list posts decodes the component answer`() =
        runTest {
            val wire =
                """{"items":[{"id":"p1","author":"acc1","authorName":"Ana","title":"Hello","body":"First",
                "createdAt":"1700000000000","editedAt":"0","score":"-2","commentCount":"3","myVote":-1}],"nextCursor":"opaque"}"""
            val backend = InMemoryAppBackend(account = "ab".repeat(32))
            backend.recording.handler = { Json.parseToJsonElement(wire) }
            val page = forumClient(backend.contract, "app1").listPosts("top", null, 20u)
            val call = backend.recording.calls("listPosts").first()
            assertEquals(RecordedContractCall.Path.QUERY, call.path)
            assertEquals(
                buildJsonObject {
                    put("sort", "top")
                    put("cursor", JsonNull)
                    put("limit", 20)
                },
                call.args,
            )
            assertEquals("opaque", page.nextCursor)
            val post = page.items.first()
            assertEquals(1_700_000_000_000uL, post.createdAt)
            assertEquals(-2L, post.score)
            assertEquals(3uL, post.commentCount)
            assertEquals(-1, post.myVote.toInt())
        }

    @Test
    fun `errors in words`() {
        assertTrue(ForumErrorText.describe(WrongNode("wrong")).contains("doesn't serve your account"))
        assertTrue(ForumErrorText.describe(ConsentStale("stale")).contains("out of date"))

        fun refusal(
            code: String,
            fields: JsonObject,
        ) = AppError(
            "refused",
            buildJsonObject {
                put("code", code)
                put("fields", fields)
            },
        )
        assertEquals(
            "Only a moderator can do that.",
            ForumErrorText.describe(refusal("Forbidden", buildJsonObject { put("message", "only a moderator can do that") })),
        )
        assertEquals(
            "This post no longer exists. It may have been deleted.",
            ForumErrorText.describe(
                refusal(
                    "NotFound",
                    buildJsonObject {
                        put("what", "post")
                        put("id", "p1")
                    },
                ),
            ),
        )
    }
}
