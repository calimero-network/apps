import MeroKit
import MeroKitUI
import ModelsCore
import SwiftUI

/// The studios this account is in.
struct StudiosScreen: View {
    @ObservedObject var session: MeroAppSession
    @ObservedObject var invitation: InvitationModel
    @StateObject private var model: StudiosModel
    @StateObject private var approvals: ApprovalsModel
    @State private var showAccount = false
    @State private var showJoin = false

    init(session: MeroAppSession, backend: any MeroAppBackend, invitation: InvitationModel) {
        self.session = session
        self.invitation = invitation
        _model = StateObject(wrappedValue: StudiosModel(backend: backend))
        _approvals = StateObject(wrappedValue: ApprovalsModel(session: session))
    }

    var body: some View {
        List {
            ApprovalsSection(model: approvals)
            switch model.state {
            case .idle:
                LoadingRows().listRowInsets(EdgeInsets()).plainRow()
            case .loading where model.studios.isEmpty:
                LoadingRows().listRowInsets(EdgeInsets()).plainRow()
            case .failed(let message) where model.studios.isEmpty:
                ErrorBanner(message: message) { Task { await model.load() } }.plainRow()
            default:
                if model.studios.isEmpty {
                    EmptyState(
                        icon: "cube.transparent",
                        title: "No studios yet",
                        message: "Start a scene in Mero Models on the web, or join a studio with an invitation link.",
                        action: ("Join with a link", { showJoin = true }))
                    .plainRow()
                } else {
                    Section {
                        ForEach(model.studios) { studio in
                            NavigationLink(value: Router.Route.studio(id: studio.id, name: studio.name)) {
                                StudioRow(studio: studio)
                            }
                            .cardRow()
                        }
                    } header: {
                        SectionLabel("Studios")
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Theme.ground)
        .navigationTitle("Mero Models")
        .toolbar {
            ToolbarItemGroup(placement: .navigationBarTrailing) {
                Button {
                    showJoin = true
                } label: {
                    Image(systemName: "link.badge.plus")
                }
                .accessibilityLabel("Join with a link")
                Button {
                    showAccount = true
                } label: {
                    Image(systemName: "person.crop.circle")
                }
                .accessibilityLabel("Account")
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .onChange(of: invitation.stage) { stage in
            if case .joined = stage { Task { await model.load() } }
        }
        .sheet(isPresented: $showAccount) {
            AccountSheet(session: session).presentationDetents([.medium])
        }
        .sheet(isPresented: $showJoin) {
            JoinSheet { link in
                showJoin = false
                // The confirmation opens once this sheet has gone.
                Task {
                    try? await Task.sleep(nanoseconds: 400_000_000)
                    invitation.open(link)
                }
            }
            .presentationDetents([.medium])
        }
    }
}

extension StudiosScreen {
    /// The studios, then what waits for approval in the account and in each studio.
    fileprivate func load() async {
        await model.load()
        await approvals.refresh(orgs: model.studios.map(\.id))
    }
}

private struct StudioRow: View {
    let studio: Studio

    var body: some View {
        HStack(spacing: 14) {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Theme.memberColor(studio.id).opacity(0.14))
                .frame(width: 44, height: 44)
                .overlay(
                    Text(ModelsFormat.initials(studio.name))
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Theme.memberColor(studio.id)))
            VStack(alignment: .leading, spacing: 3) {
                Text(studio.name).font(Theme.heading(17)).foregroundStyle(Theme.ink).lineLimit(1)
                Text(ModelsFormat.count(studio.memberCount, "member"))
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.muted)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
    }
}

/// Paste an invitation link.
struct JoinSheet: View {
    let submit: (String) -> Void
    @State private var text = ""
    @SwiftUI.Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("Paste the link someone shared from Mero Models. It opens their scene once you've joined.")
                    .font(Theme.body(15))
                    .foregroundStyle(Theme.muted)
                TextField("https://links.calimero.network/…", text: $text, axis: .vertical)
                    .font(Theme.body(15))
                    .lineLimit(3...5)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focused)
                    .card(padding: 14)
                Button("Continue") {
                    Haptics.tap()
                    submit(text)
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Spacer()
            }
            .padding(16)
            .background(Theme.ground)
            .navigationTitle("Join with a link")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Paste") { if let s = UIPasteboard.general.string { text = s } }
                }
            }
            .onAppear { focused = true }
        }
    }
}

/// Who is signed in, and signing out.
struct AccountSheet: View {
    @ObservedObject var session: MeroAppSession
    @SwiftUI.Environment(\.dismiss) private var dismiss
    @State private var confirm = false

