import Foundation

/// A comment thread on a cell: the root comment and its replies, oldest first.
public struct CommentThread: Identifiable, Equatable, Sendable {
    public let root: Comment
    public let replies: [Comment]
    public var id: String { root.id }
}

/// A chart placed on the open sheet.
public struct PlacedChart: Identifiable, Equatable, Sendable {
    public let id: String
    public let title: String
    /// `bar` or `line`.
    public let kind: String
    /// `A1:C6`.
    public let range: String
    public let model: ChartModel
}

/// One spreadsheet (workbook): its tabs, the open tab's grid, charts and
/// comments, and the one edit the phone makes, a cell's plain value.
///
/// Values come from the contract: `get_all_cells` returns each cell's computed
/// value, evaluated on the node by the same Rust engine the web compiles to
/// WASM (`recalc-wasm`). The web uses that WASM copy only to echo an edit
/// before the node answers; the phone shows the node's values and re-reads
/// after a write, so nothing is recalculated on the phone.
@MainActor
public final class SpreadsheetModel: ObservableObject {
    @Published public private(set) var phase: LoadPhase = .idle
    @Published public private(set) var projectName = ""
    @Published public private(set) var sheets: [Sheet] = []
    @Published public private(set) var activeSheetId: String?
    @Published public private(set) var grid: SheetGrid?
    @Published public private(set) var comments: [Comment] = []
    @Published public private(set) var charts: [Chart] = []
    @Published public private(set) var members: [Member] = []
    @Published public private(set) var selfId: String?
    @Published public var selected: GridPos?
    /// A write that failed while the content stayed on screen.
    @Published public var notice: String?

    public let contextId: String
    private let client: SheetsClient
    private var cells: [Cell] = []
    private var layouts: [String: SheetLayout] = [:]
    private var views: [String: SheetView] = [:]
    private var styles: [String: [String: String]] = [:]
    private var protections: [Protection] = []
    private var orders: [String: SheetOrder] = [:]

    public init(client: SheetsClient, contextId: String) {
        self.client = client
        self.contextId = contextId
    }

    public var activeSheet: Sheet? { sheets.first { $0.id == activeSheetId } }

    /// The person's role in this workbook (`owner`, `editor`, `commenter`, `viewer`);
    /// someone not yet on the roster edits, as on the web.
    public var role: String {
        members.first { $0.id == selfId }?.role.nilIfEmpty ?? "editor"
    }

    public var canComment: Bool { ["owner", "editor", "commenter"].contains(role) }

    // MARK: Loading

    public func load() async {
        if sheets.isEmpty && cells.isEmpty { phase = .loading }
        do {
            async let sheetList = client.listSheets()
            async let allCells = client.getAllCells()
            async let layoutList = client.getLayouts()
            async let viewList = client.getSheetViews()
            async let styleList = client.getStyles()
            async let chartList = client.getCharts()
            async let commentList = client.getComments()
            async let memberList = client.getMembers()
            async let project = client.getProject()
            async let me = client.whoami()
            async let protectionList = client.getProtections()
            let (s, c, l, v, st, ch, co) = try await (sheetList, allCells, layoutList, viewList, styleList, chartList, commentList)
            let (m, p, w, pr) = try await (memberList, project, me, protectionList)
            sheets = s.sorted { $0.position < $1.position }
            cells = c
            layouts = Dictionary(l.map { ($0.sheetId, $0) }, uniquingKeysWith: { a, _ in a })
            orders = [:]
            views = Dictionary(v.map { ($0.sheetId, $0) }, uniquingKeysWith: { a, _ in a })
            styles = Dictionary(st.map { (Self.key($0.sheetId, $0.rowId, $0.colId), $0.style) }, uniquingKeysWith: { a, _ in a })
            charts = ch
            comments = co
            members = m
            projectName = p.name
            selfId = w
            protections = pr
            if activeSheetId == nil || !sheets.contains(where: { $0.id == activeSheetId }) {
                activeSheetId = sheets.first?.id
            }
            rebuild()
            phase = .loaded
        } catch {
            if sheets.isEmpty && cells.isEmpty {
                phase = .failed(Self.errorText(error))
            } else {
                notice = Self.errorText(error)
            }
        }
    }

