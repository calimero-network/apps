import DocsCore
import MeroKit
import MeroKitUI
import SwiftUI

/// The workspaces this account is in.
struct WorkspacesScreen: View {
    @ObservedObject var session: MeroAppSession
    @StateObject private var model: WorkspacesModel
    @State private var showAccount = false

    init(session: MeroAppSession, backend: any MeroAppBackend) {
        self.session = session
        _model = StateObject(wrappedValue: WorkspacesModel(backend: backend))
    }

    var body: some View {
        List {
            switch model.state {
            case .idle:
                LoadingRows().listRowInsets(EdgeInsets()).plainRow()
            case .loading where model.workspaces.isEmpty:
                LoadingRows().listRowInsets(EdgeInsets()).plainRow()
            case .failed(let message) where model.workspaces.isEmpty:
                ErrorBanner(message: message) { Task { await model.load() } }.plainRow()
            default:
                if model.workspaces.isEmpty {
                    EmptyState(
                        icon: "square.stack.3d.up",
                        title: "No workspaces yet",
                        message: "Create a workspace in Mero Docs on the web or desktop, or accept an invitation there. It shows up here.")
                    .plainRow()
                } else {
                    Section {
                        ForEach(model.workspaces) { ws in
                            NavigationLink(value: Router.Route.workspace(ws)) { WorkspaceRow(workspace: ws) }
                                .cardRow()
                        }
                    } header: {
                        SectionLabel("Workspaces")
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Theme.ground)
        .navigationTitle("Mero Docs")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    showAccount = true
                } label: {
                    Image(systemName: "person.crop.circle")
                }
                .accessibilityLabel("Account")
            }
        }
        .refreshable { await model.load() }
        .task { await model.load() }
        .sheet(isPresented: $showAccount) {
            AccountSheet(session: session).presentationDetents([.medium])
        }
    }
}

private struct WorkspaceRow: View {
    let workspace: Workspace

    var body: some View {
        HStack(spacing: 14) {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Theme.memberColor(workspace.id).opacity(0.14))
                .frame(width: 44, height: 44)
                .overlay(
                    Text(DocsFormat.initials(workspace.name))
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Theme.memberColor(workspace.id)))
            VStack(alignment: .leading, spacing: 3) {
                Text(workspace.name).font(Theme.heading(17)).foregroundStyle(Theme.ink).lineLimit(1)
                Text(workspace.memberCount == 1 ? "1 member" : "\(workspace.memberCount) members")
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.muted)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
    }
}

/// Who is signed in, and signing out.
struct AccountSheet: View {
    @ObservedObject var session: MeroAppSession
    @Environment(\.dismiss) private var dismiss
    @State private var confirm = false

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 12) {
                    Avatar(id: session.account ?? "", name: "Me", size: 44)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Signed in").font(Theme.heading(17)).foregroundStyle(Theme.ink)
                        Text(session.hasRelay ? "Connected through your relay" : "No relay serves this account yet")
                            .font(Theme.body(14))
                            .foregroundStyle(Theme.muted)
                    }
                }
                .card()
                DetailsDisclosure(rows: [
                    ("Account", session.account ?? "—"),
                    ("Application", session.applicationId ?? "—"),
                ])
                .card()
                Spacer()
                Button(role: .destructive) {
                    confirm = true
                } label: {
                    Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                        .foregroundStyle(Theme.danger)
                }
                .buttonStyle(SecondaryButtonStyle())
            }
            .padding(16)
            .background(Theme.ground)
            .navigationTitle("Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) { Button("Done") { dismiss() } }
            }
            .confirmationDialog("Sign out of Mero Docs?", isPresented: $confirm, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) {
                    dismiss()
                    Task { await session.signOut() }
                }
            }
        }
    }
}

/// A workspace's home: search, what this phone opened last, folders, and
/// everything by last change (the web's Home table).
struct WorkspaceScreen: View {
    @ObservedObject var model: WorkspaceModel
    @State private var text = ""

