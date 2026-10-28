import BattleshipsCore
import LobbyGenerated
import MeroKit
import SwiftUI

/// One lobby: your matches, the players you can challenge, your record, and inviting people in.
struct LobbyScreen: View {
    enum Tab: String, CaseIterable {
        case matches = "Matches"
        case players = "Players"
        case record = "Record"
    }

    @StateObject private var model: LobbyModel
    let lobby: AppNamespace
    let openMatch: (MatchRoute) -> Void
    @State private var tab: Tab = .matches
    @State private var choosing = false
    @State private var inviteLink: String?
    @State private var inviting = false

    init(backend: any BattleshipsBackend, lobby: AppNamespace, openMatch: @escaping (MatchRoute) -> Void) {
        _model = StateObject(wrappedValue: LobbyModel(backend: backend, namespace: lobby))
        self.lobby = lobby
        self.openMatch = openMatch
    }

    var body: some View {
        VStack(spacing: 0) {
            if let notice = model.notice {
                NoticeBanner(text: notice) { model.notice = nil }
            }
            content
        }
        .background(Palette.ground.ignoresSafeArea())
        .appNavigation(model.name)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(action: invite) {
                    if inviting {
                        ProgressView().tint(Palette.ink)
                    } else {
                        Image(systemName: "person.badge.plus").foregroundStyle(Palette.ink)
                    }
                }
                .accessibilityLabel("Invite players")
                .disabled(inviting || model.lobbyContextId == nil)
            }
        }
        .safeAreaInset(edge: .bottom) {
            if case .loaded = model.phase {
                Button {
                    Haptics.tap()
                    choosing = true
                } label: {
                    Label("New match", systemImage: "scope")
                }
                .buttonStyle(PrimaryButtonStyle())
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(Palette.ground.opacity(0.96).ignoresSafeArea())
            }
        }
        .task {
            await model.load()
            await model.live()
        }
        .sheet(isPresented: $choosing) {
            ChallengeSheet(model: model) { ref in
                choosing = false
                openMatch(MatchRoute(ref: ref, me: model.me, lobby: lobby))
            } invite: {
                choosing = false
                invite()
            }
            .presentationDetents([.medium, .large])
        }
        .sheet(item: inviteBinding) { link in
            InviteSheet(link: link.value, lobbyName: model.name)
                .presentationDetents([.medium])
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            VStack(spacing: 12) {
                ProgressView().tint(Palette.ink)
                Text("Opening the lobby…").font(.system(size: 15)).foregroundStyle(Palette.muted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            ScrollView { ErrorState(message: message) { Task { await model.load() } }.padding(.top, 60) }
                .refreshable { await model.load() }
        case .loaded:
            ScrollView {
                VStack(spacing: 16) {
                    Picker("Section", selection: $tab) {
                        ForEach(Tab.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    switch tab {
                    case .matches: matches
                    case .players: players
                    case .record: record
                    }
                }
                .padding(16)
            }
            .refreshable { await model.refresh() }
        }
    }

    // MARK: Matches

    @ViewBuilder
    private var matches: some View {
        if model.myMatches.isEmpty {
            EmptyState(
                symbol: "scope", title: "No matches yet",
                message: model.opponents.isEmpty
                    ? "Invite a friend, then challenge them to a match."
                    : "Challenge someone in this lobby to start one.",
                action: model.opponents.isEmpty ? ("Invite players", invite) : ("New match", { choosing = true }))
        } else {
            VStack(spacing: 10) {
                ForEach(model.myMatches, id: \.matchId) { match in
                    Button {
                        if let ref = model.ref(for: match) {
                            Haptics.tap()
                            openMatch(MatchRoute(ref: ref, me: model.me, lobby: lobby))
                        }
                    } label: {
                        MatchRow(match: match, opponent: model.opponent(in: match), me: model.me)
                    }
                    .disabled(model.ref(for: match) == nil)
                }
            }
        }
    }

    // MARK: Players

    @ViewBuilder
    private var players: some View {
        VStack(spacing: 10) {
            PlayerRow(name: "You", key: model.me, isYou: true, busy: false, challenge: nil)
            ForEach(model.opponents, id: \.player) { entry in
                PlayerRow(
                    name: Names.player(entry.player, me: model.me), key: entry.player, isYou: false,
                    busy: model.challenging == entry.player
                ) {
                    Task {
                        Haptics.tap()
                        if let ref = await model.challenge(entry.player) {
                            Haptics.success()
                            openMatch(MatchRoute(ref: ref, me: model.me, lobby: lobby))
                        } else {
                            Haptics.failure()
                        }
                    }
                }
            }
            if model.opponents.isEmpty {
                EmptyState(
                    symbol: "person.2", title: "Nobody else is here yet",
                    message: "Players show up once they've opened the lobby.", action: ("Invite players", invite))
            }
        }
    }

    // MARK: Record

    @ViewBuilder
    private var record: some View {
        VStack(spacing: 16) {
            HStack(spacing: 10) {
                StatTile(value: model.stats?.wins ?? 0, label: "Wins", highlight: true)
                StatTile(value: model.stats?.losses ?? 0, label: "Losses")
                StatTile(value: model.stats?.gamesPlayed ?? 0, label: "Played")
            }
            SectionLabel(text: "History")
            if model.sortedHistory.isEmpty {
                EmptyState(symbol: "clock", title: "No results yet", message: "Finished matches in this lobby show up here.")
            } else {
                VStack(spacing: 10) {
                    ForEach(model.sortedHistory, id: \.matchId) { result in
                        HistoryRow(result: result, me: model.me)
                    }
                }
            }
        }
    }

    // MARK: Invite

    private var inviteBinding: Binding<Identified?> {
        Binding(get: { inviteLink.map(Identified.init) }, set: { inviteLink = $0?.value })
    }

    private func invite() {
        guard !inviting else { return }
        inviting = true
        Haptics.tap()
        Task {
            do {
                inviteLink = try await model.invitationLink()
            } catch {
                model.notice = ErrorText.describe(error, fallback: "Couldn't create an invitation. Try again.")
            }
            inviting = false
        }
    }
}

struct Identified: Identifiable {
    let value: String
    var id: String { value }
}

private struct MatchRow: View {
    let match: MatchSummary
    let opponent: String
    let me: String

    var body: some View {
        Card(padding: 14) {
            HStack(spacing: 12) {
                SymbolTile(symbol: symbol, tone: tone, size: 44)
                VStack(alignment: .leading, spacing: 3) {
                    Text("vs \(Names.player(opponent, me: me))").font(Typeface.display(17)).foregroundStyle(Palette.ink)
                    Text(Date(timeIntervalSince1970: Double(match.createdMs) / 1000).formatted(date: .abbreviated, time: .shortened))
                        .font(.system(size: 13)).foregroundStyle(Palette.muted)
                }
                Spacer()
                badge
                Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.muted)
            }
        }
    }

    private var won: Bool? {
        guard match.status == .finished, let winner = match.winner else { return nil }
        return winner.lowercased() == me.lowercased()
    }

    private var symbol: String {
        switch won {
        case .some(true): return "trophy"
        case .some(false): return "flag"
        case .none: return match.contextId == nil ? "hourglass" : "scope"
        }
    }

    private var tone: Color {
        switch won {
        case .some(true): return Palette.lime
        case .some(false): return Palette.sunken
        case .none: return Palette.limeSoft
        }
    }

    @ViewBuilder
    private var badge: some View {
        switch won {
        case .some(true): Badge(text: "Won")
        case .some(false): Badge(text: "Lost", tone: .neutral)
        case .none:
            if match.contextId == nil {
                Badge(text: "Setting up", tone: .pending)
            } else if match.status == .finished {
                Badge(text: "Over", tone: .neutral)
            } else {
                Badge(text: "In play", tone: .neutral)
            }
        }
    }
}

private struct PlayerRow: View {
    let name: String
    let key: String
    let isYou: Bool
    let busy: Bool
    let challenge: (() -> Void)?

    var body: some View {
        Card(padding: 14) {
            HStack(spacing: 12) {
                SymbolTile(symbol: isYou ? "person.fill" : "person", tone: isYou ? Palette.lime : Palette.sunken, size: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(name).font(.system(size: 16, weight: .semibold)).foregroundStyle(Palette.ink)
                    Text(Names.short(key)).font(.system(size: 13, design: .monospaced)).foregroundStyle(Palette.muted)
                }
                Spacer()
                if let challenge {
                    Button(action: challenge) {
                        if busy { ProgressView().tint(Palette.ink) } else { Text("Challenge") }
                    }
                    .buttonStyle(PrimaryButtonStyle(compact: true))
                    .disabled(busy)
                }
            }
        }
    }
}

private struct StatTile: View {
    let value: UInt64
    let label: String
    var highlight = false

    var body: some View {
        VStack(spacing: 4) {
            Text("\(value)").font(Typeface.display(28, weight: .bold)).foregroundStyle(Palette.ink)
            Text(label).font(.system(size: 13, weight: .medium)).foregroundStyle(highlight ? Palette.ink : Palette.muted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(highlight ? Palette.limeSoft : Palette.surface))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Palette.hairline, lineWidth: 0.5))
    }
}

