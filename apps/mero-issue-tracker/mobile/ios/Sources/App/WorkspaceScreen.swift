import IssueTrackerCore
import SwiftUI

/// Workspaces, the open workspace's repositories, invitations and the account.
struct WorkspaceScreen: View {
    @ObservedObject var workspace: WorkspaceModel
    @ObservedObject var approvals: ApprovalsModel
    @Binding var sheet: TrackerSheet?
    let signOut: () -> Void
    @State private var confirmSignOut = false

    var body: some View {
        NavigationStack {
            List {
                if !approvals.items.isEmpty || approvals.error != nil {
                    Section("Needs your approval") {
                        if let error = approvals.error {
                            Text(error).font(.system(size: 14)).foregroundStyle(Theme.danger)
                        }
                        ForEach(approvals.items) { item in
                            ApprovalRow(item: item, busy: approvals.approving == item.id, disabled: approvals.approving != nil) {
                                Task { if await approvals.approve(item, orgs: orgIds) { Theme.success() } }
                            }
                        }
                    }
                    .accessibilityIdentifier("approvals.card")
                }

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
            .refreshable {
                await workspace.load()
                if DemoMode.backend == nil { await approvals.load(orgs: orgIds) }
            }
            .confirmationDialog("Sign out of Mero Issue Tracker?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive, action: signOut)
            }
        }
    }

    private var orgIds: [String] { workspace.workspaces.map(\.id) }

    private var detailRows: [(String, String)] {
        var rows = [("Account", workspace.account), ("Cluster", workspace.hasRelay ? "Connected" : "Not connected")]
        if let id = workspace.activeWorkspaceId { rows.append(("Workspace (organization)", id)) }
        if let id = workspace.activeRepoId { rows.append(("Repository (app instance)", id)) }
        return rows
    }
}

/// One thing to approve, with "Review" (the node's consent page in the system browser).
private struct ApprovalRow: View {
    let item: ApprovalsModel.Item
    let busy: Bool
    let disabled: Bool
    let review: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Theme.ink)
                .frame(width: 32, height: 32)
                .background(Theme.lime.opacity(0.35), in: RoundedRectangle(cornerRadius: 9))
            VStack(alignment: .leading, spacing: 3) {
                Text(item.title).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.ink)
                Text(item.detail).font(.system(size: 13)).foregroundStyle(Theme.text3)
            }
            Spacer(minLength: 0)
            Button {
                Theme.haptic()
                review()
            } label: {
                if busy { ProgressView().tint(Theme.ink) } else { Text("Review") }
            }
            .buttonStyle(PrimaryButtonStyle(fullWidth: false))
            .disabled(disabled)
        }
        .padding(.vertical, 4)
    }

    private var icon: String {
        switch item.kind {
        case .upgrade: return "arrow.up.circle"
        case .release: return "checkmark.shield"
        }
    }
}
