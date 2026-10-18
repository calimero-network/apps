import MeroKit
import UIKit
import SwiftUI

/// Root of a signed-in session: the account's workspaces.
struct WorkspacesScreen: View {
    @ObservedObject var session: SessionModel
    let backend: DelegatedChatBackend
    @StateObject private var model: WorkspacesModel
    @State private var path = NavigationPath()
    @State private var sheet: WorkspacesSheet?

    init(session: SessionModel, backend: DelegatedChatBackend) {
        self.session = session
        self.backend = backend
        _model = StateObject(
            wrappedValue: WorkspacesModel(
                backend: backend,
                applicationId: { [weak session] in session?.applicationId },
                displayName: { [weak session] in session?.displayName ?? "" }))
    }

    var body: some View {
        NavigationStack(path: $path) {
            content
                .navigationTitle("Workspaces")
                .toolbar { toolbar }
                .navigationDestination(for: Workspace.self) { workspace in
                    ChannelsScreen(session: session, backend: backend, workspace: workspace)
                }
                .navigationDestination(for: ChannelEntry.self) { channel in
                    ChannelScreen(session: session, backend: backend, channel: channel)
                }
        }
        .task { await model.load() }
        .sheet(item: $sheet) { sheet in
            switch sheet {
            case .create:
                NameSheet(title: "New workspace", placeholder: "Workspace name", action: "Create") { name in
                    await model.create(name: name)
                }
            case .join(let prefill):
                JoinWorkspaceSheet(prefill: prefill) { link in
                    guard await model.join(invitation: link) != nil else { return false }
                    await session.didJoinWorkspace()
                    await model.load()
                    return true
                }
            case .settings:
                SettingsSheet(session: session)
            }
        }
        .onChange(of: session.pendingInvitation) { link in
            guard let link else { return }
            session.pendingInvitation = nil
            sheet = .join(prefill: link)
        }
        .onAppear {
            if let link = session.pendingInvitation {
                session.pendingInvitation = nil
                sheet = .join(prefill: link)
            }
        }
    }

    @ViewBuilder private var content: some View {
        List {
            StatusBanners(error: $model.errorText, notice: $model.notice)
            if let note = session.client.cloudNote {
                Section { Label(note, systemImage: "info.circle").font(.footnote) }
            }
            if !model.hasRelay {
                Section {
                    EmptyStateView(
                        title: "No relay yet",
                        message: "You're signed in, but no relay serves this account yet. "
                            + "Join a workspace from an invitation link to get one.",
                        systemImage: "antenna.radiowaves.left.and.right.slash")
                    Button("Join with an invitation") { sheet = .join(prefill: "") }
                }
            } else if model.workspaces.isEmpty, !model.isLoading {
                Section {
                    EmptyStateView(
                        title: "No workspaces",
                        message: "Create a workspace, or join one from an invitation link.",
                        systemImage: "person.3")
                }
            } else {
                Section {
                    ForEach(model.workspaces) { workspace in
                        NavigationLink(value: workspace) {
                            WorkspaceRow(workspace: workspace, model: model)
                        }
                    }
                }
            }
        }
        .overlay {
            if model.isLoading && model.workspaces.isEmpty { ProgressView() }
        }
        .refreshable { await model.load() }
        .disabled(model.isWorking)
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .navigationBarLeading) {
            Button {
                sheet = .settings
            } label: {
                Image(systemName: "person.crop.circle")
            }
            .accessibilityLabel("Settings")
        }
        ToolbarItem(placement: .navigationBarTrailing) {
            Menu {
                Button("New workspace") { sheet = .create }
                    .disabled(!model.hasRelay)
                Button("Join with an invitation") { sheet = .join(prefill: "") }
            } label: {
                if model.isWorking { ProgressView() } else { Image(systemName: "plus") }
            }
            .accessibilityIdentifier("workspacesAdd")
        }
    }
}

private enum WorkspacesSheet: Identifiable {
    case create
    case join(prefill: String)
    case settings

    var id: String {
        switch self {
        case .create: return "create"
        case .join: return "join"
        case .settings: return "settings"
        }
    }
}

private struct WorkspaceRow: View {
    let workspace: Workspace
    @ObservedObject var model: WorkspacesModel
    @State private var inviteLink: String?

    var body: some View {
        HStack {
            Image(systemName: "square.stack.3d.up.fill")
                .foregroundStyle(.tint)
            Text(workspace.name)
            Spacer()
            if let inviteLink, let url = URL(string: inviteLink) {
                ShareLink(item: url) { Image(systemName: "square.and.arrow.up") }
                    .buttonStyle(.borderless)
            }
        }
        .contextMenu {
            Button("Create invitation link") {
                Task { inviteLink = await model.inviteLink(for: workspace) }
            }
            Button("Copy workspace id") { UIPasteboard.general.string = workspace.id }
        }
    }
}

/// Paste (or confirm) an invitation link and redeem it.
struct JoinWorkspaceSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var link: String
    @State private var working = false
    let onJoin: (String) async -> Bool

    init(prefill: String, onJoin: @escaping (String) async -> Bool) {
        _link = State(initialValue: prefill)
        self.onJoin = onJoin
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://links.calimero.network/com.calimero.chat/join?invitation=…", text: $link, axis: .vertical)
                        .lineLimit(3...6)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("joinLinkField")
                } footer: {
                    Text("Paste the invitation link someone shared from Mero Chat on the web, desktop or a phone.")
                }
            }
            .navigationTitle("Join a workspace")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if working {
                        ProgressView()
                    } else {
                        Button("Join") {
                            Task {
                                working = true
                                let ok = await onJoin(link)
                                working = false
                                if ok { dismiss() }
                            }
                        }
                        .disabled(link.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
            }
        }
    }
}

/// The account, the display name used in channels, and sign out.
struct SettingsSheet: View {
    @ObservedObject var session: SessionModel
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Your name", text: $name)
                        .textInputAutocapitalization(.words)
                } header: {
                    Text("Display name")
                } footer: {
                    Text("Registered in each channel you create or join. A channel keeps the first name you register in it.")
                }
                Section("Account") {
                    LabeledContent("Account", value: ChatIdentity.short(session.account ?? "—"))
                    if let relay = session.client.relayURL {
                        LabeledContent("Relay", value: relay)
                    }
                }
                Section {
                    Button("Sign out", role: .destructive) {
                        Task {
                            await session.signOut()
                            dismiss()
                        }
                    }
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        session.displayName = name.trimmingCharacters(in: .whitespacesAndNewlines)
                        dismiss()
                    }
                }
            }
            .onAppear { name = session.displayName }
        }
    }
}
