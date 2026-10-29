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
        lock.withLock { sheets[ctx, default: []].append(Sheet(id: id, name: name, position: position, createdAt: 1, linkedFrom: linkedFrom)) }
    }

    func seedCell(_ sheet: String, _ row: String, _ col: String, raw: String, computed: String? = nil, format: String = "", in ctx: String) {
        lock.withLock {
            cells[ctx, default: []].append(
                Cell(
                    id: "\(sheet)|\(row)|\(col)", sheetId: sheet, rowId: row, colId: col, rawValue: raw,
                    computedValue: computed ?? raw, format: format, updatedAt: 1, lastEditor: account, lastEditedAt: 1))
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
            case "list_sheets": return try enc.encode(sheets[ctx] ?? [])
            case "get_all_cells": return try enc.encode(cells[ctx] ?? [])
            case "get_layouts": return try enc.encode(layouts[ctx] ?? [])
            case "get_sheet_views": return try enc.encode(views[ctx] ?? [])
            case "get_styles": return try enc.encode(styles[ctx] ?? [])
            case "get_charts": return try enc.encode(charts[ctx] ?? [])
            case "get_comments": return try enc.encode(comments[ctx] ?? [])
            case "get_members": return try enc.encode(members[ctx] ?? [])
            case "get_protections": return try enc.encode(protections[ctx] ?? [])
            case "get_project": return try enc.encode(Project(id: "p-\(ctx)", name: projects[ctx] ?? "", createdAt: 1))
            case "whoami": return try enc.encode(account)
            case "init_project":
                projects[ctx] = s("name")
                return try enc.encode("p-\(ctx)")
            case "create_sheet":
                next += 1
                let id = "sheet-\(next)"
                sheets[ctx, default: []].append(
                    Sheet(id: id, name: s("name"), position: UInt32(sheets[ctx]?.count ?? 0), createdAt: 1, linkedFrom: ""))
                return try enc.encode(id)
            case "set_cell":
                cells[ctx, default: []].removeAll { $0.sheetId == s("sheet_id") && $0.rowId == s("row_id") && $0.colId == s("col_id") }
                cells[ctx, default: []].append(
                    Cell(
                        id: "\(s("sheet_id"))|\(s("row_id"))|\(s("col_id"))", sheetId: s("sheet_id"), rowId: s("row_id"),
                        colId: s("col_id"), rawValue: s("raw_value"), computedValue: s("raw_value"), format: "", updatedAt: 2,
                        lastEditor: account, lastEditedAt: 2))
                return try enc.encode("ok")
            case "clear_cell":
                cells[ctx, default: []].removeAll { $0.sheetId == s("sheet_id") && $0.rowId == s("row_id") && $0.colId == s("col_id") }
            case "add_comment":
                next += 1
                let id = "comment-\(next)"
                comments[ctx, default: []].append(
                    Comment(
                        id: id, sheetId: s("sheet_id"), rowId: s("row_id"), colId: s("col_id"), author: account, text: s("text"),
                        mentions: [], parent: s("parent"), resolved: false, createdAt: UInt64(next), updatedAt: UInt64(next)))
                return try enc.encode(id)
            case "set_comment_resolved":
                comments[ctx] = comments[ctx]?.map {
                    var c = $0
                    if c.id == s("id") { c.resolved = args["resolved"] as? Bool ?? false }
                    return c
                }
            case "edit_comment":
                comments[ctx] = comments[ctx]?.map {
                    var c = $0
                    if c.id == s("id") { c.text = s("text") }
                    return c
                }
            case "delete_comment": comments[ctx]?.removeAll { $0.id == s("id") || $0.parent == s("id") }
            default: break
            }
            return Data("null".utf8)
        }
    }
}