    public func selectSheet(_ id: String) {
        guard id != activeSheetId, sheets.contains(where: { $0.id == id }) else { return }
        activeSheetId = id
        selected = nil
        rebuild()
    }

    /// A sheet's row and column order.
    public func order(_ sheetId: String) -> SheetOrder {
        if let o = orders[sheetId] { return o }
        let o = SheetOrder(layout: layouts[sheetId])
        orders[sheetId] = o
        return o
    }

    private func rebuild() {
        guard let sheetId = activeSheetId else {
            grid = nil
            return
        }
        let order = order(sheetId)
        var placed: [GridPos: GridCell] = [:]
        for c in cells where c.sheetId == sheetId {
            guard let row = order.rows.position(of: c.rowId), let col = order.cols.position(of: c.colId) else { continue }
            let pos = GridPos(row: row, col: col)
            placed[pos] = gridCell(pos, rowId: c.rowId, colId: c.colId, cell: c, sheetId: sheetId)
        }
        // A styled cell with no value still draws (a fill, a border of colour).
        for (key, style) in styles {
            let parts = key.split(separator: "|", omittingEmptySubsequences: false).map(String.init)
            guard parts.count == 3, parts[0] == sheetId, let row = order.rows.position(of: parts[1]),
                let col = order.cols.position(of: parts[2])
            else { continue }
            let pos = GridPos(row: row, col: col)
            if placed[pos] == nil, !CellLook(style: style).isPlain {
                placed[pos] = gridCell(pos, rowId: parts[1], colId: parts[2], cell: nil, sheetId: sheetId)
            }
        }
        var commented = Set<GridPos>()
        for c in comments where c.sheetId == sheetId && c.parent.isEmpty && !c.resolved {
            if let row = order.rows.position(of: c.rowId), let col = order.cols.position(of: c.colId) {
                commented.insert(GridPos(row: row, col: col))
            }
        }
        let view = views[sheetId]
        grid = SheetGrid(
            sheetId: sheetId, order: order, cells: placed, sizes: view?.sizes ?? [],
            frozenRows: Int(view?.frozenRows ?? 0), frozenCols: Int(view?.frozenCols ?? 0), commented: commented)
    }

    private func gridCell(_ pos: GridPos, rowId: String, colId: String, cell: Cell?, sheetId: String) -> GridCell {
        let raw = cell?.rawValue ?? ""
        let computed = cell?.computedValue ?? ""
        let format = cell?.format ?? ""
        return GridCell(
            pos: pos, rowId: rowId, colId: colId, raw: displayRaw(raw, sheetId: sheetId), computed: computed, format: format,
            text: CellFormat.display(computed, format: format),
            look: CellLook(style: styles[Self.key(sheetId, rowId, colId)] ?? [:]),
            lastEditor: cell?.lastEditor ?? "", lastEditedAt: cell?.lastEditedAt ?? 0)
    }

    /// A stored raw value as the formula bar shows it.
    public func displayRaw(_ raw: String, sheetId: String) -> String {
        guard raw.hasPrefix("=") else { return raw }
        return FormulaDisplay.display(
            raw, home: sheetId, orders: { [unowned self] in self.order($0) },
            sheetName: { [sheets] id in sheets.first { $0.id == id }?.name })
    }

    // MARK: Cells

    /// The cell at a position (an empty one when nothing is stored there).
    public func cell(at pos: GridPos) -> GridCell? {
        guard let grid else { return nil }
        if let c = grid.cells[pos] { return c }
        guard let rowId = grid.order.rows.id(at: pos.row), let colId = grid.order.cols.id(at: pos.col) else { return nil }
        return gridCell(pos, rowId: rowId, colId: colId, cell: nil, sheetId: grid.sheetId)
    }

