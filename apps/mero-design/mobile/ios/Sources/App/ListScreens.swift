import DesignCore
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
        _approvals = StateObject(
            wrappedValue: ApprovalsModel(
                packageName: DesignFormat.packageName, appName: "Mero Design",
                fetch: { [weak session] org in
                    guard let session else { throw CancellationError() }
                    return try await session.pendingApprovals(org: org)
                },
                consent: { [weak session] request in
                    guard let session else { return nil }
                    return await session.client.requestConsent(request, callback: session.callback)
                }))
    }

    private var orgs: [String] { model.teams.map(\.id) }

    var body: some View {
        List {
            if !approvals.items.isEmpty || approvals.error != nil {
                ApprovalsCard(model: approvals, orgs: orgs).plainRow()
            }
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
                        message: "Create a team in Mero Design on the web, or open an invitation link someone sent you. It shows up here.")
                    .plainRow()
                } else {
                    Section {
                        ForEach(Array(model.teams.enumerated()), id: \.element.id) { index, team in
                            NavigationLink(value: Router.Route.team(id: team.id, name: team.name)) {
                                TeamRow(team: team)
                            }
                            .cardRow()
                            .accessibilityIdentifier("teams.card.\(index)")
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
        .navigationTitle("Mero Design")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    showAccount = true
                } label: {
                    Image(systemName: "person.crop.circle")
                }
                .accessibilityLabel("Account")
                .accessibilityIdentifier("teams.account")
            }
        }
        .refreshable {
            await model.load()
            await approvals.load(orgs: orgs)
        }
        .task {
            await model.load()
            if DemoMode.backend == nil { await approvals.load(orgs: orgs) }
        }
        .sheet(isPresented: $showAccount) {
            AccountSheet(session: session)
                .presentationDetents([.medium])
        }
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
                    Text(DesignFormat.initials(team.name))
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
    private var account: String? { DemoMode.backend?.account ?? session.account }
    private var isConnected: Bool { DemoMode.backend?.hasRelay ?? session.hasRelay }
    private var nodeURL: String { DemoMode.isOn ? "Demo" : session.client.nodeURL ?? "—" }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 12) {
                    Avatar(id: account ?? "", name: "Me", size: 44)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Signed in").font(Theme.heading(17)).foregroundStyle(Theme.ink)
                        Text(isConnected ? "Connected to your Calimero cluster" : "Not connected to a cluster")
                            .font(Theme.body(14))
                            .foregroundStyle(Theme.muted)
                    }
                }
                .card()
                DetailsDisclosure(rows: [
                    ("Account", account ?? "—"),
                    ("Node", nodeURL),
                    ("Package", DemoMode.applicationId ?? session.applicationId ?? "—"),
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
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { dismiss() }.accessibilityIdentifier("sheet.done")
                }
            }
            .confirmationDialog("Sign out of Mero Design?", isPresented: $confirm, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) {
                    dismiss()
                    Task { await session.signOut() }
                }
            }
        }
    }
}

/// A team's boards.
struct BoardsScreen: View {
    let teamName: String
    @StateObject private var model: BoardsModel

    init(backend: any MeroAppBackend, teamId: String, teamName: String) {
        self.teamName = teamName
        _model = StateObject(wrappedValue: BoardsModel(backend: backend, teamId: teamId))
    }

    var body: some View {
        List {
            switch model.state {
            case .idle:
                LoadingRows().listRowInsets(EdgeInsets()).plainRow()
            case .loading where model.boards.isEmpty:
                LoadingRows().listRowInsets(EdgeInsets()).plainRow()
            case .failed(let message) where model.boards.isEmpty:
                ErrorBanner(message: message) { Task { await model.load() } }.plainRow()
            default:
                if model.boards.isEmpty {
                    EmptyState(
                        icon: "square.on.square",
                        title: "No boards in this team",
                        message: "Boards are created in Mero Design on the web or desktop. Pull to refresh once one exists.")
                    .plainRow()
                } else {
                    Section {
                        ForEach(Array(model.boards.enumerated()), id: \.element.id) { index, board in
                            NavigationLink(
                                value: Router.Route.board(teamId: model.teamId, contextId: board.contextId, name: board.name)
                            ) {
                                BoardRow(board: board)
                            }
                            .cardRow()
                            .accessibilityIdentifier("boards.card.\(index)")
                            .swipeActions(edge: .trailing) {
                                ShareLink(item: URL(string: DesignFormat.boardLink(teamId: model.teamId, contextId: board.contextId))!) {
                                    Label("Share", systemImage: "square.and.arrow.up")
                                }
                                .tint(Theme.ink)
                            }
                        }
                    } header: {
                        SectionLabel(model.boards.count == 1 ? "1 board" : "\(model.boards.count) boards")
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Theme.ground)
        .navigationTitle(teamName)
        .navigationBarTitleDisplayMode(.large)
        .refreshable { await model.load() }
        .task { await model.load() }
    }
}

private struct BoardRow: View {
    let board: BoardSummary

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: "rectangle.on.rectangle.angled")
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(Theme.ink)
                .frame(width: 44, height: 44)
                .background(Theme.lime.opacity(0.35), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text(board.name).font(Theme.heading(17)).foregroundStyle(Theme.ink).lineLimit(1)
                Text(subtitle).font(Theme.body(14)).foregroundStyle(Theme.muted).lineLimit(2)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
    }

    private var subtitle: String {
        let count = board.elementCount.map { $0 == 1 ? "1 layer" : "\($0) layers" }
        let parts = [board.description.isEmpty ? nil : board.description, count].compactMap { $0 }
        return parts.isEmpty ? "Board" : parts.joined(separator: " · ")
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
