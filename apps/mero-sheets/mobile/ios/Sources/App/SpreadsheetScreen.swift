import MeroKit
import SheetsCore
import SwiftUI

enum SpreadsheetSheet: Identifiable {
    case cell(GridPos), edit(GridPos), charts, comments, invite, details

    var id: String {
        switch self {
        case .cell(let p): return "cell-\(p.row)-\(p.col)"
        case .edit(let p): return "edit-\(p.row)-\(p.col)"
        case .charts: return "charts"
        case .comments: return "comments"
        case .invite: return "invite"
        case .details: return "details"
        }
    }
}

/// One spreadsheet: its tabs, the grid, the selected cell's bar, charts and comments.
struct SpreadsheetScreen: View {
    @ObservedObject var workspace: WorkspaceModel
    @StateObject private var model: SpreadsheetModel
    @State private var sheet: SpreadsheetSheet?
    let contextId: String

    init(workspace: WorkspaceModel, contextId: String) {
        self.workspace = workspace
        self.contextId = contextId
        _model = StateObject(wrappedValue: SpreadsheetModel(client: workspace.client(for: contextId), contextId: contextId))
    }

    private var title: String {
        let name = model.projectName.trimmingCharacters(in: .whitespaces)
        return name.isEmpty ? (workspace.spreadsheet(contextId)?.name ?? "Spreadsheet") : name
    }

    var body: some View {
        content
            .background(Theme.ground.ignoresSafeArea())
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.ground, for: .navigationBar)
            .toolbar {
                ToolbarItemGroup(placement: .navigationBarTrailing) {
                    if !model.sheetCharts.isEmpty {
                        Button { sheet = .charts } label: { Image(systemName: "chart.bar.xaxis") }
                            .accessibilityLabel("Charts")
                    }
                    Button { sheet = .comments } label: {
                        Image(systemName: model.openThreads.isEmpty ? "bubble.left" : "bubble.left.fill")
                    }
                    .accessibilityLabel("Comments")
                    Menu {
                        Button { sheet = .charts } label: { Label("Charts", systemImage: "chart.bar.xaxis") }
                        Button { sheet = .invite } label: { Label("Invite people", systemImage: "person.badge.plus") }
                        Button { sheet = .details } label: { Label("About this spreadsheet", systemImage: "info.circle") }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .accessibilityLabel("More")
                }
            }
            .task {
                await workspace.ensureMember(contextId)
                await model.load()
                await LiveUpdates.follow(backend: workspace.backend, contextId: contextId) { await model.load() }
            }
            .sheet(item: $sheet) { which in
                switch which {
                case .cell(let pos): CellSheet(model: model, pos: pos) { sheet = .edit(pos) }
                case .edit(let pos): EditValueSheet(model: model, pos: pos)
                case .charts: ChartsSheet(model: model)
                case .comments: CommentsSheet(model: model)
                case .invite: InviteSheet(workspace: workspace, spreadsheet: workspace.spreadsheet(contextId))
                case .details: AboutSheet(workspace: workspace, model: model)
                }
            }
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .failed(let text):
            EmptyState(
                icon: "wifi.exclamationmark", title: "Could not open this spreadsheet", message: text,
                action: ("Try again", { Task { await model.load() } }))
        case .idle, .loading:
            ProgressView().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
        case .loaded:
            if model.sheets.isEmpty {
                EmptyState(
                    icon: "arrow.triangle.2.circlepath", title: "No sheets yet",
                    message: "This spreadsheet has no tabs yet. They appear as soon as a member’s device sends them.")
            } else {
                VStack(spacing: 0) {
                    if let notice = model.notice {
                        NoticeBanner(text: notice) { model.notice = nil }.padding(.vertical, 8)
                    }
                    SheetTabs(model: model)
                    if let grid = model.grid {
                        GridView(grid: grid, selected: $model.selected) { pos in
                            model.selected = pos
                            if model.editBlock(at: pos) == nil {
                                Theme.haptic(.light)
                                sheet = .edit(pos)
                            } else {
                                sheet = .cell(pos)
                            }
                        }
                        .overlay(Rectangle().frame(height: 0.5).foregroundStyle(Theme.line), alignment: .top)
                        .ignoresSafeArea(.container, edges: .bottom)
                    }
                    if let pos = model.selected {
                        CellBar(model: model, pos: pos, open: { sheet = .cell(pos) }, edit: { sheet = .edit(pos) })
                    }
                }
            }
        }
    }
}