    var body: some View {
        List {
            if !model.query.isEmpty {
                SearchResultsSection(model: model)
            } else {
                switch model.state {
                case .idle:
                    LoadingRows().listRowInsets(EdgeInsets()).plainRow()
                case .loading where model.folders.isEmpty:
                    LoadingRows().listRowInsets(EdgeInsets()).plainRow()
                case .failed(let message) where model.folders.isEmpty:
                    ErrorBanner(message: message) { Task { await model.load() } }.plainRow()
                default:
                    content
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Theme.ground)
        .navigationTitle(model.workspace.name.isEmpty ? "Workspace" : model.workspace.name)
        .navigationBarTitleDisplayMode(.large)
        .searchable(text: $text, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search titles and text")
        .task(id: text) {
            if !text.trimmingCharacters(in: .whitespaces).isEmpty {
                try? await Task.sleep(nanoseconds: 300_000_000)
                if Task.isCancelled { return }
            }
            await model.search(text)
        }
        .refreshable { await model.load() }
        .task { await model.load() }
    }

    @ViewBuilder private var content: some View {
        let top = model.folders(in: nil)
        if top.isEmpty {
            EmptyState(
                icon: "folder",
                title: "No folders yet",
                message: "Folders are created in Mero Docs on the web or desktop. Pull to refresh once one exists.")
            .plainRow()
        } else {
            let recent = model.recent
            if !recent.isEmpty {
                Section {
                    ForEach(recent) { row in DocLink(row: row, workspaceId: model.workspace.id, showFolder: true) }
                } header: {
                    SectionLabel("Recent")
                }
            }
            Section {
                ForEach(top) { folder in FolderLink(model: model, folder: folder) }
            } header: {
                SectionLabel("Folders")
            }
            let all = model.recentlyUpdated
            Section {
                if all.isEmpty {
                    Text("No documents yet. Documents are written in Mero Docs on the web or desktop.")
                        .font(Theme.body(14))
                        .foregroundStyle(Theme.muted)
                        .plainRow()
                } else {
                    ForEach(all) { row in DocLink(row: row, workspaceId: model.workspace.id, showFolder: true) }
                }
            } header: {
                SectionLabel("Recently updated")
            }
        }
    }
}

private struct SearchResultsSection: View {
    @ObservedObject var model: WorkspaceModel

    var body: some View {
        Section {
            if model.results.isEmpty && !model.searching {
                EmptyState(
                    icon: "magnifyingglass",
                    title: "No matches",
                    message: "Nothing in this workspace matches \u{201C}\(model.query)\u{201D}.")
                .plainRow()
            }
            ForEach(model.results) { result in
                DocLink(row: result.row, workspaceId: model.workspace.id, showFolder: true, snippet: result.snippet)
            }
        } header: {
            HStack {
                SectionLabel("Results")
                Spacer()
                if model.searching { ProgressView().controlSize(.small).padding(.top, 8) }
            }
        }
    }
}

/// One folder: its subfolders and its documents.
struct FolderScreen: View {
    @ObservedObject var model: WorkspaceModel
    let folderId: String

    var body: some View {
        let folder = model.folder(folderId)
        let subfolders = model.folders(in: folderId)
        let docs = model.docs(in: folderId)
        List {
            if model.state == .loading && folder == nil {
                LoadingRows().listRowInsets(EdgeInsets()).plainRow()
            } else {
                if let issue = model.issues[folderId] {
                    IssueBanner(issue: issue).plainRow()
                }
                if !subfolders.isEmpty {
                    Section {
                        ForEach(subfolders) { f in FolderLink(model: model, folder: f) }
                    } header: {
                        SectionLabel("Folders")
                    }
                }
                Section {
                    if docs.isEmpty && model.issues[folderId] == nil {
                        EmptyState(
                            icon: "doc.text",
                            title: "No documents here",
                            message: "Documents are written in Mero Docs on the web or desktop. Pull to refresh once one exists.")
                        .plainRow()
                    }
                    ForEach(docs) { row in DocLink(row: row, workspaceId: model.workspace.id, showFolder: false) }
                } header: {
                    if !docs.isEmpty { SectionLabel(docs.count == 1 ? "1 document" : "\(docs.count) documents") }
                }
                if let folder {
                    DetailsDisclosure(rows: [
                        ("Folder", folder.id),
                        ("Docs context", folder.contextId ?? "—"),
                        ("Workspace", model.workspace.id),
                    ])
                    .cardRow()
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Theme.ground)
        .navigationTitle(folder?.name ?? "Folder")
        .navigationBarTitleDisplayMode(.large)
        .refreshable { await model.load() }
        .task { if model.state == .idle { await model.load() } }
    }
}

private struct IssueBanner: View {
    let issue: FolderIssue

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon).foregroundStyle(Theme.muted)
            Text(message).font(Theme.body(14)).foregroundStyle(Theme.ink2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 14)
        .padding(.horizontal, 16)
    }

    private var icon: String {
        if case .noAccess = issue { return "lock" }
        return "exclamationmark.triangle"
    }

    private var message: String {
        switch issue {
        case .noContext: return "This folder hasn't reached your relay yet. Pull to refresh in a moment."
        case .noAccess: return "This folder is restricted. Ask a workspace admin to add you."
        case .failed(let m): return "Couldn't read this folder. \(m)"
        }
    }
}

private struct FolderLink: View {
    @ObservedObject var model: WorkspaceModel
    let folder: Folder

    var body: some View {
        NavigationLink(value: Router.Route.folder(workspaceId: model.workspace.id, folderId: folder.id)) {
            HStack(spacing: 14) {
                Image(systemName: restricted ? "lock" : "folder")
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(Theme.ink)
                    .frame(width: 40, height: 40)
                    .background(Theme.lime.opacity(0.35), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text(folder.name).font(Theme.heading(16)).foregroundStyle(Theme.ink).lineLimit(1)
                    Text(subtitle).font(Theme.body(13)).foregroundStyle(Theme.muted).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 2)
        }
        .cardRow()
    }

    private var restricted: Bool {
        if case .noAccess = model.issues[folder.id] { return true }
        return false
    }

    private var subtitle: String {
        let docs = model.docs(in: folder.id).count
        let subs = model.folders(in: folder.id).count
        var parts = [docs == 1 ? "1 document" : "\(docs) documents"]
        if subs > 0 { parts.append(subs == 1 ? "1 folder" : "\(subs) folders") }
        return parts.joined(separator: " · ")
    }
}

/// A document row that opens it, with a share swipe.
struct DocLink: View {
    let row: DocRow
    let workspaceId: String
    let showFolder: Bool
    var snippet: String = ""

    var body: some View {
        let target = DocTarget(workspaceId: workspaceId, folderId: row.folderId, docId: row.doc.id)
        NavigationLink(value: Router.Route.doc(target, contextId: row.contextId, title: row.title)) {
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: "doc.text")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Theme.ink2)
                    .frame(width: 40, height: 40)
                    .background(Theme.sunken, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text(row.title).font(Theme.heading(16)).foregroundStyle(Theme.ink).lineLimit(1)
                    if !snippet.isEmpty {
                        SnippetText(snippet: snippet).lineLimit(2)
                    }
                    Text(meta).font(Theme.body(13)).foregroundStyle(Theme.muted).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 2)
        }
        .cardRow()
        .swipeActions(edge: .trailing) {
            ShareLink(item: URL(string: DocsFormat.docLink(target))!, subject: Text(row.title)) {
                Label("Share", systemImage: "square.and.arrow.up")
            }
            .tint(Theme.ink)
        }
    }

    private var meta: String {
        let when = DocsFormat.relativeTime(nanos: row.doc.updatedAt)
        let parts = [showFolder ? row.folderName : nil, when.isEmpty ? nil : "Updated \(when)"].compactMap { $0 }
        return parts.isEmpty ? "Document" : parts.joined(separator: " · ")
    }
}

/// The node's search snippet, matched words in bold.
struct SnippetText: View {
    let snippet: String

    var body: some View {
        DocsFormat.snippetPieces(snippet).reduce(Text("")) { acc, piece in
            acc + Text(piece.text).fontWeight(piece.bold ? .semibold : .regular)
                .foregroundColor(piece.bold ? Theme.ink : Theme.ink2)
        }
        .font(Theme.body(14))
    }
}

struct SectionLabel: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 12, weight: .semibold))
            .tracking(0.6)
            .foregroundStyle(Theme.muted)
            .padding(.top, 8)
    }
}

extension View {
    /// A list row drawn as a hairline card on the ground colour.
    func cardRow() -> some View {
        self.padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).stroke(Theme.line, lineWidth: Theme.hairline))
            .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
    }

    /// A full-width list row with no chrome.
    func plainRow() -> some View {
        self.listRowSeparator(.hidden).listRowBackground(Color.clear)
    }
}
