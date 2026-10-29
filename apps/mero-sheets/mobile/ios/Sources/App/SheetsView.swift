import MeroKit
import SheetsCore
import SwiftUI

enum AppTab: Hashable { case spreadsheets, workspace }

enum AppSheet: Identifiable {
    case newWorkspace, newSpreadsheet, invite
    var id: Self { self }
}

/// The signed-in app: the Spreadsheets tab (a list that opens each one) and the
/// Workspace tab, over one workspace model.
struct SheetsView: View {
    @StateObject private var workspace: WorkspaceModel
    @State private var tab: AppTab = .spreadsheets
    @State private var sheet: AppSheet?
    @State private var path: [String] = []
    @State private var hostingNotice: String?
    @State private var inviteFor: SpreadsheetItem?
    @Binding var justJoined: JoinedWorkspace?
    let signOut: () -> Void

    init(backend: any MeroAppBackend, applicationId: String?, justJoined: Binding<JoinedWorkspace?>, signOut: @escaping () -> Void) {
        _workspace = StateObject(
            wrappedValue: WorkspaceModel(backend: backend, applicationId: applicationId, store: DefaultsSheetsStore()))
        _justJoined = justJoined
        self.signOut = signOut
    }

    var body: some View {
        TabView(selection: $tab) {
            SpreadsheetsScreen(workspace: workspace, sheet: $sheet, path: $path, inviteFor: $inviteFor)
                .tabItem { Label("Spreadsheets", systemImage: "tablecells") }
                .tag(AppTab.spreadsheets)
            WorkspaceScreen(workspace: workspace, sheet: Binding(get: { sheet }, set: { inviteFor = nil; sheet = $0 }), signOut: signOut) { id in
                path = [id]
                tab = .spreadsheets
            }
            .tabItem { Label("Workspace", systemImage: "person.2") }
            .tag(AppTab.workspace)
        }
        .task {
            workspace.markSyncing(justJoined?.namespaceId)
            await workspace.load()
            openJoinedSpreadsheet()
        }
        .task(id: workspace.isSyncing) {
            // A just-joined workspace: its spreadsheets arrive with the namespace's data.
            var waited = false
            while workspace.isSyncing, !Task.isCancelled {
                waited = true
                try? await Task.sleep(nanoseconds: UInt64(MeroSheets.pollInterval * 1_000_000_000))
                await workspace.loadSpreadsheets()
            }
            if waited, !workspace.isSyncing { openJoinedSpreadsheet() }
        }
        .onChange(of: justJoined) { joined in
            guard let joined else { return }
            Task {
                workspace.markSyncing(joined.namespaceId)
                await workspace.load()
                await workspace.selectWorkspace(joined.namespaceId)
                tab = .spreadsheets
                path = []
                openJoinedSpreadsheet()
            }
        }
        .sheet(item: $sheet) { which in
            switch which {
            case .newWorkspace:
                NameSheet(
                    title: "New workspace",
                    message: "A workspace holds your team’s spreadsheets. Everyone you invite gets all of them.",
                    field: "Workspace name", placeholder: "e.g. Finance", action: "Create workspace"
                ) { name in
                    hostingNotice = try await workspace.createWorkspace(name: name)
                    path = []
                    tab = .spreadsheets
                }
            case .newSpreadsheet:
                NameSheet(
                    title: "New spreadsheet",
                    message: "Everyone in \(workspace.activeWorkspace.map(WorkspaceModel.displayName) ?? "the workspace") can open it.",
                    field: "Spreadsheet name", placeholder: "e.g. Q3 Budget", action: "Create spreadsheet"
                ) { name in
                    let id = try await workspace.createSpreadsheet(name: name)
                    tab = .spreadsheets
                    path = [id]
                }
            case .invite:
                InviteSheet(workspace: workspace, spreadsheet: inviteFor)
            }
        }
        .alert(
            "Workspace created", isPresented: Binding(get: { hostingNotice != nil }, set: { if !$0 { hostingNotice = nil } })
        ) {
            Button("Got it", role: .cancel) {}
        } message: {
            Text("It is ready for you, but an invitation from it will not reach anyone yet: \(hostingNotice ?? "").")
        }
    }

    /// After joining from a link that named a spreadsheet, open it once it is listed.
    private func openJoinedSpreadsheet() {
        guard let joined = justJoined, joined.namespaceId == workspace.activeWorkspaceId, !workspace.isSyncing else { return }
        if let id = joined.contextId, workspace.spreadsheet(id) != nil {
            path = [id]
        }
        justJoined = nil
    }
}

/// The open workspace's spreadsheets; the title switches workspaces.
struct SpreadsheetsScreen: View {
    @ObservedObject var workspace: WorkspaceModel
    @Binding var sheet: AppSheet?
    @Binding var path: [String]
    @Binding var inviteFor: SpreadsheetItem?

