package network.calimero.design

import com.calimero.mero.app.AppContextEvent
import com.calimero.mero.app.AppNamespace
import com.calimero.mero.testkit.RecordedContractCall
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import network.calimero.design.app.BoardModel
import network.calimero.design.app.BoardsModel
import network.calimero.design.app.LoadState
import network.calimero.design.app.TeamsModel
import network.calimero.design.core.BlobLoading
import network.calimero.design.core.Point
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.UnknownHostException

/** The same cases as the iOS `ModelTests`, against the SDK's in-memory backend. */
@OptIn(ExperimentalCoroutinesApi::class)
class ModelTest {
    private fun RecordedContractCall.arg(name: String) = args.jsonObject[name]

    @Test
    fun `teams list this account's teams`() =
        runTest {
            val backend = Fixtures.backend()
            backend.namespaces = backend.namespaces + AppNamespace("zz", null, "x")
            val model = TeamsModel(backend)
            model.load()
            assertEquals(LoadState.Loaded, model.state.value)
            assertEquals(listOf("Studio", "Team zz"), model.teams.value.map { it.name })
        }

    @Test
    fun `a teams failure is shown`() =
        runTest {
            val backend = Fixtures.backend()
            backend.failure = UnknownHostException("relay.test")
            val model = TeamsModel(backend)
            model.load()
            assertEquals(LoadState.Failed("You're offline. Check your connection and try again."), model.state.value)
        }

    @Test
    fun `boards take the board's own name`() =
        runTest {
            val backend = Fixtures.backend()
            val model = BoardsModel(backend, Fixtures.team)
            model.load()
            val board = model.boards.value.single()
            assertEquals("Landing v2", board.name)
            assertEquals("Hero and pricing", board.description)
            assertEquals(3, board.elementCount)
            assertEquals(
                RecordedContractCall.Path.QUERY,
                backend.recording
                    .calls("get_board")
                    .first()
                    .path,
            )
        }

    @Test
    fun `opening joins the board then draws it`() =
        runTest {
            val backend =
                Fixtures.backend(
                    elements = "[" + Fixtures.element("r", Fixtures.RECT) + "," + Fixtures.element("p", Fixtures.image("blob9")) + "]",
                    memberOfBoard = false,
                )
            val asked = mutableListOf<String>()
            val blobs =
                BlobLoading { id, ctx ->
                    asked += "$id@$ctx"
                    byteArrayOf(1, 2, 3)
                }
            val model = BoardModel(backend, Fixtures.team, Fixtures.board, scope = backgroundScope, blobs = blobs)
            model.open()
            runCurrent()
            assertEquals(BoardModel.Phase.Ready, model.phase.value)
            assertTrue(backend.log.contains("joinContext ${Fixtures.board}"))
            assertEquals(2, model.scene.value.nodes.size)
            assertEquals("Landing v2", model.name.value)
            assertEquals("editor", model.role.value)
            assertTrue(model.canComment)
            assertArrayEquals(byteArrayOf(1, 2, 3), model.images.value["blob9"])
            assertEquals(listOf("blob9@${Fixtures.board}"), asked)
        }

    @Test
    fun `a viewer cannot comment`() =
        runTest {
            val model = BoardModel(Fixtures.backend(role = "viewer"), Fixtures.team, Fixtures.board, scope = backgroundScope)
            model.open()
            assertFalse(model.canComment)
        }

