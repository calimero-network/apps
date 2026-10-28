import Foundation
import MeroKit
import MeroKitTestSupport

@testable import PixartCore

/// Contract answers shaped as the contract returns them (camelCase records),
/// shared by the stack, renderer and view-model tests. (Kotlin `Fixtures`.)
enum Fixtures {
    static let me = String(repeating: "ab", count: 32)
    static let ana = String(repeating: "cd", count: 32)
    static let team = String(repeating: "aa", count: 32)
    static let project = String(repeating: "cc", count: 32)
    static let group = String(repeating: "bb", count: 32)

    static func layerJSON(
        _ id: String, kind: String = "raster", parent: String? = nil, index: Int = 0, visible: Bool = true,
        opacity: Int = 100, blend: String = "normal", x: Int = 0, y: Int = 0, w: Int = 4, h: Int = 4,
        rotation: Int = 0, blob: String = "", mask: String? = nil, fill: String = "#000000",
        brightness: Int = 0, invert: Bool = false, blur: Int = 0, text: String? = nil, warp: String = ""
    ) -> String {
        let parentJSON = parent.map { "\"\($0)\"" } ?? "null"
        let maskJSON = mask.map { "\"\($0)\"" } ?? "null"
        let textJSON = text.map {
            ##"{"content":"\##($0)","fontFamily":"sans-serif","fontSize":12,"color":"#000000","bold":false,"italic":false,"align":"left"}"##
        } ?? "null"
        let warpJSON = warp.replacingOccurrences(of: "\"", with: "\\\"")
        return """
            {"id":"\(id)","name":"Layer \(id)","kind":"\(kind)","parentId":\(parentJSON),"layerIndex":\(index),\
            "visible":\(visible),"locked":false,"opacity":\(opacity),"blendMode":"\(blend)","x":\(x),"y":\(y),\
            "width":\(w),"height":\(h),"rotation":\(rotation),"scaleX":100,"scaleY":100,"skewX":0,"skewY":0,\
            "flipH":false,"flipV":false,"warp":"\(warpJSON)","blobId":"\(blob)","maskBlobId":\(maskJSON),"fill":"\(fill)",\
            "adjustments":{"brightness":\(brightness),"contrast":0,"saturation":0,"hue":0,"exposure":0,"blur":\(blur),\
            "invert":\(invert),"curves":""},"text":\(textJSON),"createdBy":"\(ana)","createdAt":1,"updatedAt":1}
            """
    }

    static func layers(_ items: [String]) -> [Layer] {
        try! JSONDecoder().decode([Layer].self, from: Data(("[" + items.joined(separator: ",") + "]").utf8))
    }

    static func layer(_ json: String) -> Layer { layers([json])[0] }

    static func document(w: Int = 4, h: Int = 4, background: String = "#ffffff", layers: Int = 1) -> String {
        #"{"name":"Poster","description":"Spring launch","width":\#(w),"height":\#(h),"background":"\#(background)","layerCount":\#(layers),"memberCount":2,"owner":null}"#
    }

    /// A solid `w`×`h` PNG.
    static func png(w: Int = 4, h: Int = 4, _ color: RGBA) -> Data {
        let px = (0..<(w * h)).flatMap { _ in
            [UInt8(color.r * 255), UInt8(color.g * 255), UInt8(color.b * 255), UInt8(color.a * 255)]
        }
        return Renderer.png(Bitmap(Renderer.cgImage(RGBAImage(width: w, height: h, pixels: px))!))!
    }

    /// An in-memory account with one team, one project, and its contract scripted.
    static func backend(
        layers: String = "[]", document: String = Fixtures.document(), members: String = "[]", role: String = "viewer",
        memberOfProject: Bool = true
    ) -> (InMemoryAppBackend, Answers) {
        let backend = InMemoryAppBackend(account: me)
        backend.namespaces = [AppNamespace(id: team, name: "Studio", applicationId: backend.applicationId, memberCount: 3)]
        backend.subgroups = [team: [AppSubgroup(groupId: group, name: "poster", contextIds: [project])]]
        if memberOfProject { backend.members = [project] }
        let answers = Answers([
            "get_layers": layers, "get_document": document, "get_members": members, "my_role": "\"\(role)\"",
        ])
        backend.recording.setRawHandler { call in Data(answers.answer(call.method).utf8) }
        return (backend, answers)
    }

    final class Answers: @unchecked Sendable {
        let lock = NSLock()
        var table: [String: String]
        init(_ table: [String: String]) { self.table = table }
        func answer(_ method: String) -> String {
            lock.lock()
            defer { lock.unlock() }
            return table[method] ?? "null"
        }
        func set(_ method: String, _ value: String) {
            lock.lock()
            table[method] = value
            lock.unlock()
        }
    }
}

/// Blobs from a table; records what was asked.
final class FakeBlobs: BlobLoading, @unchecked Sendable {
    let table: [String: Data]
    private let lock = NSLock()
    private var _asked: [String] = []
    init(_ table: [String: Data]) { self.table = table }
    var asked: [String] {
        lock.lock()
        defer { lock.unlock() }
        return _asked
    }
    func blob(id: String, contextId: String) async throws -> Data {
        lock.lock()
        _asked.append("\(id)@\(contextId)")
        lock.unlock()
        guard let d = table[id] else { throw URLError(.fileDoesNotExist) }
        return d
    }
}

extension Bitmap {
    /// Straight-alpha pixel at (x, y), top-left origin.
    func pixel(_ x: Int, _ y: Int) -> (Int, Int, Int, Int) {
        let p = Renderer.rgba(image, width, height)[x, y]
        return (Int(p.0), Int(p.1), Int(p.2), Int(p.3))
    }
}