    /// Why the person cannot change this cell's value here, or nil when they can.
    public func editBlock(at pos: GridPos) -> String? {
        guard let sheet = activeSheet, let cell = cell(at: pos) else { return "Open a sheet first." }
        if !sheet.linkedFrom.isEmpty { return "This sheet is linked from \(sheet.linkedFrom), so it is read-only here." }
        if role == "viewer" { return "You are a viewer in this workbook." }
        if role == "commenter" { return "You are a commenter in this workbook." }
        if cell.isFormula { return "This cell is a formula. Formulas are written in the web app." }
        if let p = protection(at: pos, sheetId: sheet.id) {
            return p.description.isEmpty ? "This range is protected." : "Protected: \(p.description)"
        }
        return nil
    }

    private func protection(at pos: GridPos, sheetId: String) -> Protection? {
        let o = order(sheetId)
        return protections.first { p in
            guard p.sheetId == sheetId, role != "owner", !(selfId.map(p.editors.contains) ?? false) else { return false }
            if p.topRowId.isEmpty && p.leftColId.isEmpty && p.bottomRowId.isEmpty && p.rightColId.isEmpty { return true }
            guard let t = o.rows.position(of: p.topRowId), let l = o.cols.position(of: p.leftColId),
                let b = o.rows.position(of: p.bottomRowId), let r = o.cols.position(of: p.rightColId)
            else { return false }
            return (min(t, b)...max(t, b)).contains(pos.row) && (min(l, r)...max(l, r)).contains(pos.col)
        }
    }

    /// Set a cell's plain value (empty clears it). The node recalculates; the
    /// grid shows the typed value until the re-read brings the result back.
    public func setValue(_ text: String, at pos: GridPos) async throws {
        if let block = editBlock(at: pos) { throw SheetsError.message(block) }
        let value = text.trimmingCharacters(in: .newlines)
        if value.hasPrefix("=") {
            throw SheetsError.message("Formulas are written in the web app. Enter a plain value here.")
        }
        guard let sheetId = activeSheetId, let cell = cell(at: pos) else { return }
        if value.isEmpty {
            try await client.clearCell(sheetId: sheetId, rowId: cell.rowId, colId: cell.colId)
            cells.removeAll { $0.sheetId == sheetId && $0.rowId == cell.rowId && $0.colId == cell.colId }
        } else {
            try await client.setCell(sheetId: sheetId, rowId: cell.rowId, colId: cell.colId, rawValue: value)
            let previous = cells.first { $0.sheetId == sheetId && $0.rowId == cell.rowId && $0.colId == cell.colId }
            cells.removeAll { $0.sheetId == sheetId && $0.rowId == cell.rowId && $0.colId == cell.colId }
            cells.append(
                Cell(
                    id: previous?.id ?? "\(sheetId)|\(cell.rowId)|\(cell.colId)", sheetId: sheetId, rowId: cell.rowId,
                    colId: cell.colId, rawValue: value, computedValue: value, format: previous?.format ?? "",
                    updatedAt: previous?.updatedAt ?? 0, lastEditor: selfId ?? "", lastEditedAt: previous?.lastEditedAt ?? 0))
        }
        rebuild()
        await load()
    }

    // MARK: Charts

    /// The open sheet's charts, read from the grid's values.
    public var sheetCharts: [PlacedChart] {
        guard let sheetId = activeSheetId, let grid else { return [] }
        let o = order(sheetId)
        return charts.compactMap { chart in
            let c = chart.chart
            guard c.sheetId == sheetId, let t = o.rows.position(of: c.topRowId), let l = o.cols.position(of: c.leftColId),
                let b = o.rows.position(of: c.bottomRowId), let r = o.cols.position(of: c.rightColId)
            else { return nil }
            let top = min(t, b)
            let bottom = max(t, b)
            let left = min(l, r)
            let right = max(l, r)
            let model = ChartModel(top: top, left: left, bottom: bottom, right: right) { row, col in
                grid.cells[GridPos(row: row, col: col)]?.computed ?? ""
            }
            let range = "\(A1.cell(row: top, col: left)):\(A1.cell(row: bottom, col: right))"
            let title = c.title.trimmingCharacters(in: .whitespaces)
            return PlacedChart(
                id: chart.id, title: title.isEmpty ? model.series.map(\.name).joined(separator: ", ") : title,
                kind: c.kind == "line" ? "line" : "bar", range: range, model: model)
        }
    }

    // MARK: Comments

