import PixartCore
import MeroKit
import MeroKitUI
import SwiftUI

/// The teams this account is in.
struct TeamsScreen: View {
    @ObservedObject var session: MeroAppSession
    @StateObject private var model: TeamsModel
    @StateObject private var approvals: ApprovalsModel
    @State private var showAccount = false

    init(session: MeroAppSession, backend: any MeroAppBackend) {
        self.session = session
        _model = StateObject(wrappedValue: TeamsModel(backend: backend))
        _approvals = StateObject(wrappedValue: ApprovalsModel(session: session))
    }

    var body: some View {
        List {
            ApprovalsSection(model: approvals)
            switch model.state {
            case .idle:
                LoadingRows().listRowInsets(EdgeInsets()).plainRow()
            case .loading where model.teams.isEmpty:
                LoadingRows().listRowInsets(EdgeInsets()).plainRow()
            case .failed(let message) where model.teams.isEmpty:
                ErrorBanner(message: message) { Task { await model.load() } }.plainRow()
            default:
                if model.teams.isEmpty {
                    EmptyState(
                        icon: "person.3",
                        title: "No teams yet",
                        message: "Create a team in Mero PixArt on the web, or open an invitation link on this phone. It shows up here.")
                    .plainRow()
                } else {
                    Section {
                        ForEach(model.teams) { team in
                            NavigationLink(value: Router.Route.team(id: team.id, name: team.name)) {
                                TeamRow(team: team)
                            }
                            .cardRow()
                        }
                    } header: {
                        SectionLabel("Teams")
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Theme.ground)
        .navigationTitle("Mero PixArt")
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
        .refreshable { await loadAll() }
        .task { await loadAll() }
        .sheet(isPresented: $showAccount) {
            AccountSheet(session: session)
                .presentationDetents([.medium])
        }
    }
}

extension TeamsScreen {
    /// The list, then what waits for approval in the account and in each organization shown.
    fileprivate func loadAll() async {
        await model.load()
        await approvals.refresh(orgs: model.teams.map(\.id))
    }
}

private struct TeamRow: View {
    let team: Team

    var body: some View {
        HStack(spacing: 14) {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Theme.memberColor(team.id).opacity(0.14))
                .frame(width: 44, height: 44)
                .overlay(
                    Text(PixartFormat.initials(team.name))
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Theme.memberColor(team.id)))
            VStack(alignment: .leading, spacing: 3) {
                Text(team.name).font(Theme.heading(17)).foregroundStyle(Theme.ink).lineLimit(1)
                Text(team.memberCount == 1 ? "1 member" : "\(team.memberCount) members")
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
            .confirmationDialog("Sign out of Mero PixArt?", isPresented: $confirm, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) {
                    dismiss()
                    Task { await session.signOut() }
                }
            }
        }
    }
}

/// A team's projects, as a gallery of thumbnails.
struct ProjectsScreen: View {
    let teamName: String
    @StateObject private var model: ProjectsModel
    @State private var invite: ShareItem?
    @State private var inviting = false
    @State private var inviteError: String?

    init(backend: any MeroAppBackend, teamId: String, teamName: String, blobs: BlobStore) {
        self.teamName = teamName
        _model = StateObject(wrappedValue: ProjectsModel(backend: backend, teamId: teamId, blobs: blobs))
    }

    private let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

    var body: some View {
        ScrollView {
            switch model.state {
            case .idle:
                LoadingRows()
            case .loading where model.projects.isEmpty:
                LoadingRows()
            case .failed(let message) where model.projects.isEmpty:
                ErrorBanner(message: message) { Task { await model.load() } }
            default:
                if model.projects.isEmpty {
                    EmptyState(
                        icon: "photo.on.rectangle.angled",
                        title: "No projects in this team",
                        message: "Projects are created in Mero PixArt on the web or desktop. Pull to refresh once one exists.")
                } else {
                    VStack(alignment: .leading, spacing: 10) {
                        SectionLabel(PixartFormat.count(model.projects.count, "project", "projects"))
                        LazyVGrid(columns: columns, spacing: 12) {
                            ForEach(model.projects) { project in
                                NavigationLink(
                                    value: Router.Route.project(teamId: model.teamId, contextId: project.contextId, name: project.name)
                                ) {
                                    ProjectCard(project: project, thumbnail: model.thumbnails[project.contextId])
                                }
                                .buttonStyle(.plain)
                                .contextMenu {
                                    ShareLink(item: URL(string: PixartFormat.projectLink(teamId: model.teamId, contextId: project.contextId))!) {
                                        Label("Share project link", systemImage: "link")
                                    }
                                }
                                .task(id: project.width) { await model.loadThumbnail(project.contextId) }
                            }
                        }
                    }
                    .padding(16)
                }
            }
        }
        .background(Theme.ground)
        .navigationTitle(teamName)
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    Task { await makeInvite() }
                } label: {
                    if inviting { ProgressView().tint(Theme.ink) } else { Image(systemName: "person.badge.plus") }
                }
                .disabled(inviting)
                .accessibilityLabel("Invite to team")
            }
        }
        .refreshable { await model.load() }
        .task { await model.load() }
        .sheet(item: $invite) { item in ShareSheet(items: item.items).ignoresSafeArea() }
        .alert("Couldn't create an invitation", isPresented: Binding(get: { inviteError != nil }, set: { if !$0 { inviteError = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(inviteError ?? "")
        }
    }

    private func makeInvite() async {
        Haptics.tap()
        inviting = true
        defer { inviting = false }
        do {
            let link = try await model.inviteLink(teamName: teamName)
            invite = ShareItem(items: ["Join \(teamName) on Mero PixArt", URL(string: link) ?? link])
        } catch {
            Haptics.error()
            inviteError = PixartFormat.errorText(error)
        }
    }
}

/// A project in the gallery: its thumbnail over a checkerboard, name and size.
private struct ProjectCard: View {
    let project: ProjectSummary
    let thumbnail: Bitmap?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack {
                Checkerboard()
                if let thumbnail {
                    Image(decorative: thumbnail.image, scale: 1)
                        .resizable()
                        .interpolation(.high)
                        .aspectRatio(contentMode: .fit)
                        .transition(.opacity)
                } else {
                    Image(systemName: "photo")
                        .font(.system(size: 22))
                        .foregroundStyle(Theme.faint)
                }
            }
            .frame(maxWidth: .infinity)
            .aspectRatio(4 / 3, contentMode: .fit)
            .clipped()
            .animation(.easeOut(duration: 0.2), value: thumbnail != nil)
            VStack(alignment: .leading, spacing: 2) {
                Text(project.name).font(Theme.heading(15)).foregroundStyle(Theme.ink).lineLimit(1)
                Text(subtitle).font(Theme.body(12)).foregroundStyle(Theme.muted).lineLimit(1)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
        }
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).stroke(Theme.line, lineWidth: Theme.hairline))
        .accessibilityElement(children: .combine)
    }

    private var subtitle: String {
        var parts: [String] = []
        if let w = project.width, let h = project.height { parts.append(PixartFormat.size(w, h)) }
        if let n = project.layerCount { parts.append(PixartFormat.count(n, "layer", "layers")) }
        return parts.isEmpty ? "Project" : parts.joined(separator: " · ")
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
