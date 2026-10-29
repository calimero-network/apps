import CrmCore
import MeroKit
import MeroKitUI
import SwiftUI

/// Signed in, no pipeline open: your workspaces and their pipelines, founding
/// one, adding a pipeline, joining with an invitation.
struct WorkspacesView: View {
    @StateObject private var model: WorkspacesModel
    @EnvironmentObject private var session: MeroAppSession
    let onOpen: (PipelineRef) -> Void
    let onSignOut: () -> Void
    @State private var creating = false
    @State private var joining = false
    @State private var addingTo: Workspace?

    init(
        backend: any MeroAppBackend, applicationId: String?, onOpen: @escaping (PipelineRef) -> Void,
        onSignOut: @escaping () -> Void
    ) {
        _model = StateObject(wrappedValue: WorkspacesModel(backend: backend, applicationId: applicationId))
        self.onOpen = onOpen
        self.onSignOut = onSignOut
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if let error = model.error { ErrorLine(message: error) }
                    if !model.hasLoaded {
                        ProgressView().frame(maxWidth: .infinity).padding(.vertical, 40)
                    } else if model.workspaces.isEmpty {
                        Card {
                            EmptyState(
                                icon: "building.2", title: "No workspaces yet",
                                message: model.hasRelay
                                    ? "Start one for your team, or open an invitation link someone sent you."
                                    : "Your account has no relay yet. Join a workspace with an invitation link first.")
                        }
                    } else {
                        ForEach(Array(model.workspaces.enumerated()), id: \.element.id) { index, workspace in
                            WorkspaceCard(workspace: workspace, index: index, onOpen: onOpen) { addingTo = workspace }
                        }
                    }
                    VStack(spacing: 10) {
                        if model.hasRelay {
                            Button {
                                creating = true
                            } label: {
                                Label("New workspace", systemImage: "plus")
                            }
                            .buttonStyle(PrimaryButtonStyle())
                        }
                        Button {
                            joining = true
                        } label: {
                            Label("Join with an invitation", systemImage: "envelope.open")
                        }
                        .buttonStyle(SecondaryButtonStyle())
                    }
                    .padding(.top, 6)
                }
                .padding(16)
            }
            .screenBackground()
            .navigationTitle("Workspaces")
            .refreshable { await model.load() }
            .task { await model.load() }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        if let account = DemoMode.backend?.account ?? session.account {
                            Text("Signed in as \(Account.short(account))")
                        }
                        Button(role: .destructive, action: onSignOut) {
                            Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                        }
                    } label: {
                        Image(systemName: "person.crop.circle").accessibilityLabel("Account")
                    }
                }
            }
            .sheet(isPresented: $creating) {
                NewWorkspaceSheet(model: model) { pipeline in
                    creating = false
                    onOpen(pipeline)
                }
            }
            .sheet(item: $addingTo) { workspace in
                AddPipelineSheet(model: model, workspace: workspace) { pipeline in
                    addingTo = nil
                    onOpen(pipeline)
                }
            }
            .sheet(isPresented: $joining) {
                JoinSheet(model: model) { pipeline in
                    joining = false
                    if let pipeline { onOpen(pipeline) }
                }
            }
        }
    }
}

