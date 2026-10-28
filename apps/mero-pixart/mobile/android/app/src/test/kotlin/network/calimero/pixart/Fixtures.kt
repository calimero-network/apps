package network.calimero.pixart

import com.calimero.mero.app.AppNamespace
import com.calimero.mero.app.AppSubgroup
import com.calimero.mero.testkit.InMemoryAppBackend
import kotlinx.serialization.json.Json
import network.calimero.pixart.core.DrawOp
import network.calimero.pixart.core.Raster
import network.calimero.pixart.core.Rasterizer
import network.calimero.pixart.generated.Layer

/** Contract answers shaped as the contract returns them; the twin of the iOS `Fixtures`. */
object Fixtures {
    val me = "ab".repeat(32)
    val ana = "cd".repeat(32)
    val team = "aa".repeat(32)
    val project = "cc".repeat(32)
    val group = "bb".repeat(32)

    @Suppress("LongParameterList")
    fun layerJson(
        id: String,
        kind: String = "raster",
        parent: String? = null,
        index: Int = 0,
        visible: Boolean = true,
        opacity: Int = 100,
        blend: String = "normal",
        x: Int = 0,
        y: Int = 0,
        w: Int = 4,
        h: Int = 4,
        rotation: Int = 0,
        blob: String = "",
        mask: String? = null,
        fill: String = "#000000",
        brightness: Int = 0,
        invert: Boolean = false,
        blur: Int = 0,
        text: String? = null,
    ): String {
        val parentJson = parent?.let { "\"$it\"" } ?: "null"
        val maskJson = mask?.let { "\"$it\"" } ?: "null"
        val textJson =
            text?.let {
                """{"content":"$it","fontFamily":"sans-serif","fontSize":12,"color":"#000000","bold":false,"italic":false,"align":"left"}"""
            } ?: "null"
        return """{"id":"$id","name":"Layer $id","kind":"$kind","parentId":$parentJson,"layerIndex":$index,""" +
            """"visible":$visible,"locked":false,"opacity":$opacity,"blendMode":"$blend","x":$x,"y":$y,""" +
            """"width":$w,"height":$h,"rotation":$rotation,"scaleX":100,"scaleY":100,"skewX":0,"skewY":0,""" +
            """"flipH":false,"flipV":false,"warp":"","blobId":"$blob","maskBlobId":$maskJson,"fill":"$fill",""" +
            """"adjustments":{"brightness":$brightness,"contrast":0,"saturation":0,"hue":0,"exposure":0,"blur":$blur,""" +
            """"invert":$invert,"curves":""},"text":$textJson,"createdBy":"$ana","createdAt":1,"updatedAt":1}"""
    }

    private val json = Json { ignoreUnknownKeys = true }

    fun layers(vararg items: String): List<Layer> = json.decodeFromString("[" + items.joinToString(",") + "]")

    fun layer(item: String): Layer = layers(item).single()

    fun document(
        w: Int = 4,
        h: Int = 4,
        background: String = "#ffffff",
        layers: Int = 1,
    ) = """{"name":"Poster","description":"Spring launch","width":$w,"height":$h,"background":"$background","layerCount":$layers,"memberCount":2,"owner":null}"""

    /** An in-memory account with one team, one project, and its contract scripted from [table]. */
    fun backend(
        table: MutableMap<String, String> = mutableMapOf(),
        memberOfProject: Boolean = true,
    ): InMemoryAppBackend {
        table.putIfAbsent("get_layers", "[]")
        table.putIfAbsent("get_document", document())
        table.putIfAbsent("get_members", "[]")
        table.putIfAbsent("my_role", "\"viewer\"")
        val backend = InMemoryAppBackend(account = me)
        backend.namespaces = listOf(AppNamespace(team, "Studio", backend.applicationId, 3))
        backend.subgroups = mapOf(team to listOf(AppSubgroup(group, "poster", listOf(project))))
        if (memberOfProject) backend.members = setOf(project)
        backend.recording.handler = { call -> Json.parseToJsonElement(table[call.method] ?: "null") }
        return backend
    }
}

/** A raster that is just its size and where it came from. */
data class FakeRaster(
    override val width: Int,
    override val height: Int,
    val label: String,
) : Raster

/** Decodes `"w×h"` byte strings and records each composite's ops, since `android.graphics` does not run on the JVM. */
class FakeRasterizer : Rasterizer {
    val composites = mutableListOf<List<DrawOp>>()

    override fun decode(bytes: ByteArray): Raster? {
        val text = bytes.decodeToString()
        val (w, h) = text.split("x").mapNotNull { it.toIntOrNull() }.takeIf { it.size == 2 } ?: return null
        return FakeRaster(w, h, text)
    }

    override fun composite(
        width: Int,
        height: Int,
        background: String,
        ops: List<DrawOp>,
        images: Map<String, Raster>,
        scale: Double,
    ): Raster {
        composites += ops
        val drawn = ops.filter { op -> (op.source as? network.calimero.pixart.core.LayerSource.Raster)?.let { it.blobId in images } ?: true }
        return FakeRaster((width * scale).toInt(), (height * scale).toInt(), drawn.joinToString(",") { it.layerId })
    }

    override fun png(raster: Raster): ByteArray = "png:${(raster as FakeRaster).label}".encodeToByteArray()
}