/// The workbook's tabs, as chips; the open one in lime.
struct SheetTabs: View {
    @ObservedObject var model: SpreadsheetModel

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(model.sheets, id: \.id) { s in
                        let on = s.id == model.activeSheetId
                        Button {
                            Theme.haptic(.light)
                            model.selectSheet(s.id)
                        } label: {
                            HStack(spacing: 5) {
                                if !s.linkedFrom.isEmpty { Image(systemName: "link").font(.system(size: 11, weight: .semibold)) }
                                Text(s.name).font(.system(size: 14, weight: on ? .semibold : .medium)).lineLimit(1)
                            }
                            .foregroundStyle(on ? Theme.ink : Theme.text2)
                            .padding(.horizontal, 14).frame(height: 32)
                            .background(on ? Theme.lime : Theme.surface, in: Capsule())
                            .overlay(Capsule().stroke(on ? Color.clear : Theme.line, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                        .id(s.id)
                        .accessibilityAddTraits(on ? .isSelected : [])
                    }
                }
                .padding(.horizontal, Theme.gutter)
                .padding(.vertical, 8)
            }
            .onChange(of: model.activeSheetId) { id in
                if let id { withAnimation { proxy.scrollTo(id, anchor: .center) } }
            }
        }
    }
}

/// The selected cell, like a formula bar: its reference, value, formula, and actions.
struct CellBar: View {
    @ObservedObject var model: SpreadsheetModel
    let pos: GridPos
    let open: () -> Void
    let edit: () -> Void

    var body: some View {
        let cell = model.cell(at: pos)
        let threads = model.threads(at: pos).filter { !$0.root.resolved }.count
        HStack(spacing: 12) {
            Button(action: open) {
                HStack(spacing: 10) {
                    Text(pos.label).font(.system(size: 13, weight: .bold, design: .monospaced)).foregroundStyle(Theme.ink)
                        .padding(.horizontal, 8).frame(height: 26)
                        .background(Theme.lime.opacity(0.55), in: RoundedRectangle(cornerRadius: 7))
                    VStack(alignment: .leading, spacing: 2) {
                        let text = cell?.text ?? ""
                        Text(text.isEmpty ? "Empty" : text).font(.system(size: 15, design: .monospaced))
                            .foregroundStyle(text.isEmpty ? Theme.text3 : Theme.ink).lineLimit(1)
                        if let cell, cell.isFormula {
                            Text(cell.raw).font(.system(size: 12, design: .monospaced)).foregroundStyle(Theme.text3).lineLimit(1)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Cell \(pos.label), \(cell?.text.isEmpty == false ? cell!.text : "empty"). Show details")
            Button(action: open) {
                HStack(spacing: 3) {
                    Image(systemName: threads > 0 ? "bubble.left.fill" : "bubble.left")
                    if threads > 0 { Text("\(threads)").font(.system(size: 13, weight: .semibold)) }
                }
                .foregroundStyle(Theme.text2).frame(minWidth: 36, minHeight: 36)
            }
            .accessibilityLabel(threads > 0 ? "\(threads) comments" : "Comments")
            if model.editBlock(at: pos) == nil {
                Button {
                    Theme.haptic(.light)
                    edit()
                } label: {
                    Image(systemName: "pencil").font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.ink)
                        .frame(width: 36, height: 36).background(Theme.lime, in: Circle())
                }
                .accessibilityLabel("Edit value")
            }
        }
        .padding(.horizontal, Theme.gutter)
        .padding(.vertical, 10)
        .background(Theme.surface.ignoresSafeArea(edges: .bottom).shadow(color: .black.opacity(0.06), radius: 8, y: -2))
        .overlay(Rectangle().frame(height: 0.5).foregroundStyle(Theme.line), alignment: .top)
    }
}

/// Everything about one cell: value, formula, format, style, who edited it, and its comments.
struct CellSheet: View {
    @ObservedObject var model: SpreadsheetModel
    let pos: GridPos
    let edit: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let cell = model.cell(at: pos) {
                        valueCard(cell)
                        commentsSection
                    }
                }
                .padding(Theme.gutter)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Theme.ground.ignoresSafeArea())
            .navigationTitle(model.activeSheet.map { "\(A1.sheetPrefix($0.name))\(pos.label)" } ?? pos.label)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .safeAreaInset(edge: .bottom) {
                if model.editBlock(at: pos) == nil {
                    Button {
                        Theme.haptic()
                        dismiss()
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35, execute: edit)
                    } label: {
                        Label("Edit value", systemImage: "pencil")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .padding(.horizontal, Theme.gutter).padding(.vertical, 10)
                    .background(.bar)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func valueCard(_ cell: GridCell) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            field("Value") {
                Text(cell.text.isEmpty ? "Empty" : cell.text)
                    .font(.system(size: 22, weight: cell.look.bold ? .bold : .medium, design: .monospaced))
                    .foregroundStyle(cell.text.isEmpty ? Theme.text3 : Theme.ink)
                    .textSelection(.enabled)
            }
            if cell.isFormula {
                field("Formula") {
                    Text(cell.raw).font(.system(size: 15, design: .monospaced)).foregroundStyle(Theme.ink).textSelection(.enabled)
                }
                Text("Computed by the workbook on your team’s nodes. Formulas are written in the web app.")
                    .font(.system(size: 13)).foregroundStyle(Theme.text3)
            } else if !cell.raw.isEmpty && cell.raw != cell.text {
                field("Entered as") {
                    Text(cell.raw).font(.system(size: 15, design: .monospaced)).foregroundStyle(Theme.text2).textSelection(.enabled)
                }
            }
            Divider()
            HStack(alignment: .top) {
                field("Format") { Text(CellFormat.describe(cell.format)).font(.system(size: 15)).foregroundStyle(Theme.ink) }
                Spacer()
                if !cell.look.isPlain { styleChips(cell.look) }
            }
            if let edited = model.editedBy(cell) {
                Label(edited, systemImage: "clock").font(.system(size: 13)).foregroundStyle(Theme.text3)
            }
            if let block = model.editBlock(at: pos), !cell.isFormula {
                Label(block, systemImage: "lock").font(.system(size: 13)).foregroundStyle(Theme.text3)
            }
        }
        .card()
    }

    private func field<C: View>(_ label: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased()).font(.system(size: 11, weight: .bold)).tracking(0.5).foregroundStyle(Theme.text3)
            content()
        }
    }

    private func styleChips(_ look: CellLook) -> some View {
        HStack(spacing: 6) {
            if look.bold { chip("bold") }
            if look.italic { chip("italic") }
            if look.underline { chip("underline") }
            if look.strike { chip("strikethrough") }
            if let a = look.align { chip("text.align\(a == "center" ? "center" : a)") }
            if let c = look.color { swatch(c, icon: "textformat") }
            if let f = look.fill { swatch(f, icon: "paintbrush.fill") }
        }
    }

    private func chip(_ icon: String) -> some View {
        Image(systemName: icon).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.text2)
            .frame(width: 26, height: 26).background(Theme.sunken, in: RoundedRectangle(cornerRadius: 7))
    }

    private func swatch(_ hex: UInt32, icon: String) -> some View {
        Image(systemName: icon).font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.text2)
            .frame(width: 26, height: 26)
            .background(Theme.sunken, in: RoundedRectangle(cornerRadius: 7))
            .overlay(alignment: .bottom) {
                RoundedRectangle(cornerRadius: 1.5).fill(Color(hex: hex)).frame(width: 16, height: 3).padding(.bottom, 3)
            }
    }

    @ViewBuilder private var commentsSection: some View {
        let threads = model.threads(at: pos)
        Text("Comments").font(Theme.heading(17)).foregroundStyle(Theme.ink).padding(.top, 4)
        if threads.isEmpty {
            Text(model.canComment ? "No comments on this cell yet." : "No comments on this cell.")
                .font(.system(size: 14)).foregroundStyle(Theme.text3)
        }
        ForEach(threads) { ThreadCard(model: model, thread: $0) }
        if model.canComment { NewCommentField(model: model, pos: pos) }
    }
}

