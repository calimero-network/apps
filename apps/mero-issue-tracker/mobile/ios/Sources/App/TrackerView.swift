import IssueTrackerCore
import MeroKit
import SwiftUI

enum TrackerTab: Hashable { case issues, board, workspace }

enum TrackerSheet: Identifiable {
    case newIssue, newWorkspace, addRepo, repoURL, invite, filters
    var id: Self { self }
}

/// The signed-in app: Issues, Board and Workspace tabs over one workspace model,
/// and one issues model for the open repo (shared by the list and the board).
struct TrackerView: View {
    @StateObject private var workspace: WorkspaceModel
    @State private var issues: IssuesModel?
    @State private var tab: TrackerTab = .issues
    @State private var sheet: TrackerSheet?
    @State private var hostingNotice: String?
    @Binding var justJoined: String?
    let signOut: () -> Void

    init(backend: any MeroAppBackend, applicationId: String?, justJoined: Binding<String?>, signOut: @escaping () -> Void) {
        _workspace = StateObject(
            wrappedValue: WorkspaceModel(backend: backend, applicationId: applicationId, store: DefaultsTrackerStore()))
        _justJoined = justJoined
        self.signOut = signOut
    }

    var body: some View {
        TabView(selection: $tab) {
            IssuesScreen(workspace: workspace, issues: issues, sheet: $sheet)
                .tabItem { Label("Issues", systemImage: "list.bullet") }
                .tag(TrackerTab.issues)
            BoardScreen(workspace: workspace, issues: issues, sheet: $sheet)
                .tabItem { Label("Board", systemImage: "rectangle.split.3x1") }
                .tag(TrackerTab.board)
            WorkspaceScreen(workspace: workspace, sheet: $sheet, signOut: signOut)
                .tabItem { Label("Workspace", systemImage: "person.2") }
                .tag(TrackerTab.workspace)
        }
        .task {
            workspace.markSyncing(justJoined)
            await workspace.load()
        }
        .task(id: workspace.activeRepoId) { await openRepo(workspace.activeRepoId) }
        .task(id: workspace.isSyncing) {
            // A just-joined workspace: its repos arrive with the namespace's data.
            var waited = false
            while workspace.isSyncing, !Task.isCancelled {
                waited = true
                try? await Task.sleep(nanoseconds: UInt64(Tracker.pollInterval * 1_000_000_000))
                await workspace.loadRepos()
            }
            if waited, !workspace.isSyncing { justJoined = nil }
        }
        .onChange(of: justJoined) { id in
            guard let id else { return }
            Task {
                workspace.markSyncing(id)
                await workspace.load()
                await workspace.selectWorkspace(id)
                tab = .issues
            }
        }
        .sheet(item: $sheet) { which in
            sheetView(which)
        }
        .alert(
            "Workspace created", isPresented: Binding(get: { hostingNotice != nil }, set: { if !$0 { hostingNotice = nil } })
        ) {
            Button("Got it", role: .cancel) {}
        } message: {
            Text("It is ready for you, but an invitation from it will not reach anyone yet: \(hostingNotice ?? "").")
        }
    }

    private func openRepo(_ repoId: String?) async {
        guard let repoId else {
            issues = nil
            return
        }
        let model = IssuesModel(client: workspace.client(for: repoId), repoId: repoId)
        issues = model
        await workspace.ensureMember(repoId)
        await model.load()
        await LiveUpdates.follow(backend: workspace.backend, contextId: repoId) { await model.load() }
    }