private struct HistoryRow: View {
    let result: MatchRecord
    let me: String

    var body: some View {
        Card(padding: 14) {
            HStack(spacing: 12) {
                SymbolTile(symbol: symbol, tone: mine == true ? Palette.lime : Palette.sunken, size: 36)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.ink)
                    Text(Date(timeIntervalSince1970: Double(result.finishedMs) / 1000).formatted(date: .abbreviated, time: .shortened))
                        .font(.system(size: 13)).foregroundStyle(Palette.muted)
                }
                Spacer()
            }
        }
    }

    private var mine: Bool? {
        if result.winner.lowercased() == me.lowercased() { return true }
        if result.loser.lowercased() == me.lowercased() { return false }
        return nil
    }

    private var symbol: String {
        switch mine {
        case .some(true): return "trophy"
        case .some(false): return "flag"
        case .none: return "person.3.fill"
        }
    }

    private var title: String {
        switch mine {
        case .some(true): return "You beat \(Names.player(result.loser, me: me))"
        case .some(false): return "\(Names.player(result.winner, me: me)) beat you"
        case .none: return "\(Names.player(result.winner, me: me)) beat \(Names.player(result.loser, me: me))"
        }
    }
}

/// Pick an opponent for a new match.
private struct ChallengeSheet: View {
    @ObservedObject var model: LobbyModel
    let opened: (MatchRef) -> Void
    let invite: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button("Cancel") { dismiss() }.foregroundStyle(Palette.ink)
                Spacer()
                Text("New match").font(.system(size: 16, weight: .semibold)).foregroundStyle(Palette.ink)
                Spacer()
                Color.clear.frame(width: 52, height: 1)
            }
            .padding(16)
            .overlay(alignment: .bottom) { Rectangle().fill(Palette.hairline).frame(height: 0.5) }
            ScrollView {
                VStack(spacing: 10) {
                    if model.opponents.isEmpty {
                        EmptyState(
                            symbol: "person.2", title: "Nobody to challenge yet",
                            message: "Invite a friend. They show up here once they've opened the lobby.",
                            action: ("Invite players", invite))
                    } else {
                        SectionLabel(text: "Challenge")
                        ForEach(model.opponents, id: \.player) { entry in
                            PlayerRow(
                                name: Names.player(entry.player, me: model.me), key: entry.player, isYou: false,
                                busy: model.challenging == entry.player
                            ) {
                                Task {
                                    Haptics.tap()
                                    if let ref = await model.challenge(entry.player) {
                                        Haptics.success()
                                        opened(ref)
                                    } else {
                                        Haptics.failure()
                                    }
                                }
                            }
                        }
                        if let notice = model.notice {
                            Text(notice).font(.system(size: 14)).foregroundStyle(Palette.danger)
                        }
                    }
                }
                .padding(16)
            }
        }
        .background(Palette.ground)
        .disabled(model.challenging != nil)
    }
}

/// The invitation link, to share or copy.
private struct InviteSheet: View {
    let link: String
    let lobbyName: String
    @State private var copied = false

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "person.badge.plus")
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(Palette.ink)
                .frame(width: 60, height: 60)
                .background(Circle().fill(Palette.limeSoft))
            Text("Invite to “\(lobbyName)”").font(Typeface.display(22)).foregroundStyle(Palette.ink)
                .multilineTextAlignment(.center)
            Text("Anyone with this link can join the lobby and challenge you. It works on the web app too, and expires in a day.")
                .font(.system(size: 15)).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
            Spacer(minLength: 0)
            ShareLink(item: link, subject: Text("Join \(lobbyName) on Battleships")) {
                Label("Share link", systemImage: "square.and.arrow.up")
            }
            .buttonStyle(PrimaryButtonStyle())
            Button {
                UIPasteboard.general.string = link
                copied = true
                Haptics.success()
            } label: {
                Label(copied ? "Copied" : "Copy link", systemImage: copied ? "checkmark" : "doc.on.doc")
            }
            .buttonStyle(SecondaryButtonStyle())
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Palette.surface)
    }
}