private struct WorkspaceCard: View {
    let workspace: Workspace
    let index: Int
    let onOpen: (PipelineRef) -> Void
    let onAdd: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Palette.limeSoft)
                    .frame(width: 40, height: 40)
                    .overlay(Text(String(workspace.title.prefix(1)).uppercased()).font(.headline).foregroundStyle(Palette.ink))
                VStack(alignment: .leading, spacing: 2) {
                    Text(workspace.title).font(.headline).foregroundStyle(Palette.ink)
                    Text(subtitle).font(.footnote).foregroundStyle(Palette.ink2)
                }
                Spacer()
            }
            .padding(14)
            Divider().overlay(Palette.hairline)
            if workspace.pipelines.isEmpty {
                Text("No pipelines here yet. A teammate's pipelines appear once they sync to you.")
                    .font(.footnote).foregroundStyle(Palette.ink2)
                    .padding(14)
            }
            ForEach(Array(workspace.pipelines.enumerated()), id: \.element.id) { n, pipeline in
                Button {
                    Haptics.tap()
                    onOpen(pipeline)
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "rectangle.split.3x1").foregroundStyle(Palette.ink2).frame(width: 24)
                        Text(pipeline.name).font(.body.weight(.medium)).foregroundStyle(Palette.ink)
                        Spacer()
                        Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Palette.ink3)
                    }
                    .padding(.horizontal, 14)
                    .frame(minHeight: 48)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("workspaces.pipeline.\(index).\(n)")
                Divider().overlay(Palette.hairline).padding(.leading, 50)
            }
            Button(action: onAdd) {
                HStack(spacing: 12) {
                    Image(systemName: "plus").foregroundStyle(Palette.ink2).frame(width: 24)
                    Text("Add pipeline").font(.subheadline.weight(.medium)).foregroundStyle(Palette.ink2)
                    Spacer()
                }
                .padding(.horizontal, 14)
                .frame(minHeight: 46)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Palette.hairline, lineWidth: 0.5))
    }

    private var subtitle: String {
        let p = workspace.pipelines.count
        let pipelines = "\(p) pipeline\(p == 1 ? "" : "s")"
        guard workspace.memberCount > 0 else { return pipelines }
        return "\(pipelines) · \(workspace.memberCount) member\(workspace.memberCount == 1 ? "" : "s")"
    }
}

/// The body every create/edit sheet shares: a title bar with Cancel, scrolling
/// fields, and the primary action at the bottom.
struct SheetScaffold<Content: View>: View {
    let title: String
    let action: String
    var busy = false
    var enabled = true
    var error: String?
    let onAction: () -> Void
    @ViewBuilder let content: Content
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    content
                    if let error { ErrorLine(message: error) }
                    Button(action: onAction) {
                        if busy {
                            HStack(spacing: 8) {
                                ProgressView().tint(Palette.ink)
                                Text("Saving…")
                            }
                        } else {
                            Text(action)
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(!enabled || busy)
                }
                .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
            .screenBackground()
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }
}

private struct NewWorkspaceSheet: View {
    @ObservedObject var model: WorkspacesModel
    let onCreated: (PipelineRef) -> Void
    @State private var name = ""
    @State private var pipeline = "Sales"
    @State private var currency = "USD"

    var body: some View {
        SheetScaffold(
            title: "New workspace", action: "Create workspace", busy: model.isWorking,
            enabled: !name.trimmingCharacters(in: .whitespaces).isEmpty, error: model.error, onAction: create
        ) {
            Text("A workspace is your team. Its pipelines live on its members' nodes and nowhere else.")
                .font(.subheadline).foregroundStyle(Palette.ink2)
            Field(label: "Workspace name", placeholder: "e.g. Acme sales", text: $name)
            Field(label: "First pipeline", placeholder: "e.g. Sales", text: $pipeline)
            Field(label: "Currency", placeholder: "USD", text: $currency, capitalization: .characters)
        }
        .onAppear { model.error = nil }
        .presentationDetents([.large])
    }

    private func create() {
        Task {
            if let created = await model.createWorkspace(name: name, pipelineName: pipeline, currency: currency) {
                Haptics.success()
                onCreated(created)
            } else {
                Haptics.error()
            }
        }
    }
}

private struct AddPipelineSheet: View {
    @ObservedObject var model: WorkspacesModel
    let workspace: Workspace
    let onCreated: (PipelineRef) -> Void
    @State private var name = ""
    @State private var currency = "USD"

    var body: some View {
        SheetScaffold(
            title: "Add pipeline", action: "Add pipeline", busy: model.isWorking,
            enabled: !name.trimmingCharacters(in: .whitespaces).isEmpty, error: model.error, onAction: add
        ) {
            Text("A separate board in \(workspace.title), with its own stages, deals and settings.")
                .font(.subheadline).foregroundStyle(Palette.ink2)
            Field(label: "Pipeline name", placeholder: "e.g. Partnerships", text: $name)
            Field(label: "Currency", placeholder: "USD", text: $currency, capitalization: .characters)
        }
        .onAppear { model.error = nil }
        .presentationDetents([.medium, .large])
    }