    @ViewBuilder
    private func sheetView(_ which: TrackerSheet) -> some View {
        switch which {
        case .newIssue:
            if let issues {
                NewIssueSheet(issues: issues, repoName: workspace.activeRepo?.name)
            }
        case .filters:
            if let issues { FilterSheet(issues: issues) }
        case .newWorkspace:
            NameSheet(
                title: "New workspace", message: "Name your team workspace. You will add repositories to it next.",
                field: "Workspace name", placeholder: "e.g. Platform team", action: "Create workspace"
            ) { name in
                let notice = try await workspace.createWorkspace(name: name)
                hostingNotice = notice
                tab = .issues
            }
        case .addRepo:
            AddRepoSheet(workspace: workspace) { tab = .issues }
        case .repoURL:
            NameSheet(
                title: "Repository URL", message: "The GitHub repository this repo tracks. Everyone in the workspace sees it.",
                field: "GitHub URL", placeholder: "https://github.com/owner/repo", action: "Save",
                initial: workspace.activeRepo?.url ?? "", allowsEmpty: true, keyboard: .URL
            ) { url in
                try await workspace.setRepoURL(url)
            }
        case .invite:
            InviteSheet(workspace: workspace)
        }
    }
}

/// The open repo as a title, with a menu to switch repos; and the New issue button.
struct RepoToolbar: ViewModifier {
    @ObservedObject var workspace: WorkspaceModel
    @Binding var sheet: TrackerSheet?
    let canCreate: Bool

    func body(content: Content) -> some View {
        content
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Menu {
                        if let ns = workspace.activeWorkspace {
                            Section(WorkspaceModel.displayName(ns)) {
                                ForEach(workspace.repos) { repo in
                                    Button {
                                        workspace.selectRepo(repo.id)
                                    } label: {
                                        if repo.id == workspace.activeRepoId {
                                            Label(repo.name, systemImage: "checkmark")
                                        } else {
                                            Text(repo.name)
                                        }
                                    }
                                }
                            }
                            Button { sheet = .addRepo } label: { Label("Add a repository", systemImage: "plus") }
                        }
                    } label: {
                        VStack(spacing: 0) {
                            HStack(spacing: 4) {
                                Text(workspace.activeRepo?.name ?? "Issues").font(Theme.heading(16)).foregroundStyle(Theme.ink)
                                if workspace.activeWorkspace != nil {
                                    Image(systemName: "chevron.down").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.text3)
                                }
                            }
                            if let ns = workspace.activeWorkspace {
                                Text(WorkspaceModel.displayName(ns)).font(.system(size: 11)).foregroundStyle(Theme.text3)
                            }
                        }
                    }
                    .accessibilityLabel("Switch repository")
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    if canCreate {
                        Button {
                            Theme.haptic(.light)
                            sheet = .newIssue
                        } label: {
                            Image(systemName: "plus")
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(Theme.ink)
                                .frame(width: 32, height: 32)
                                .background(Theme.lime, in: Circle())
                        }
                        .accessibilityLabel("New issue")
                    }
                }
            }
            .toolbarBackground(Theme.ground, for: .navigationBar)
    }
}

/// What a tab shows before there are issues to show: no workspace, no repo, syncing, failed.
struct RepoGate<Content: View>: View {
    @ObservedObject var workspace: WorkspaceModel
    let issues: IssuesModel?
    @Binding var sheet: TrackerSheet?
    @ViewBuilder let content: (IssuesModel) -> Content

    var body: some View {
        Group {
            if case .failed(let text) = workspace.phase {
                EmptyState(icon: "wifi.exclamationmark", title: "Could not load your workspaces", message: text,
                           action: ("Try again", { Task { await workspace.load() } }))
            } else if workspace.phase == .loading || workspace.phase == .idle {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if workspace.activeWorkspace == nil {
                EmptyState(
                    icon: "person.2", title: "No workspace yet",
                    message: "Create a workspace for your team, or open an invitation link someone sent you.",
                    action: ("New workspace", { sheet = .newWorkspace }))
            } else if workspace.isSyncing {
                EmptyState(icon: "arrow.triangle.2.circlepath", title: "Syncing this workspace…",
                           message: "Repositories and issues appear as soon as your teammates’ devices send them.")
            } else if workspace.reposPhase == .loading && workspace.repos.isEmpty {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if workspace.activeRepo == nil {
                EmptyState(
                    icon: "chevron.left.forwardslash.chevron.right", title: "No repository yet",
                    message: "Add a repository to this workspace to start tracking its issues.",
                    action: ("Add a repository", { sheet = .addRepo }))
            } else if let issues {
                content(issues)
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.ground.ignoresSafeArea())
    }
}
