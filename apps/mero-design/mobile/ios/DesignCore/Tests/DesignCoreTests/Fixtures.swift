import Foundation
import MeroKit
import MeroKitTestSupport

@testable import DesignCore

/// Contract answers shaped as the contract returns them (camelCase records,
/// `data` tagged by `kind`), shared by the scene and view-model tests.
enum Fixtures {
    static let me = String(repeating: "ab", count: 32)
    static let ana = String(repeating: "cd", count: 32)
    static let team = String(repeating: "aa", count: 32)
    static let board = String(repeating: "cc", count: 32)
    static let group = String(repeating: "bb", count: 32)

    static func element(
        _ id: String, _ data: String, x: Int = 0, y: Int = 0, w: Int = 100, h: Int = 50, layer: Int = 0,
        fill: String = "#ffffff", stroke: String = "#1e1e1e", strokeWidth: Int = 2, rotation: Int = 0,
        label: String? = nil, cornerRadius: Int? = nil
    ) -> String {
        let labelJSON = label.map { "\"\(jsonEscape($0))\"" } ?? "null"
        let radius = cornerRadius.map(String.init) ?? "null"
        return """
            {"id":"\(id)","data":\(data),"x":\(x),"y":\(y),"width":\(w),"height":\(h),"rotation":\(rotation),\
            "fill":"\(fill)","stroke":"\(stroke)","strokeWidth":\(strokeWidth),"opacity":100,"layerIndex":\(layer),\
            "createdBy":"\(ana)","createdAt":1,"updatedAt":1,"shadowColor":null,"shadowOffsetX":null,\
            "shadowOffsetY":null,"shadowBlur":null,"label":\(labelJSON),"cornerRadius":\(radius)}
            """
    }

    static func jsonEscape(_ s: String) -> String {
        s.unicodeScalars.map { $0.value < 0x20 ? String(format: "\\u%04x", $0.value) : String($0) }.joined()
            .replacingOccurrences(of: "\"", with: "\\\"")
    }

    static let rect = #"{"kind":"rect"}"#
    static let circle = #"{"kind":"circle"}"#
    static func text(_ content: String, size: Int = 16, align: String = "left") -> String {
        #"{"kind":"text","content":"\#(content)","fontSize":\#(size),"fontFamily":"sans-serif","bold":false,"italic":false,"text_align":"\#(align)","vertical_align":"top"}"#
    }
    static func image(_ blob: String) -> String {
        #"{"kind":"image","naturalWidth":10,"naturalHeight":10,"blobId":"\#(blob)"}"#
    }

    static func decode(_ json: String) -> [Element] {
        try! JSONDecoder().decode([Element].self, from: Data(json.utf8))
    }

    /// An in-memory account with one team, one board, and the board's contract scripted.
    static func backend(
        elements: String = "[]", comments: String = "[]", members: String = "[]", cursors: String = "[]",
        role: String = "editor", memberOfBoard: Bool = true
    ) -> InMemoryAppBackend {
        let backend = InMemoryAppBackend(account: me)
        backend.namespaces = [AppNamespace(id: team, name: "Studio", applicationId: backend.applicationId, memberCount: 3)]
        backend.subgroups = [team: [AppSubgroup(groupId: group, name: "Landing page", contextIds: [board])]]
        if memberOfBoard { backend.members = [board] }
        let answers = Answers(elements: elements, comments: comments, members: members, cursors: cursors, role: role)
        backend.recording.setRawHandler { call in Data(answers.answer(call.method).utf8) }
        return backend
    }

    final class Answers: @unchecked Sendable {
        let lock = NSLock()
        var table: [String: String]
        init(elements: String, comments: String, members: String, cursors: String, role: String) {
            table = [
                "get_elements": elements, "get_comments": comments, "get_members": members, "get_cursors": cursors,
                "my_role": "\"\(role)\"",
                "get_board": #"{"name":"Landing v2","description":"Hero and pricing","elementCount":3,"memberCount":2,"owner":null}"#,
            ]
        }
        func answer(_ method: String) -> String {
            lock.lock()
            defer { lock.unlock() }
            return table[method] ?? "null"
        }
    }
}
