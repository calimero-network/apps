package network.calimero.forum.core

import com.calimero.mero.app.AppContextEvent
import com.calimero.mero.testkit.InMemoryAppBackend
import com.calimero.mero.testkit.RecordedContractCall
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.int
import network.calimero.forum.generated.CommentPage
import network.calimero.forum.generated.PostPage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class FeedModelTest {
    private fun feed(
        backend: InMemoryAppBackend,
        name: String = "",
    ) = FeedModel(backend, forumRef(), MemoryNameStore(name))

    @Test
    fun `pages the feed by cursor`() =
        runTest {
            val (backend, script) = makeBackend()
            script.on("list_posts") { call ->
                if (call.string("cursor") == null) PostPage(listOf(post("p1"), post("p2")), "p2") else PostPage(listOf(post("p2"), post("p3")), null)
            }
            val model = feed(backend)
            model.refresh()
            assertEquals(LoadPhase.Loaded, model.phase.value)
            assertEquals(listOf("p1", "p2"), model.posts.value.map { it.id })
            assertTrue(model.hasMore.value)
            model.loadMore()
            assertEquals(listOf("p1", "p2", "p3"), model.posts.value.map { it.id })
            assertTrue(!model.hasMore.value)
            val calls = backend.recording.calls("list_posts")
            assertEquals(listOf(RecordedContractCall.Path.QUERY, RecordedContractCall.Path.QUERY), calls.map { it.path })
            assertEquals("new", calls.first().string("sort"))
            assertEquals(CTX, calls.first().contextId)
            assertEquals("p2", calls.last().string("cursor"))
        }

    @Test
    fun `sort restarts the feed`() =
        runTest {
            val (backend, script) = makeBackend()
            script.on("list_posts") { call -> PostPage(listOf(post(call.string("sort") ?: "?")), null) }
            val model = feed(backend)
            model.refresh()
            model.setSort(FeedSort.TOP)
            assertEquals(listOf("top"), model.posts.value.map { it.id })
        }

    @Test
    fun `vote shows at once and undoes on failure`() =
        runTest {
            val (backend, script) = makeBackend()
            script.on("list_posts") { PostPage(listOf(post("p1", score = 3)), null) }
            val model = feed(backend)
            model.refresh()
            model.vote(model.posts.value[0], 1)
            assertEquals(4L, model.posts.value[0].score)
            assertEquals(1, model.posts.value[0].myVote)
            val call = backend.recording.calls("vote").first()
            assertEquals(RecordedContractCall.Path.EXECUTE, call.path)
            assertEquals(1, ((call.args as JsonObject)["value"] as JsonPrimitive).int)

            script.fail("vote")
            model.vote(model.posts.value[0], -1)
            assertEquals(4L, model.posts.value[0].score)
            assertEquals(1, model.posts.value[0].myVote)
            assertNotNull(model.notice.value)
        }

    @Test
    fun `create post needs title and text then refreshes`() =
        runTest {
            val (backend, script) = makeBackend()
            script.on("create_post") { "p9" }
            script.on("list_posts") { PostPage(listOf(post("p9", author = ME)), null) }
            val model = feed(backend)
            try {
                model.createPost("Hi", " ")
                fail("expected a refusal")
            } catch (_: ForumModelException) {
            }
            model.createPost(" Hello ", "World")
            val call = backend.recording.calls("create_post").first()
            assertEquals("Hello", call.string("title"))
            assertEquals("World", call.string("body"))
            assertEquals(listOf("p9"), model.posts.value.map { it.id })
            assertTrue(model.isMine(model.posts.value[0]))
        }

    @Test
    fun `delete and moderate`() =
        runTest {
            val (backend, script) = makeBackend()
            script.on("list_posts") { PostPage(listOf(post("p1", author = ME), post("p2")), null) }
            script.on("moderators") { listOf(ME) }
            val model = feed(backend)
            model.refresh()
            model.loadModerators()
            assertTrue(model.isModerator)
            model.delete(model.posts.value[0])
            assertEquals(
                "p1",
                backend.recording
                    .calls("delete_post")
                    .first()
                    .string("post_id"),
            )
            model.moderate(model.posts.value[0])
            assertEquals(
                "p2",
                backend.recording
                    .calls("moderate_post")
                    .first()
                    .string("post_id"),
            )
            assertTrue(model.posts.value.isEmpty())
        }

    @Test
    fun `a failed delete puts the post back`() =
        runTest {
            val (backend, script) = makeBackend()
            script.on("list_posts") { PostPage(listOf(post("p1", author = ME)), null) }
            script.fail("delete_post")
            val model = feed(backend)
            model.refresh()
            model.delete(model.posts.value[0])
            assertEquals(listOf("p1"), model.posts.value.map { it.id })
            assertNotNull(model.notice.value)
        }

    @Test
    fun `moderator list changes`() =
        runTest {
            val (backend, script) = makeBackend()
            script.on("moderators") { listOf(ME) }
            val model = feed(backend)
            model.loadModerators()
            model.addModerator(BOB.uppercase())
            assertEquals(listOf(ME, BOB), model.moderators.value)
            assertEquals(
                JsonArray(listOf(JsonPrimitive(ME), JsonPrimitive(BOB))),
                (
                    backend.recording
                        .calls("set_moderators")
                        .last()
                        .args as JsonObject
                )["accounts"],
            )
            try {
                model.addModerator("nope")
                fail("expected a refusal")
            } catch (_: ForumModelException) {
            }
            model.removeModerator(ME)
            assertEquals(listOf(BOB), model.moderators.value)
            try {
                model.removeModerator(BOB)
                fail("a forum keeps one moderator")
            } catch (e: ForumModelException) {
                assertEquals("A forum needs at least one moderator.", e.message)
            }
        }

    @Test
    fun `name pushed to the forum or adopted`() =
        runTest {
            val (backend, script) = makeBackend()
            script.on("get_nickname") { "" }
            feed(backend, "Ana").syncName()
            assertEquals(
                "Ana",
                backend.recording
                    .calls("set_nickname")
                    .first()
                    .string("name"),
            )

            val (other, otherScript) = makeBackend()
            otherScript.on("get_nickname") { "Remote" }
            val store = MemoryNameStore()
            val adopting = FeedModel(other, forumRef(), store)
            adopting.syncName()
            assertEquals("Remote", store.name)
            assertEquals("Remote", adopting.displayName.value)
            assertTrue(other.recording.calls("set_nickname").isEmpty())
        }

    @Test
    fun `rename updates your posts`() =
        runTest {
            val (backend, script) = makeBackend()
            script.on("list_posts") { PostPage(listOf(post("p1", author = ME, name = "Old")), null) }
            val store = MemoryNameStore("Old")
            val model = FeedModel(backend, forumRef(), store)
            model.refresh()
            model.rename(" New ")
            assertEquals("New", store.name)
            assertEquals("New", model.posts.value[0].authorName)
        }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun `live events refresh the feed`() =
        runTest {
            val (backend, script) = makeBackend()
            script.on("list_posts") { PostPage(listOf(post("p1")), null) }
            val model = feed(backend)
            val watching = backgroundScope.launch { model.watch() }
            runCurrent()
            assertEquals(1, backend.subscriberCount)
            backend.emit(AppContextEvent(CTX, "StateMutation"))
            runCurrent()
            assertEquals(listOf("p1"), model.posts.value.map { it.id })
            watching.cancel()
        }
}

