package network.calimero.design

import com.calimero.mero.app.AppNamespace
import com.calimero.mero.app.AppSubgroup
import com.calimero.mero.testkit.InMemoryAppBackend
import kotlinx.serialization.json.Json
import network.calimero.design.generated.Element

/** Contract answers shaped as the contract returns them; the twin of the iOS `Fixtures`. */
object Fixtures {
    val me = "ab".repeat(32)
    val ana = "cd".repeat(32)
    val team = "aa".repeat(32)
    val board = "cc".repeat(32)
    val group = "bb".repeat(32)

    @Suppress("LongParameterList")
    fun element(
        id: String,
        data: String,
        x: Int = 0,
        y: Int = 0,
        w: Int = 100,
        h: Int = 50,
        layer: Int = 0,
        fill: String = "#ffffff",
        stroke: String = "#1e1e1e",
        strokeWidth: Int = 2,
        label: String? = null,
        cornerRadius: Int? = null,
    ): String {
        val labelJson = label?.let { Json.encodeToString(kotlinx.serialization.serializer<String>(), it) } ?: "null"
        return """{"id":"$id","data":$data,"x":$x,"y":$y,"width":$w,"height":$h,"rotation":0,""" +
            """"fill":"$fill","stroke":"$stroke","strokeWidth":$strokeWidth,"opacity":100,"layerIndex":$layer,""" +
            """"createdBy":"$ana","createdAt":1,"updatedAt":1,"shadowColor":null,"shadowOffsetX":null,""" +
            """"shadowOffsetY":null,"shadowBlur":null,"label":$labelJson,"cornerRadius":${cornerRadius ?: "null"}}"""
    }

    const val RECT = """{"kind":"rect"}"""
    const val CIRCLE = """{"kind":"circle"}"""

    fun text(
        content: String,
        size: Int = 16,
        align: String = "left",
    ) = """{"kind":"text","content":"$content","fontSize":$size,"fontFamily":"sans-serif","bold":false,"italic":false,"text_align":"$align","vertical_align":"top"}"""

    fun image(blob: String) = """{"kind":"image","naturalWidth":10,"naturalHeight":10,"blobId":"$blob"}"""

    private val json = Json { ignoreUnknownKeys = true }

    fun decode(list: String): List<Element> = json.decodeFromString(list)

    /** An in-memory account with one team, one board, and the board's contract scripted. */
    fun backend(
        elements: String = "[]",
        comments: String = "[]",
        members: String = "[]",
        cursors: String = "[]",
        role: String = "editor",
        memberOfBoard: Boolean = true,
    ): InMemoryAppBackend {
        val backend = InMemoryAppBackend(account = me)
        backend.namespaces = listOf(AppNamespace(team, "Studio", backend.applicationId, 3))
        backend.subgroups = mapOf(team to listOf(AppSubgroup(group, "Landing page", listOf(board))))
        if (memberOfBoard) backend.members = setOf(board)
        val table =
            mapOf(
                "get_elements" to elements,
                "get_comments" to comments,
                "get_members" to members,
                "get_cursors" to cursors,
                "my_role" to "\"$role\"",
                "get_board" to """{"name":"Landing v2","description":"Hero and pricing","elementCount":3,"memberCount":2,"owner":null}""",
            )
        backend.recording.handler = { call -> Json.parseToJsonElement(table[call.method] ?: "null") }
        return backend
    }
}
