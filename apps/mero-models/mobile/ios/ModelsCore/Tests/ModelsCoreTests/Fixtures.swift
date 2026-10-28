import Foundation
import MeroKit
import MeroKitTestSupport
@testable import ModelsCore

/// Contract answers shaped as the contract returns them; the twin of the Android `Fixtures`.
enum Fixtures {
    static let me = String(repeating: "ab", count: 32)
    static let ana = String(repeating: "cd", count: 32)
    static let studio = String(repeating: "aa", count: 32)
    static let scene = String(repeating: "cc", count: 32)
    static let now: UInt64 = 1_800_000_000_000

    static func object(_ id: String, _ kind: String = "cube", parent: String = "", createdAt: Int = 1, name: String? = nil) -> String {
        """
        {"id":"\(id)","name":"\(name ?? id)","kind":"\(kind)","parent":"\(parent)",\
        "position":{"x":0,"y":0.5,"z":0},"rotation":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1},\
        "visible":true,"material":{"color":"#a5ff11","metalness":0,"roughness":0.5,"opacity":1,\
        "emissive":"#000000","wireframe":false,"flat_shading":true,"base_color_map":"","normal_map":"",\
        "normal_scale":1,"orm_map":"","emissive_map":""},"segments":32,"intensity":1,\
        "created_by":"\(ana)","created_at":\(createdAt),"updated_at":\(createdAt)}
        """
    }

    static let sceneInfo = """
        {"name":"Crate kit","environment":{"name":"","background":"#24262b","ambient_color":"#ffffff",\
        "ambient_intensity":0.35,"updated_at":0},"object_count":3,"mesh_count":1,"texture_count":1,\
        "member_count":2,"me":"\(me)","my_role":"viewer"}
        """

    static let objects = "[" + [
        object("crate", "mesh", createdAt: 2, name: "Crate"),
        object("lid", "cube", parent: "crate", createdAt: 3, name: "Lid"),
        object("sun", "directional_light", createdAt: 1, name: "Sun"),
        object("orphan", "sphere", parent: "missing", createdAt: 4, name: "Ball"),
    ].joined(separator: ",") + "]"

    static let meshes = """
        [{"id":"crate","blob_id":"\(String(repeating: "0f", count: 32))","size":120,"vertex_count":8,\
        "triangle_count":12,"has_uvs":true,"author":"\(ana)","message":"","updated_at":2}]
        """

    static let textures = """
        [{"id":"tex1","name":"Crate albedo","blob_id":"\(String(repeating: "1e", count: 32))","size":10,\
        "width":512,"height":512,"mime":"image/png","color_space":"srgb","author":"\(ana)","message":"","updated_at":2}]
        """

    static let locks = """
        [{"asset_id":"crate","holder":"\(ana)","since":\(now - 3_600_000),"expires_at":\(now + 3_600_000),"mine":false},\
        {"asset_id":"tex1","holder":"\(me)","since":\(now - 60_000),"expires_at":\(now + 60_000),"mine":true},\
        {"asset_id":"lid","holder":"\(ana)","since":\(now - 7_200_000),"expires_at":\(now - 1),"mine":false}]
        """

    static let members = """
        [{"id":"\(ana)","name":"Ana","role":"admin","joined_at":1},{"id":"\(me)","name":"Guest","role":"viewer","joined_at":2}]
        """

    /// An in-memory account with one studio holding one scene, the scene's contract scripted.
    static func backend(memberOfScene: Bool = true) -> InMemoryAppBackend {
        let backend = InMemoryAppBackend(account: me)
        backend.namespaces = [AppNamespace(id: studio, name: "Props", applicationId: backend.applicationId, memberCount: 3)]
        backend.rootContexts = [studio: [scene]]
        if memberOfScene { backend.members = [scene] }
        let table: [String: String] = [
            "get_scene": sceneInfo, "get_objects": objects, "list_meshes": meshes, "list_textures": textures,
            "list_locks": locks, "get_members": members,
        ]
        backend.recording.setRawHandler { call in table[call.method].map { Data($0.utf8) } }
        return backend
    }
}
