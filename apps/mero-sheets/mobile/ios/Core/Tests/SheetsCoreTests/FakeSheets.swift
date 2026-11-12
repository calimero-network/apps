import Foundation
import MeroKit
import MeroKitTestSupport

@testable import SheetsCore

/// The sheets contract in memory, behind `InMemoryAppBackend`'s recording
/// contract: enough of `logic/src` for the models' tests. `computed` is what the
/// node's recalc would return; a plain value computes to itself.
final class FakeSheets: @unchecked Sendable {
    let backend: InMemoryAppBackend
    private let lock = NSLock()
    private var projects: [String: String] = [:]
    private var sheets: [String: [Sheet]] = [:]
    private var cells: [String: [Cell]] = [:]
    private var comments: [String: [Comment]] = [:]
    var charts: [String: [Chart]] = [:]
    var styles: [String: [CellStyle]] = [:]
    var views: [String: [SheetView]] = [:]
    var layouts: [String: [SheetLayout]] = [:]
    var members: [String: [Member]] = [:]
    var protections: [String: [Protection]] = [:]
    private var next = 0
    var failWrites: Error?

    init(account: String = String(repeating: "ab", count: 32)) {
        backend = InMemoryAppBackend(account: account)
        backend.recording.setRawHandler { call in
            try self.handle(call)
        }
    }

    var account: String { backend.account }

    func seedSheet(_ id: String, name: String, position: UInt32 = 0, linkedFrom: String = "", in ctx: String) {
        lock.withLock { sheets[ctx, default: []].append(Sheet(id: id, name: name, position: position, created_at: 1, linked_from: linkedFrom)) }
    }

    func seedCell(_ sheet: String, _ row: String, _ col: String, raw: String, computed: String? = nil, format: String = "", in ctx: String) {
        lock.withLock {
            cells[ctx, default: []].append(
                Cell(
                    id: "\(sheet)|\(row)|\(col)", sheet_id: sheet, row_id: row, col_id: col, raw_value: raw,
                    computed_value: computed ?? raw, format: format, updated_at: 1, last_editor: account, last_edited_at: 1))
        }
    }

    func seedProject(_ name: String, in ctx: String) { lock.withLock { projects[ctx] = name } }

    func cell(_ sheet: String, _ row: String, _ col: String, in ctx: String) -> Cell? {
        lock.withLock { cells[ctx]?.first { $0.sheetId == sheet && $0.rowId == row && $0.colId == col } }
    }

    func sheetNames(_ ctx: String) -> [String] { lock.withLock { (sheets[ctx] ?? []).map(\.name) } }
    func project(_ ctx: String) -> String? { lock.withLock { projects[ctx] } }

    private func handle(_ call: RecordedContractCall) throws -> Data? {
        let args = (try? JSONSerialization.jsonObject(with: call.argsJSON ?? Data("{}".utf8))) as? [String: Any] ?? [:]
        func s(_ key: String) -> String { args[key] as? String ?? "" }
        let ctx = call.contextId
        if call.path == .execute, let failWrites { throw failWrites }
        return try lock.withLock { () throws -> Data? in
            let enc = JSONEncoder()
            switch call.method {
            case "listSheets": return try enc.encode(sheets[ctx] ?? [])
            case "getAllCells": return try enc.encode(cells[ctx] ?? [])
            case "getLayouts": return try enc.encode(layouts[ctx] ?? [])
            case "getSheetViews": return try enc.encode(views[ctx] ?? [])
            case "getStyles": return try enc.encode(styles[ctx] ?? [])
            case "getCharts": return try enc.encode(charts[ctx] ?? [])
            case "getComments": return try enc.encode(comments[ctx] ?? [])
            case "getMembers": return try enc.encode(members[ctx] ?? [])
            case "getProtections": return try enc.encode(protections[ctx] ?? [])
            case "getProject": return try enc.encode(Project(id: "p-\(ctx)", name: projects[ctx] ?? "", created_at: 1))
            case "whoami": return try enc.encode(account)
            case "initProject":
                projects[ctx] = s("name")
                return try enc.encode("p-\(ctx)")
            case "createSheet":
                next += 1
                let id = "sheet-\(next)"
                sheets[ctx, default: []].append(
                    Sheet(id: id, name: s("name"), position: UInt32(sheets[ctx]?.count ?? 0), created_at: 1, linked_from: ""))
                return try enc.encode(id)
            case "setCell":
                cells[ctx, default: []].removeAll { $0.sheetId == s("sheetId") && $0.rowId == s("rowId") && $0.colId == s("colId") }
                cells[ctx, default: []].append(
                    Cell(
                        id: "\(s("sheetId"))|\(s("rowId"))|\(s("colId"))", sheet_id: s("sheetId"), row_id: s("rowId"),
                        col_id: s("colId"), raw_value: s("rawValue"), computed_value: s("rawValue"), format: "", updated_at: 2,
                        last_editor: account, last_edited_at: 2))
                return try enc.encode("ok")
            case "clearCell":
                cells[ctx, default: []].removeAll { $0.sheetId == s("sheetId") && $0.rowId == s("rowId") && $0.colId == s("colId") }
            case "addComment":
                next += 1
                let id = "comment-\(next)"
                comments[ctx, default: []].append(
                    Comment(
                        id: id, sheet_id: s("sheetId"), row_id: s("rowId"), col_id: s("colId"), author: account, text: s("text"),
                        mentions: [], parent: s("parent"), resolved: false, created_at: UInt64(next), updated_at: UInt64(next)))
                return try enc.encode(id)
            case "setCommentResolved":
                comments[ctx] = comments[ctx]?.map {
                    var c = $0
                    if c.id == s("id") { c.resolved = args["resolved"] as? Bool ?? false }
                    return c
                }
            case "editComment":
                comments[ctx] = comments[ctx]?.map {
                    var c = $0
                    if c.id == s("id") { c.text = s("text") }
                    return c
                }
            case "deleteComment": comments[ctx]?.removeAll { $0.id == s("id") || $0.parent == s("id") }
            default: break
            }
            return Data("null".utf8)
        }
    }
}
