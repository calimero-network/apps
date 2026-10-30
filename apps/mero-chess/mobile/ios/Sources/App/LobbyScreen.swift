import ChessCore
import MeroKit
import SwiftUI

/// The tables: every table in every club this account is in, newest club first.
struct LobbyScreen: View {
    let account: String
    let onOpen: (TableRef) -> Void
    let onJoin: (ChessInvitation) -> Void
    let onSignOut: () -> Void
    @ObservedObject var approvals: ApprovalsModel
    @StateObject private var model: LobbyModel
    @State private var creating = false
    @State private var pasting = false
    @State private var showingAccount = false
    @State private var share: SharedLink?
    @State private var actionError: String?

    init(
        backend: any MeroAppBackend, applicationId: String?, account: String, approvals: ApprovalsModel,
        onOpen: @escaping (TableRef) -> Void,
        onJoin: @escaping (ChessInvitation) -> Void, onSignOut: @escaping () -> Void
    ) {
        self.account = account
        self.onOpen = onOpen
        self.onJoin = onJoin
        self.onSignOut = onSignOut
        self.approvals = approvals
        _model = StateObject(wrappedValue: LobbyModel(backend: backend, applicationId: applicationId))
    }

    var body: some View {
        List {
            if let message = model.error ?? actionError {
                ErrorBanner(message: message) {
                    model.dismissError()
                    actionError = nil
                }
                .plainRow()
            }
            ApprovalsCard(model: approvals, orgs: model.clubs.map(\.id)).plainRow()
            if !model.loaded {
                HStack { Spacer(); ProgressView().tint(Theme.ink); Spacer() }
                    .padding(.vertical, 48)
                    .plainRow()
            } else if !model.hasRelay {
                EmptyState(
                    piece: "wN", title: "Join your first table",
                    text: "You're not connected to your cluster. Sign in again, or open an invitation link someone sent you.",
                    action: "Join with a link"
                ) { pasting = true }
                .plainRow()
            } else if model.tables.isEmpty {
                EmptyState(
                    piece: "wN", title: "No tables yet",
                    text: "Start one with New table, or join one with an invitation link.", action: "New table"
                ) { creating = true }
                .plainRow()
            } else {
                ForEach(model.tables) { entry in
                    Button {
                        Haptics.tap()
                        onOpen(entry.ref)
                    } label: {
                        TableRow(entry: entry)
                    }
                    .buttonStyle(.plain)
                    .plainRow()
                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                        Button {
                            invite(entry.ref)
                        } label: {
                            Label("Invite", systemImage: "square.and.arrow.up")
                        }
                        .tint(Theme.ink)
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Theme.ground.ignoresSafeArea())
        .navigationTitle("Tables")
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                Button { showingAccount = true } label: { Image(systemName: "person.crop.circle") }
                    .accessibilityLabel("Account")
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button { creating = true } label: { Label("New table", systemImage: "plus") }
                        .disabled(!model.hasRelay)
                    Button { pasting = true } label: { Label("Join with a link", systemImage: "link") }
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("New table")
            }
        }
        .refreshable {
            await model.load()
            await approvals.load(orgs: model.clubs.map(\.id))
        }
        .task {
            await model.load()
            await approvals.load(orgs: model.clubs.map(\.id))
        }
        .sheet(isPresented: $creating) {
            NewTableSheet(clubs: model.clubs) { title, clubId in
                let ref = try await model.create(title: title, clubId: clubId)
                onOpen(ref)
            }
        }
        .sheet(isPresented: $pasting) {
            PasteLinkSheet { invitation in
                pasting = false
                onJoin(invitation)
            }
        }
        .sheet(isPresented: $showingAccount) {
            AccountSheet(account: account, onSignOut: onSignOut)
        }
        .sheet(item: $share) { link in ShareSheet(items: [link.url]) }
    }

    private func invite(_ ref: TableRef) {
        Task {
            do {
                share = SharedLink(url: try await model.inviteLink(ref))
            } catch {
                actionError = ChessText.error(error)
            }
        }
    }
}

/// One table in the list.
private struct TableRow: View {
    let entry: TableEntry

    var body: some View {
        HStack(spacing: 14) {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(entry.summary?.myTurn == true ? Theme.lime : Theme.sunken)
                .frame(width: 48, height: 48)
                .overlay(PieceImage(assetName: entry.summary?.finished == true ? "wK" : "bN").padding(8))
            VStack(alignment: .leading, spacing: 3) {
                Text(entry.summary?.title ?? "Table").font(Theme.heading(16)).foregroundStyle(Theme.ink)
                    .lineLimit(1)
                Text(entry.summary?.players ?? (entry.clubName ?? "Syncing…"))
                    .font(Theme.body(13)).foregroundStyle(Theme.muted).lineLimit(1)
            }
            Spacer(minLength: 8)
            if let state = entry.summary?.state {
                Text(state)
                    .font(Theme.body(12, .semibold))
                    .foregroundStyle(Theme.ink)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Capsule().fill(entry.summary?.myTurn == true ? Theme.lime : Theme.sunken))
            }
            Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted)
        }
        .card(padding: 14)
        .contentShape(Rectangle())
    }
}

struct EmptyState: View {
    let piece: String
    let title: String
    let text: String
    let action: String
    let onAction: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            PieceImage(assetName: piece).frame(width: 72, height: 72)
            Text(title).font(Theme.heading(20)).foregroundStyle(Theme.ink)
            Text(text).font(Theme.body(15)).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
            Button(action: onAction) { Text(action) }
                .buttonStyle(PrimaryButtonStyle(fullWidth: false))
                .padding(.top, 4)
        }
        .padding(.vertical, 40)
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity)
    }
}

extension View {
    /// A list row that draws its own card: no separator, no inset background.
    func plainRow() -> some View {
        listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
    }
}

struct SharedLink: Identifiable {
    let url: String
    var id: String { url }
}