    /// Threads on one cell of the open sheet, open ones first.
    public func threads(at pos: GridPos) -> [CommentThread] {
        guard let sheetId = activeSheetId, let cell = cell(at: pos) else { return [] }
        return threads { $0.sheetId == sheetId && $0.rowId == cell.rowId && $0.colId == cell.colId }
    }

    /// Every unresolved thread in the workbook.
    public var openThreads: [CommentThread] { threads { !$0.resolved } }

    private func threads(_ include: (Comment) -> Bool) -> [CommentThread] {
        comments.filter { $0.parent.isEmpty && include($0) }
            .sorted { ($0.resolved ? 1 : 0, $0.createdAt) < ($1.resolved ? 1 : 0, $1.createdAt) }
            .map { root in
                CommentThread(root: root, replies: comments.filter { $0.parent == root.id }.sorted { $0.createdAt < $1.createdAt })
            }
    }

    /// Where a comment sits: `B3`, or `Sheet 2!B3` on another tab; nil when its cell is gone.
    public func location(of comment: Comment) -> String? {
        let o = order(comment.sheetId)
        guard let row = o.rows.position(of: comment.rowId), let col = o.cols.position(of: comment.colId) else { return nil }
        let ref = A1.cell(row: row, col: col)
        if comment.sheetId == activeSheetId { return ref }
        guard let name = sheets.first(where: { $0.id == comment.sheetId })?.name else { return nil }
        return A1.sheetPrefix(name) + ref
    }

    /// Open a comment's cell: its tab, then the cell.
    public func reveal(_ comment: Comment) {
        selectSheet(comment.sheetId)
        let o = order(comment.sheetId)
        if let row = o.rows.position(of: comment.rowId), let col = o.cols.position(of: comment.colId) {
            selected = GridPos(row: row, col: col)
        }
    }

    public func addComment(_ text: String, at pos: GridPos) async throws {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, let sheetId = activeSheetId, let cell = cell(at: pos) else { return }
        try await client.addComment(sheetId: sheetId, rowId: cell.rowId, colId: cell.colId, text: body, parent: "")
        await load()
    }

    public func reply(to thread: CommentThread, text: String) async throws {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        let r = thread.root
        try await client.addComment(sheetId: r.sheetId, rowId: r.rowId, colId: r.colId, text: body, parent: r.id)
        await load()
    }

    public func setResolved(_ thread: CommentThread, _ resolved: Bool) async throws {
        try await client.setCommentResolved(id: thread.root.id, resolved: resolved)
        await load()
    }

    public func editComment(_ comment: Comment, text: String) async throws {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        try await client.editComment(id: comment.id, text: body)
        await load()
    }

    public func deleteComment(_ comment: Comment) async throws {
        try await client.deleteComment(id: comment.id)
        await load()
    }

    public func isMine(_ comment: Comment) -> Bool { comment.author == selfId }

    // MARK: People

    /// "You", a member's nickname, else a short key.
    public func name(of memberId: String) -> String {
        if memberId == selfId { return "You" }
        let nick = members.first { $0.id == memberId }?.nickname.trimmingCharacters(in: .whitespaces) ?? ""
        return nick.isEmpty ? SheetsFormat.truncateKey(memberId) : nick
    }

    /// "Edited by Ana, 5 min ago", or nil when nobody is recorded.
    public func editedBy(_ cell: GridCell) -> String? {
        guard !cell.lastEditor.isEmpty else { return nil }
        let when = SheetsFormat.ago(ns: cell.lastEditedAt)
        return when.isEmpty ? "Edited by \(name(of: cell.lastEditor))" : "Edited by \(name(of: cell.lastEditor)), \(when)"
    }

    static func key(_ sheetId: String, _ rowId: String, _ colId: String) -> String { "\(sheetId)|\(rowId)|\(colId)" }

    /// A contract refusal in plain words: the node's message without its wrapping.
    static func errorText(_ error: Error) -> String {
        let text = SheetsFormat.errorText(error)
        if text.range(of: "uninitiali", options: .caseInsensitive) != nil {
            return "This spreadsheet has not reached the relay yet. It syncs from a member who is online."
        }
        return text
    }
}

extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