    private var nodeLine: String {
        guard let url = session.client.nodeURL else { return "Not connected to a cluster" }
        let host = URL(string: url)?.host ?? url
        return session.client.allowMock ? "Development cluster at \(host)" : "Connected to \(host)"
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 12) {
                    Avatar(id: session.account ?? "", name: "Me", size: 44)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Signed in").font(Theme.heading(17)).foregroundStyle(Theme.ink)
                        Text(nodeLine)
                            .font(Theme.body(14))
                            .foregroundStyle(Theme.muted)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .card()
                DetailsDisclosure(rows: [
                    ("Account", session.account ?? "—"),
                    ("Package", session.applicationId ?? "—"),
                    ("Node", session.client.nodeURL ?? "—"),
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
            .confirmationDialog("Sign out of Mero Models?", isPresented: $confirm, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) {
                    dismiss()
                    Task { await session.signOut() }
                }
            }
        }
    }
}

/// A studio's scenes.
struct ScenesScreen: View {
    let studioName: String
    @StateObject private var model: ScenesModel
    @State private var shared: SharedLink?
    @State private var sharing: String?
    @State private var shareError: String?

    init(backend: any MeroAppBackend, studioId: String, studioName: String) {
        self.studioName = studioName
        _model = StateObject(wrappedValue: ScenesModel(backend: backend, studioId: studioId))
    }

    var body: some View {
        List {
            switch model.state {
            case .idle:
                LoadingRows().listRowInsets(EdgeInsets()).plainRow()
            case .loading where model.scenes.isEmpty:
                LoadingRows().listRowInsets(EdgeInsets()).plainRow()
            case .failed(let message) where model.scenes.isEmpty:
                ErrorBanner(message: message) { Task { await model.load() } }.plainRow()
            default:
                if model.scenes.isEmpty {
                    EmptyState(
                        icon: "cube",
                        title: "No scenes in this studio",
                        message: "Scenes are made in Mero Models on the web or desktop. Pull to refresh once one exists.")
                    .plainRow()
                } else {
                    Section {
                        ForEach(model.scenes) { scene in
                            NavigationLink(
                                value: Router.Route.scene(studioId: model.studioId, contextId: scene.contextId, name: scene.name)
                            ) {
                                SceneRow(scene: scene, sharing: sharing == scene.contextId)
                            }
                            .cardRow()
                            .swipeActions(edge: .trailing) {
                                Button {
                                    share(scene.contextId)
                                } label: {
                                    Label("Share", systemImage: "square.and.arrow.up")
                                }
                                .tint(Theme.ink)
                            }
                        }
                    } header: {
                        SectionLabel(ModelsFormat.count(model.scenes.count, "scene"))
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Theme.ground)
        .navigationTitle(studioName)
        .navigationBarTitleDisplayMode(.large)
        .refreshable { await model.load() }
        .task { await model.load() }
        .sheet(item: $shared) { link in ShareSheet(items: [URL(string: link.url) ?? link.url]).presentationDetents([.medium, .large]) }
        .alert("Couldn't make a link", isPresented: Binding(get: { shareError != nil }, set: { if !$0 { shareError = nil } })) {
            Button("OK") { shareError = nil }
        } message: {
            Text(shareError ?? "")
        }
    }

    private func share(_ contextId: String) {
        Haptics.tap()
        sharing = contextId
        Task {
            defer { sharing = nil }
            do {
                shared = SharedLink(url: try await model.shareLink(contextId))
            } catch {
                Haptics.error()
                shareError = ModelsFormat.errorText(error)
            }
        }
    }
}

private struct SceneRow: View {
    let scene: SceneSummary
    var sharing = false

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: "cube")
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(Theme.ink)
                .frame(width: 44, height: 44)
                .background(Theme.lime.opacity(0.35), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text(scene.name).font(Theme.heading(17)).foregroundStyle(Theme.ink).lineLimit(1)
                Text(subtitle).font(Theme.body(14)).foregroundStyle(Theme.muted).lineLimit(1)
            }
            Spacer(minLength: 0)
            if sharing { ProgressView().tint(Theme.ink) }
        }
        .padding(.vertical, 4)
    }

    private var subtitle: String {
        let parts = [
            scene.objectCount.map { ModelsFormat.count($0, "object") },
            scene.memberCount.map { ModelsFormat.count($0, "member") },
        ].compactMap { $0 }
        return parts.isEmpty ? "Scene" : parts.joined(separator: " · ")
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
