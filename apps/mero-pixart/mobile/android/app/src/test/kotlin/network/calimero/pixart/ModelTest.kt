package network.calimero.pixart

import com.calimero.mero.app.AppNamespace
import com.calimero.mero.testkit.RecordedContractCall
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import network.calimero.pixart.app.ArtworkModel
import network.calimero.pixart.app.LoadState
import network.calimero.pixart.app.ProjectsModel
import network.calimero.pixart.app.TeamsModel
import network.calimero.pixart.core.BlobLoading
import network.calimero.pixart.core.BlobStore
import network.calimero.pixart.core.InvitationModel
import network.calimero.pixart.core.NoBlobs
import network.calimero.pixart.core.PixartInvitation
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.net.UnknownHostException

/** The same cases as the iOS `ModelTests` and `InvitationTests`, against the SDK's in-memory backend. */
@OptIn(ExperimentalCoroutinesApi::class)
class ModelTest {
    private val raster = FakeRasterizer()

    private fun blobs(table: Map<String, String> = emptyMap()): Pair<BlobStore, MutableList<String>> {
        val asked = mutableListOf<String>()
        val loader =
            BlobLoading { id, ctx ->
                asked += "$id@$ctx"
                table[id]?.encodeToByteArray() ?: throw IOException("missing")
            }
        return BlobStore(loader, raster) to asked
    }

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
    fun `projects take the document's name and size`() =
        runTest {
            val backend = Fixtures.backend()
            val model = ProjectsModel(backend, Fixtures.team, BlobStore(NoBlobs, raster), raster, StandardTestDispatcher(testScheduler))
            model.load()
            val p = model.projects.value.single()
            assertEquals("Poster", p.name)
            assertEquals(4u, p.width)
            assertEquals(1, p.layerCount)
            assertEquals(
                RecordedContractCall.Path.QUERY,
                backend.recording
                    .calls("get_document")
                    .first()
                    .path,
            )
        }

    @Test
    fun `a thumbnail is composited`() =
        runTest {
            val backend = Fixtures.backend(mutableMapOf("get_layers" to "[" + Fixtures.layerJson("a", blob = "px") + "]"))
            val (store, asked) = blobs(mapOf("px" to "4x4"))
            val model = ProjectsModel(backend, Fixtures.team, store, raster, StandardTestDispatcher(testScheduler))
            model.load()
            model.loadThumbnail(Fixtures.project)
            val thumb = model.thumbnails.value[Fixtures.project] as FakeRaster
            assertEquals(4, thumb.width)
            assertEquals("a", thumb.label)
            assertEquals(listOf("px@${Fixtures.project}"), asked)
        }

    @Test
    fun `opening joins then composites`() =
        runTest {
            val backend = Fixtures.backend(mutableMapOf("get_layers" to "[" + Fixtures.layerJson("a", blob = "px") + "]"), memberOfProject = false)
            val (store, _) = blobs(mapOf("px" to "4x4"))
            val model = ArtworkModel(backend, Fixtures.team, Fixtures.project, "", store, raster, StandardTestDispatcher(testScheduler))
            model.open()
            assertEquals(ArtworkModel.Phase.Ready, model.phase.value)
            assertTrue(backend.log.contains("joinContext ${Fixtures.project}"))
            assertEquals("Poster", model.name.value)
            assertEquals("viewer", model.role.value)
            assertEquals("a", (model.image.value as FakeRaster).label)
            assertEquals(0, model.missing.value)
        }

    @Test
    fun `hiding is local and never written`() =
        runTest {
            val backend = Fixtures.backend(mutableMapOf("get_layers" to "[" + Fixtures.layerJson("a", kind = "fill") + "]"))
            val model = ArtworkModel(backend, Fixtures.team, Fixtures.project, "", BlobStore(NoBlobs, raster), raster, StandardTestDispatcher(testScheduler))
            model.open()
            assertEquals("a", (model.image.value as FakeRaster).label)
            model.toggle("a")
            assertEquals(mapOf("a" to false), model.overrides.value)
            assertEquals("", (model.image.value as FakeRaster).label)
            assertTrue(model.rows()[0].overridden)
            model.toggle("a")
            assertEquals(emptyMap<String, Boolean>(), model.overrides.value)
            assertTrue(backend.recording.calls.all { it.path == RecordedContractCall.Path.QUERY })
        }

    @Test
    fun `a missing blob is counted`() =
        runTest {
            val backend = Fixtures.backend(mutableMapOf("get_layers" to "[" + Fixtures.layerJson("a", blob = "gone") + "]"))
            val model = ArtworkModel(backend, Fixtures.team, Fixtures.project, "", BlobStore(NoBlobs, raster), raster, StandardTestDispatcher(testScheduler))
            model.open()
            assertEquals(1, model.missing.value)
            assertNotNull(model.image.value)
        }

    @Test
    fun `export is a png of what this phone shows`() =
        runTest {
            val backend = Fixtures.backend(mutableMapOf("get_layers" to "[" + Fixtures.layerJson("a", kind = "fill") + "]"))
            val model = ArtworkModel(backend, Fixtures.team, Fixtures.project, "", BlobStore(NoBlobs, raster), raster, StandardTestDispatcher(testScheduler))
            model.open()
            model.toggle("a")
            assertEquals("png:", model.exportPng()?.decodeToString())
        }

    @Test
    fun `refresh picks up a new layer`() =
        runTest {
            val table = mutableMapOf("get_layers" to "[]")
            val backend = Fixtures.backend(table)
            val model = ArtworkModel(backend, Fixtures.team, Fixtures.project, "", BlobStore(NoBlobs, raster), raster, StandardTestDispatcher(testScheduler))
            model.open()
            assertEquals("", (model.image.value as FakeRaster).label)
            table["get_layers"] = "[" + Fixtures.layerJson("a", kind = "fill") + "]"
            model.refresh()
            assertEquals(1, model.layers.value.size)
            assertEquals("a", (model.image.value as FakeRaster).label)
        }

    private val signedJson =
        """{"invitation":{"inviter_identity":[1,2],"group_id":[170,170],"expiration_timestamp":9,"secret_salt":[3]},"inviter_signature":"sig"}"""

    @Test
    fun `the web's invitation payload parses`() {
        val inv = PixartInvitation.parseJson("""{"invitation":$signedJson,"groupName":"g","__teamName":"Studio"}""")!!
        assertEquals("aaaa", inv.namespaceId)
        assertEquals("Studio", inv.title)
    }

    @Test
    fun `an invitation link round trips and other apps are refused`() {
        val inv = PixartInvitation.parseJson("""{"invitation":$signedJson}""")!!
        val link = inv.copy(teamName = "Studio").link()
        assertTrue(link.contains("com.calimero.mero-pixart/join?invitation="))
        assertEquals("Studio", PixartInvitation.parse(link)?.teamName)
        assertNull(PixartInvitation.parse(link.replace("mero-pixart", "mero-chat")))
    }

    @Test
    fun `accept joins the team`() =
        runTest {
            val backend = Fixtures.backend()
            val model = InvitationModel()
            val inv = PixartInvitation.parseJson("""{"invitation":$signedJson,"__teamName":"Studio"}""")!!
            assertTrue(model.open(inv.link()))
            assertEquals(InvitationModel.Stage.Confirm("Studio"), model.stage.value)
            var joined = false
            model.accept(backend = { backend }, didJoin = { joined = true })
            assertTrue(joined)
            assertEquals(InvitationModel.Stage.Joined("aaaa", "Studio"), model.stage.value)
            assertFalse(model.open("https://example.com"))
        }
}