    @Test
    fun `a first comment joins the roster then pins`() =
        runTest {
            val backend = Fixtures.backend()
            val model = BoardModel(backend, Fixtures.team, Fixtures.board, scope = backgroundScope, now = { 1_700_000_000_000L })
            model.open()
            assertNull(model.myName)
            model.addComment("  Bigger logo?  ", Point(120.4, 89.6), joinAs = "Fran")
            val join = backend.recording.calls("join").single()
            assertEquals(RecordedContractCall.Path.EXECUTE, join.path)
            assertEquals(JsonPrimitive("Fran"), join.arg("username"))
            val add = backend.recording.calls("add_comment").single()
            assertEquals(RecordedContractCall.Path.EXECUTE, add.path)
            assertEquals(JsonPrimitive("Bigger logo?"), add.arg("content"))
            assertEquals("120", add.arg("x").toString())
            assertEquals("90", add.arg("y").toString())
            assertEquals("1700000000000", add.arg("created_at").toString())
            assertEquals("Fran", model.myName)
            assertEquals(1, model.comments.value.size)
            assertEquals("Fran", model.nameFor(Fixtures.me))
        }

    @Test
    fun `reply and names from the roster`() =
        runTest {
            val members =
                """[{"id":"${Fixtures.ana}","username":"Ana","avatar":null,"joinedAt":1,"usernameUpdatedAt":1},""" +
                    """{"id":"${Fixtures.me}","username":"Fran","avatar":null,"joinedAt":1,"usernameUpdatedAt":1}]"""
            val comments =
                """[{"id":"c2","x":5,"y":5,"content":"later","author":"${Fixtures.ana}","createdAt":20,"replies":[]},""" +
                    """{"id":"c1","x":1,"y":1,"content":"first","author":"${Fixtures.ana}","createdAt":10,"replies":[]}]"""
            val backend = Fixtures.backend(comments = comments, members = members)
            val model = BoardModel(backend, Fixtures.team, Fixtures.board, scope = backgroundScope)
            model.open()
            assertEquals(listOf("c1", "c2"), model.comments.value.map { it.id })
            assertEquals("Ana", model.nameFor(Fixtures.ana))
            assertEquals("ff", model.nameFor("ff"))
            model.reply("c1", "Agreed")
            assertTrue(backend.recording.calls("join").isEmpty())
            val reply = backend.recording.calls("add_reply").single()
            assertEquals(JsonPrimitive("c1"), reply.arg("comment_id"))
            assertEquals(JsonPrimitive("Agreed"), reply.arg("content"))
        }

    @Test
    fun `viewers are others who moved recently`() =
        runTest {
            val now = 1_700_000_000_000L
            val cursors =
                """[{"identity":"i1","account":"${Fixtures.ana}","x":10,"y":20,"updatedAt":${now - 2000}},""" +
                    """{"identity":"i2","account":"${Fixtures.me}","x":0,"y":0,"updatedAt":$now},""" +
                    """{"identity":"i3","account":"ee","x":0,"y":0,"updatedAt":${now - 60000}}]"""
            val model = BoardModel(Fixtures.backend(cursors = cursors), Fixtures.team, Fixtures.board, scope = backgroundScope, now = { now })
            model.open()
            assertEquals(listOf(Fixtures.ana), model.viewers.value.map { it.account })
            assertEquals(
                Point(10.0, 20.0),
                model.viewers.value
                    .first()
                    .point,
            )
        }

    @Test
    fun `events reload the board`() =
        runTest {
            val backend = Fixtures.backend()
            val model = BoardModel(backend, Fixtures.team, Fixtures.board, scope = backgroundScope)
            model.open()
            val before = backend.recording.calls("get_elements").size
            val job = launch { model.live() }
            runCurrent()
            backend.emit(AppContextEvent(Fixtures.board, "StateMutation"))
            runCurrent()
            assertTrue(backend.recording.calls("get_elements").size > before)
            job.cancel()
            backend.finishEvents()
            advanceUntilIdle()
        }

    @Test
    fun `a failed read is shown`() =
        runTest {
            val backend = Fixtures.backend()
            backend.recording.handler = { throw UnknownHostException("relay.test") }
            val model = BoardModel(backend, Fixtures.team, Fixtures.board, scope = backgroundScope)
            model.open()
            assertEquals(BoardModel.Phase.Failed("You're offline. Check your connection and try again."), model.phase.value)
        }
}