/// The spreadsheet's facts, where its values come from, and the technical ids.
struct AboutSheet: View {
    @ObservedObject var workspace: WorkspaceModel
    @ObservedObject var model: SpreadsheetModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    row("Name", model.projectName.isEmpty ? "Untitled" : model.projectName)
                    row("Sheets", "\(model.sheets.count)")
                    row("Your role", model.role.capitalized)
                    row("Collaborators", "\(model.members.count)")
                }
                Section {
                    Label {
                        Text("Values are computed by the workbook on your team’s nodes and read here as they are. The phone does not recalculate: after you change a value, the new results arrive from the relay.")
                            .font(.system(size: 14)).foregroundStyle(Theme.text2)
                    } icon: {
                        Image(systemName: "function")
                    }
                    Label {
                        Text("Formulas, formatting, charts and sheet structure are edited in the web app.")
                            .font(.system(size: 14)).foregroundStyle(Theme.text2)
                    } icon: {
                        Image(systemName: "laptopcomputer")
                    }
                } header: {
                    Text("On this phone")
                }
                Section {
                    DetailsDisclosure(rows: detailRows)
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Theme.ground)
            .navigationTitle("About this spreadsheet")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).foregroundStyle(Theme.text2)
            Spacer()
            Text(value).foregroundStyle(Theme.ink)
        }
    }

    private var detailRows: [(String, String)] {
        var rows = [("Spreadsheet (context)", model.contextId)]
        if let id = workspace.activeWorkspaceId { rows.append(("Workspace (namespace)", id)) }
        if let id = model.activeSheetId { rows.append(("Sheet", id)) }
        if let me = model.selfId { rows.append(("You (member)", me)) }
        return rows
    }
}
