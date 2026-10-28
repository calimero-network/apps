import IssueTrackerCore
import SwiftUI

/// Workspaces, the open workspace's repositories, invitations and the account.
struct WorkspaceScreen: View {
    @ObservedObject var workspace: WorkspaceModel
    @Binding var sheet: TrackerSheet?
    let signOut: () -> Void
    @State private var confirmSignOut = false

    var body: some View {
        NavigationStack {
            List {
                if let ns = workspace.activeWorkspace {
                    Section {
                        HStack(spacing: 14) {
                            Text(String(WorkspaceModel.displayName(ns).prefix(1)).uppercased())
                                .font(Theme.heading(20)).foregroundStyle(Theme.ink)
                                .frame(width: 48, height: 48).background(Theme.lime, in: RoundedRectangle(cornerRadius: 14))
                            VStack(alignment: .leading, spacing: 3) {
                                Text(WorkspaceModel.displayName(ns)).font(Theme.heading(18)).foregroundStyle(Theme.ink)
                                Text(ns.memberCount == 1 ? "1 member" : "\(ns.memberCount) members")
                                    .font(.system(size: 13)).foregroundStyle(Theme.text3)
                            }
                        }
                        .padding(.vertical, 4)
                        Button { sheet = .invite } label: { Label("Invite people", systemImage: "person.badge.plus") }
                            .accessibilityIdentifier("workspace.invite")
                    }

                    Section("Repositories") {
                        if workspace.repos.isEmpty {
                            Text(workspace.isSyncing ? "Syncing…" : "No repos yet").foregroundStyle(Theme.text3)
                        }
                        ForEach(workspace.repos) { repo in
                            Button { workspace.selectRepo(repo.id) } label: {
                                HStack {
                                    Label {
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(repo.name).foregroundStyle(Theme.ink)
                                            if !repo.url.isEmpty {
                                                Text(repo.url).font(.system(size: 12)).foregroundStyle(Theme.text3).lineLimit(1)
                                            }
                                        }
                                    } icon: {
                                        Image(systemName: "chevron.left.forwardslash.chevron.right")
                                    }
                                    Spacer()
                                    if repo.id == workspace.activeRepoId {
                                        Image(systemName: "checkmark").foregroundStyle(Theme.ink).fontWeight(.semibold)
                                    }
                                }
                            }
                        }
                        Button { sheet = .addRepo } label: { Label("Add a repository", systemImage: "plus") }
                        if workspace.activeRepo != nil {
                            Button { sheet = .repoURL } label: { Label("Repository URL", systemImage: "link") }
                        }
                    }
                }

                Section("Workspaces") {
                    ForEach(workspace.workspaces) { ns in
                        Button { Task { await workspace.selectWorkspace(ns.id) } } label: {
                            HStack {
                                Text(WorkspaceModel.displayName(ns)).foregroundStyle(Theme.ink)
                                Spacer()
                                if ns.id == workspace.activeWorkspaceId {
                                    Image(systemName: "checkmark").foregroundStyle(Theme.ink).fontWeight(.semibold)
                                }
                            }
                        }
                    }
                    Button { sheet = .newWorkspace } label: { Label("New workspace", systemImage: "plus") }
                }

                Section("Account") {
                    HStack {
                        Avatar(seed: workspace.account, size: 28)
                        Text(TrackerFormat.truncateKey(workspace.account)).font(Theme.mono).foregroundStyle(Theme.text2)
                    }
                    Button(role: .destructive) { confirmSignOut = true } label: {
                        Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                }

                Section {
                    DetailsDisclosure(rows: detailRows)
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Theme.ground)
            .tint(Theme.ink)
            .navigationTitle("Workspace")
            .refreshable { await workspace.load() }
            .confirmationDialog("Sign out of Mero Issue Tracker?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive, action: signOut)
            }
        }
    }

    private var detailRows: [(String, String)] {
        var rows = [("Account", workspace.account), ("Relay", workspace.hasRelay ? "Connected" : "None yet")]
        if let id = workspace.activeWorkspaceId { rows.append(("Workspace (namespace)", id)) }
        if let id = workspace.activeRepoId { rows.append(("Repository (context)", id)) }
        return rows
    }
}