class ThreadModelTest {
    private fun thread(backend: InMemoryAppBackend) = ThreadModel(backend, forumRef(), "p1")

    @Test
    fun `loads the post and its replies`() =
        runTest {
            val (backend, script) = makeBackend()
            script.on("get_post") { post("p1", comments = 2u) }
            script.on("list_comments") { call ->
                if (call.string("cursor") == null) CommentPage(listOf(comment("c1")), "c1") else CommentPage(listOf(comment("c2")), null)
            }
            val model = thread(backend)
            model.load()
            assertEquals("p1", model.post.value?.id)
            assertEquals(listOf("c1"), model.comments.value.map { it.id })
            model.loadMore()
            assertEquals(listOf("c1", "c2"), model.comments.value.map { it.id })
            assertEquals(
                "p1",
                backend.recording
                    .calls("list_comments")
                    .first()
                    .string("post_id"),
            )
        }

    @Test
    fun `reply posts and reloads`() =
        runTest {
            val (backend, script) = makeBackend()
            script.on("get_post") { post("p1", comments = 1u) }
            script.on("create_comment") { "c9" }
            script.on("list_comments") { CommentPage(listOf(comment("c9", author = ME)), null) }
            val model = thread(backend)
            model.reply("  thanks  ")
            assertEquals(
                "thanks",
                backend.recording
                    .calls("create_comment")
                    .first()
                    .string("body"),
            )
            assertEquals(listOf("c9"), model.comments.value.map { it.id })
            assertTrue(model.isMine(model.comments.value[0].author))
        }

    @Test
    fun `comment votes edits and removals`() =
        runTest {
            val (backend, script) = makeBackend()
            script.on("get_post") { post("p1", comments = 2u) }
            script.on("list_comments") { CommentPage(listOf(comment("c1", author = ME), comment("c2")), null) }
            val model = thread(backend)
            model.load()
            model.voteComment(model.comments.value[1], -1)
            assertEquals(-1L, model.comments.value[1].score)
            model.editComment(model.comments.value[0], "edited")
            assertEquals("edited", model.comments.value[0].body)
            assertEquals(
                "c1",
                backend.recording
                    .calls("edit_comment")
                    .first()
                    .string("comment_id"),
            )
            model.deleteComment(model.comments.value[0])
            model.moderateComment(model.comments.value[0])
            assertTrue(model.comments.value.isEmpty())
            assertEquals(0uL, model.post.value?.commentCount)
            assertEquals(
                "c2",
                backend.recording
                    .calls("moderate_comment")
                    .first()
                    .string("comment_id"),
            )
        }

    @Test
    fun `removing the post closes the thread`() =
        runTest {
            val (backend, script) = makeBackend()
            script.on("get_post") { post("p1") }
            script.on("list_comments") { CommentPage(emptyList(), null) }
            val model = thread(backend)
            model.load()
            assertTrue(model.moderatePost())
            assertTrue(model.isGone.value)
        }

    @Test
    fun `post vote rolls back`() =
        runTest {
            val (backend, script) = makeBackend()
            script.on("get_post") { post("p1", score = 1) }
            script.on("list_comments") { CommentPage(emptyList(), null) }
            script.fail("vote")
            val model = thread(backend)
            model.load()
            model.votePost(1)
            assertEquals(1L, model.post.value?.score)
            assertEquals(0, model.post.value?.myVote)
        }
}
