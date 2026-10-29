package network.calimero.models

import com.calimero.mero.app.AppNamespace
import com.calimero.mero.testkit.InMemoryAppBackend
import kotlinx.serialization.json.Json

/** Contract answers shaped as the contract returns them; the twin of the iOS `Fixtures`. */
object Fixtures {
    val me = "ab".repeat(32)
    val ana = "cd".repeat(32)
    val studio = "aa".repeat(32)
    val scene = "cc".repeat(32)
    const val NOW = 1_800_000_000_000L

    fun obj(
        id: String,
        kind: String = "cube",
        parent: String = "",
        createdAt: Int = 1,
        name: String = id,
    ) = """{"id":"$id","name":"$name","kind":"$kind","parent":"$parent",""" +
        """"position":{"x":0,"y":0.5,"z":0},"rotation":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1},""" +
        """"visible":true,"material":{"color":"#a5ff11","metalness":0,"roughness":0.5,"opacity":1,""" +
        """"emissive":"#000000","wireframe":false,"flat_shading":true,"base_color_map":"","normal_map":"",""" +
        """"normal_scale":1,"orm_map":"","emissive_map":""},"segments":32,"intensity":1,""" +
        """"created_by":"$ana","created_at":$createdAt,"updated_at":$createdAt}"""

    val sceneInfo =
        """{"name":"Crate kit","environment":{"name":"","background":"#24262b","ambient_color":"#ffffff",""" +
            """"ambient_intensity":0.35,"updated_at":0},"object_count":3,"mesh_count":1,"texture_count":1,""" +
            """"member_count":2,"me":"$me","my_role":"viewer"}"""

    val objects =
        "[" +
            listOf(
                obj("crate", "mesh", createdAt = 2, name = "Crate"),
                obj("lid", "cube", parent = "crate", createdAt = 3, name = "Lid"),
                obj("sun", "directional_light", createdAt = 1, name = "Sun"),
                obj("orphan", "sphere", parent = "missing", createdAt = 4, name = "Ball"),
            ).joinToString(",") + "]"

    val meshes =
        """[{"id":"crate","blob_id":"${"0f".repeat(32)}","size":120,"vertex_count":8,"triangle_count":12,""" +
            """"has_uvs":true,"author":"$ana","message":"","updated_at":2}]"""

    val textures =
        """[{"id":"tex1","name":"Crate albedo","blob_id":"${"1e".repeat(32)}","size":10,"width":512,"height":512,""" +
            """"mime":"image/png","color_space":"srgb","author":"$ana","message":"","updated_at":2}]"""

    val locks =
        """[{"asset_id":"crate","holder":"$ana","since":${NOW - 3_600_000},"expires_at":${NOW + 3_600_000},"mine":false},""" +
            """{"asset_id":"tex1","holder":"$me","since":${NOW - 60_000},"expires_at":${NOW + 60_000},"mine":true},""" +
            """{"asset_id":"lid","holder":"$ana","since":${NOW - 7_200_000},"expires_at":${NOW - 1},"mine":false}]"""

    val members =
        """[{"id":"$ana","name":"Ana","role":"admin","joined_at":1},{"id":"$me","name":"Guest","role":"viewer","joined_at":2}]"""

    /** An in-memory account with one studio holding one scene, the scene's contract scripted. */
    fun backend(memberOfScene: Boolean = true): InMemoryAppBackend {
        val backend = InMemoryAppBackend(account = me)
        backend.namespaces = listOf(AppNamespace(studio, "Props", backend.applicationId, 3))
        backend.rootContexts = mapOf(studio to listOf(scene))
        if (memberOfScene) backend.members = setOf(scene)
        val table =
            mapOf(
                "get_scene" to sceneInfo,
                "get_objects" to objects,
                "list_meshes" to meshes,
                "list_textures" to textures,
                "list_locks" to locks,
                "get_members" to members,
            )
        backend.recording.handler = { call -> Json.parseToJsonElement(table[call.method] ?: "null") }
        return backend
    }
}
