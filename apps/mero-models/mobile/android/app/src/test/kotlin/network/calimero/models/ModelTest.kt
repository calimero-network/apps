package network.calimero.models

import com.calimero.mero.app.AppContextEvent
import com.calimero.mero.app.AppNamespace
import com.calimero.mero.testkit.RecordedContractCall
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import network.calimero.models.core.BlobLoading
import network.calimero.models.core.LoadState
import network.calimero.models.core.ModelsFormat
import network.calimero.models.core.SceneModel
import network.calimero.models.core.ScenesModel
import network.calimero.models.core.StudiosModel
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.UnknownHostException

/** The same cases as the iOS `ModelTests`, against the SDK's in-memory backend. */
@OptIn(ExperimentalCoroutinesApi::class)
class ModelTest {
    private fun RecordedContractCall.arg(name: String) = args.jsonObject[name]

    private fun scene(backend: com.calimero.mero.testkit.InMemoryAppBackend = Fixtures.backend()) =
        SceneModel(backend, Fixtures.studio, Fixtures.scene, now = { Fixtures.NOW })

    @Test
    fun `studios list this account's studios`() =
        runTest {
            val backend = Fixtures.backend()
            backend.namespaces = backend.namespaces + AppNamespace("zz", null, "x")
            val model = StudiosModel(backend)
            model.load()
            assertEquals(LoadState.Loaded, model.state.value)
            assertEquals(listOf("Props", "Studio zz"), model.studios.value.map { it.name })
        }

    @Test
    fun `a studios failure is shown`() =
        runTest {
            val backend = Fixtures.backend()
            backend.failure = UnknownHostException("relay.test")
            val model = StudiosModel(backend)
            model.load()
            assertEquals(LoadState.Failed("You're offline. Check your connection and try again."), model.state.value)
        }

    @Test
    fun `scenes take the scene's own name`() =
        runTest {
            val model = ScenesModel(Fixtures.backend(), Fixtures.studio)
            model.load()
            val s = model.scenes.value.single()
            assertEquals("Crate kit", s.name)
            assertEquals(3, s.objectCount)
            assertEquals(2, s.memberCount)
        }

    @Test
    fun `a scene reads everything through query`() =
        runTest {
            val backend = Fixtures.backend()
            val model = scene(backend)
            model.open()
            assertEquals(SceneModel.Phase.Ready, model.phase.value)
            assertEquals("Crate kit", model.name.value)
            assertEquals(4, model.objects.value.size)
            assertTrue(backend.recording.calls.all { it.path == RecordedContractCall.Path.QUERY })
            assertEquals(
                Fixtures.NOW,
                backend.recording
                    .calls("list_locks")
                    .first()
                    .arg("now")!!
                    .jsonPrimitive.long,
            )
            assertNotNull(model.viewerJson())
        }

    @Test
    fun `the outline is the hierarchy in creation order`() =
        runTest {
            val model = scene()
            model.open()
            val rows = model.outline()
            assertEquals(listOf("sun", "crate", "lid", "orphan"), rows.map { it.id })
            assertEquals(listOf(0, 0, 1, 0), rows.map { it.depth })
            assertEquals(Fixtures.ana, rows.first { it.id == "crate" }.lock?.holder)
        }

    @Test
    fun `check-outs are live, newest first and named`() =
        runTest {
            val model = scene()
            model.open()
            val rows = model.checkOuts()
            assertEquals(listOf("tex1", "crate"), rows.map { it.assetId })
            assertEquals(listOf("You", "Ana"), rows.map { it.holderName })
            assertEquals(listOf("Crate albedo", "Crate"), rows.map { it.assetName })
            assertEquals(listOf("texture", "mesh"), rows.map { it.assetKind })
        }

    @Test
    fun `Guest is no name`() =
        runTest {
            val model = scene()
            model.open()
            assertEquals(ModelsFormat.shortId(Fixtures.me), model.nameFor(Fixtures.me))
            assertEquals("Ana", model.nameFor(Fixtures.ana))
        }

    @Test
    fun `opening a scene this account is not in joins it`() =
        runTest {
            val backend = Fixtures.backend(memberOfScene = false)
            val model = scene(backend)
            model.open()
            assertTrue("joinContext ${Fixtures.scene}" in backend.log)
            assertEquals(SceneModel.Phase.Ready, model.phase.value)
        }

    @Test
    fun `a failed read is shown`() =
        runTest {
            val backend = Fixtures.backend()
            backend.recording.handler = { throw UnknownHostException("relay.test") }
            val model = scene(backend)
            model.open()
            assertEquals(SceneModel.Phase.Failed("You're offline. Check your connection and try again."), model.phase.value)
        }

    @Test
    fun `an event re-reads the scene`() =
        runTest {
            val backend = Fixtures.backend()
            val model = scene(backend)
            model.open()
            val before = backend.recording.calls("get_objects").size
            val live = launch { model.live() }
            runCurrent()
            backend.emit(AppContextEvent(Fixtures.scene, "StateMutation"))
            runCurrent()
            live.cancel()
            assertTrue(backend.recording.calls("get_objects").size > before)
        }

    @Test
    fun `blobs are read once`() =
        runTest {
            var count = 0
            val blobs =
                BlobLoading { _, _ ->
                    count += 1
                    byteArrayOf(1, 2, 3)
                }
            val model = SceneModel(Fixtures.backend(), Fixtures.studio, Fixtures.scene, blobs = blobs)
            val a = model.blob("x")
            val b = model.blob("x")
            assertArrayEquals(byteArrayOf(1, 2, 3), a)
            assertArrayEquals(a, b)
            assertEquals(1, count)
        }
}