    var body: some View {
        NavigationStack(path: $path) {
            gate
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Theme.ground.ignoresSafeArea())
                .navigationBarTitleDisplayMode(.inline)
                .toolbarBackground(Theme.ground, for: .navigationBar)
                .toolbar {
                    ToolbarItem(placement: .principal) { switcher }
                    ToolbarItem(placement: .navigationBarTrailing) {
                        if workspace.activeWorkspace != nil {
                            Button {
                                Theme.haptic(.light)
                                sheet = .newSpreadsheet
                            } label: {
                                Image(systemName: "plus")
                                    .font(.system(size: 15, weight: .bold))
                                    .foregroundStyle(Theme.ink)
                                    .frame(width: 32, height: 32)
                                    .background(Theme.lime, in: Circle())
                            }
                            .accessibilityLabel("New spreadsheet")
                        }
                    }
                }
                .navigationDestination(for: String.self) { id in
                    SpreadsheetScreen(workspace: workspace, contextId: id)
                }
        }
    }

    private var switcher: some View {
        Menu {
            Section("Workspaces") {
                ForEach(workspace.workspaces) { ns in
                    Button {
                        Task { await workspace.selectWorkspace(ns.id) }
                    } label: {
                        if ns.id == workspace.activeWorkspaceId {
                            Label(WorkspaceModel.displayName(ns), systemImage: "checkmark")
                        } else {
                            Text(WorkspaceModel.displayName(ns))
                        }
                    }
                }
            }
            Button { sheet = .newWorkspace } label: { Label("New workspace", systemImage: "plus") }
        } label: {
            VStack(spacing: 0) {
                HStack(spacing: 4) {
                    Text("Spreadsheets").font(Theme.heading(16)).foregroundStyle(Theme.ink)
                    Image(systemName: "chevron.down").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.text3)
                }
                if let ns = workspace.activeWorkspace {
                    Text(WorkspaceModel.displayName(ns)).font(.system(size: 11)).foregroundStyle(Theme.text3)
                }
            }
        }
        .accessibilityLabel("Switch workspace")
    }

    @ViewBuilder private var gate: some View {
        if case .failed(let text) = workspace.phase {
            EmptyState(
                icon: "wifi.exclamationmark", title: "Could not load your workspaces", message: text,
                action: ("Try again", { Task { await workspace.load() } }))
        } else if workspace.phase == .loading || workspace.phase == .idle {
            ProgressView().controlSize(.large)
        } else if workspace.activeWorkspace == nil {
            EmptyState(
                icon: "person.2", title: "No workspace yet",
                message: "Create a workspace for your team, or open an invitation link someone sent you.",
                action: ("New workspace", { sheet = .newWorkspace }))
        } else if workspace.isSyncing {
            EmptyState(
                icon: "arrow.triangle.2.circlepath", title: "Syncing this workspace…",
                message: "Spreadsheets appear as soon as your teammates’ devices send them.")
        } else if workspace.spreadsheetsPhase == .loading && workspace.spreadsheets.isEmpty {
            ProgressView().controlSize(.large)
        } else if case .failed(let text) = workspace.spreadsheetsPhase, workspace.spreadsheets.isEmpty {
            EmptyState(
                icon: "wifi.exclamationmark", title: "Could not load the spreadsheets", message: text,
                action: ("Try again", { Task { await workspace.loadSpreadsheets() } }))
        } else if workspace.spreadsheets.isEmpty {
            EmptyState(
                icon: "tablecells", title: "No spreadsheets yet",
                message: "Create the first spreadsheet in this workspace. Everyone in it can open it.",
                action: ("New spreadsheet", { sheet = .newSpreadsheet }))
        } else {
            List {
                Section {
                    ForEach(workspace.spreadsheets) { item in
                        NavigationLink(value: item.id) {
                            HStack(spacing: 14) {
                                Image(systemName: "tablecells")
                                    .font(.system(size: 17, weight: .medium))
                                    .foregroundStyle(Theme.ink)
                                    .frame(width: 40, height: 40)
                                    .background(Theme.lime.opacity(0.35), in: RoundedRectangle(cornerRadius: 11))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.name).font(.system(size: 16, weight: .semibold))
                                        .foregroundStyle(item.unnamed ? Theme.text2 : Theme.ink).lineLimit(1)
                                    Text(item.unnamed ? "Name not synced yet" : "Spreadsheet")
                                        .font(.system(size: 13)).foregroundStyle(Theme.text3)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                        .swipeActions(edge: .trailing) {
                            Button {
                                inviteFor = item
                                sheet = .invite
                            } label: {
                                Label("Invite", systemImage: "person.badge.plus")
                            }
                            .tint(Theme.ink)
                        }
                    }
                } footer: {
                    Text("Spreadsheets are shared with everyone in the workspace.")
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .refreshable { await workspace.loadSpreadsheets() }
        }
    }
}