    private func add() {
        Task {
            if let created = await model.addPipeline(to: workspace, name: name, currency: currency) {
                Haptics.success()
                onCreated(created)
            } else {
                Haptics.error()
            }
        }
    }
}

/// Paste an invitation link.
private struct JoinSheet: View {
    @EnvironmentObject private var session: MeroAppSession
    @ObservedObject var model: WorkspacesModel
    let onJoined: (PipelineRef?) -> Void
    @State private var link = ""
    @State private var invalid = false

    var body: some View {
        SheetScaffold(
            title: "Join a workspace", action: model.isWorking ? "Joining…" : "Join", busy: model.isWorking,
            enabled: !link.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            error: invalid ? CrmError.notAnInvitation.errorDescription : model.error, onAction: join
        ) {
            Text("Paste the invitation link a teammate sent you.")
                .font(.subheadline).foregroundStyle(Palette.ink2)
            TextField("Invitation link", text: $link, axis: .vertical)
                .lineLimit(1...4)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(12)
                .background(Palette.surface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Palette.hairline, lineWidth: 1))
        }
        .onAppear { model.error = nil }
        .presentationDetents([.medium])
    }

    private func join() {
        guard let invitation = CrmInvitation.parse(link) else {
            invalid = true
            Haptics.error()
            return
        }
        invalid = false
        Task {
            if let id = await model.join(invitation) {
                await session.didJoinNamespace()
                Haptics.success()
                let pipelines = model.workspace(id)?.pipelines ?? []
                onJoined(pipelines.count == 1 ? pipelines[0] : nil)
            } else {
                Haptics.error()
            }
        }
    }
}

/// An invitation link the system handed the app: ask before joining.
struct InvitationSheet: View {
    let raw: String
    let onDone: (PipelineRef?) -> Void
    @StateObject private var model: WorkspacesModel
    @EnvironmentObject private var session: MeroAppSession

    init(raw: String, backend: any MeroAppBackend, applicationId: String?, onDone: @escaping (PipelineRef?) -> Void) {
        self.raw = raw
        self.onDone = onDone
        _model = StateObject(wrappedValue: WorkspacesModel(backend: backend, applicationId: applicationId))
    }

    var body: some View {
        let invitation = CrmInvitation.parse(raw)
        VStack(alignment: .leading, spacing: 18) {
            Image(systemName: "envelope.open").font(.system(size: 28)).foregroundStyle(Palette.ink)
                .frame(width: 56, height: 56).background(Palette.limeSoft, in: RoundedRectangle(cornerRadius: 14))
            Text(invitation?.workspaceName.map { "Join \($0)?" } ?? "Join this workspace?")
                .font(.title2.weight(.bold)).foregroundStyle(Palette.ink)
            Text(
                "Joining makes your account a member of the workspace, and its pipelines sync to you from your teammates."
            )
            .font(.subheadline).foregroundStyle(Palette.ink2)
            if invitation == nil { ErrorLine(message: CrmError.notAnInvitation.errorDescription ?? "") }
            if let error = model.error { ErrorLine(message: error) }
            Spacer()
            Button {
                guard let invitation else { return }
                Task {
                    if let id = await model.join(invitation) {
                        Haptics.success()
                        let pipelines = model.workspace(id)?.pipelines ?? []
                        onDone(pipelines.count == 1 ? pipelines[0] : nil)
                    } else {
                        Haptics.error()
                    }
                }
            } label: {
                Text(model.isWorking ? "Joining…" : "Join workspace")
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(invitation == nil || model.isWorking)
            Button("Not now") { session.dismissPendingInvitation() }
                .buttonStyle(SecondaryButtonStyle())
        }
        .padding(24)
        .presentationDetents([.medium])
    }
}
