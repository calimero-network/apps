import MeroKit
import StandupCore
import SwiftUI

/// An open team: Standup, Week, Decisions and Team tabs over one TeamModel.
struct TeamView: View {
    @StateObject private var team: TeamModel
    @StateObject private var board: BoardModel
    @StateObject private var week: WeekModel
    @StateObject private var decisions: DecisionsModel
    let onSwitchTeam: () -> Void
    let onSignOut: () -> Void

    @State private var tab = Tab.standup
    @State private var composing: ComposeDecision?
    @State private var welcomeDismissed: Bool

    enum Tab: Hashable { case standup, week, decisions, team }

    init(team summary: TeamSummary, backend: any MeroAppBackend, onSwitchTeam: @escaping () -> Void, onSignOut: @escaping () -> Void) {
        let team = TeamModel(team: summary, backend: backend)
        _team = StateObject(wrappedValue: team)
        _board = StateObject(wrappedValue: BoardModel(team: team))
        _week = StateObject(wrappedValue: WeekModel(team: team))
        _decisions = StateObject(wrappedValue: DecisionsModel(team: team))
        _welcomeDismissed = State(initialValue: UserDefaults.standard.bool(forKey: Self.welcomeKey(summary.contextId)))
        self.onSwitchTeam = onSwitchTeam
        self.onSignOut = onSignOut
    }

    static func welcomeKey(_ contextId: String) -> String { "welcomed:\(contextId)" }

    var body: some View {
        TabView(selection: $tab) {
            StandupTab(team: team, board: board) { day in
                composing = ComposeDecision(draft: DecisionDraft(fromDay: day))
            }
            .tabItem { Label("Standup", systemImage: "sun.max") }
            .tag(Tab.standup)

            WeekTab(team: team, model: week)
                .tabItem { Label("Week", systemImage: "calendar") }
                .tag(Tab.week)

            DecisionsTab(team: team, model: decisions) { composing = ComposeDecision(draft: $0) }
                .tabItem { Label("Decisions", systemImage: "checkmark.seal") }
                .tag(Tab.decisions)

            TeamTab(team: team, onSwitchTeam: onSwitchTeam, onSignOut: onSignOut)
                .tabItem { Label("Team", systemImage: "person.2") }
                .tag(Tab.team)
        }
        .tint(Palette.ink)
        .task { await team.load() }
        .task { await team.follow() }
        .onChange(of: team.version) { _ in Task { await team.load() } }
        .sheet(
            isPresented: Binding(
                get: { team.needsName && !welcomeDismissed && composing == nil },
                set: { if !$0 { dismissWelcome() } })
        ) {
            WelcomeSheet(team: team, onLater: dismissWelcome)
        }
        .sheet(item: $composing) { request in
            DecisionSheet(model: decisions, draft: request.draft) { _ in
                composing = nil
                tab = .decisions
            }
        }
    }

    private func dismissWelcome() {
        UserDefaults.standard.set(true, forKey: Self.welcomeKey(team.contextId))
        welcomeDismissed = true
    }
}

/// A request to open the decision sheet, from any tab.
struct ComposeDecision: Identifiable {
    let id = UUID()
    let draft: DecisionDraft
}

/// First run in a team: ask for a name, since otherwise teammates see an id.
private struct WelcomeSheet: View {
    @ObservedObject var team: TeamModel
    let onLater: () -> Void
    @State private var name = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Welcome to the team").font(.title2.weight(.bold)).foregroundStyle(Palette.ink)
            Text("What should your teammates call you? It shows on everything you post.")
                .font(.subheadline).foregroundStyle(Palette.ink2)
            TextField("Your name", text: $name)
                .focused($focused)
                .textContentType(.name)
                .submitLabel(.continue)
                .onSubmit(save)
                .padding(12)
                .background(Palette.sunken, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .onChange(of: name) { if $0.count > Limits.name { name = String($0.prefix(Limits.name)) } }
            if let error { ErrorLine(message: error) }
            Spacer()
            Button(action: save) { Text(busy ? "Saving…" : "Continue") }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
            Button("Later", action: onLater).buttonStyle(SecondaryButtonStyle())
        }
        .padding(24)
        .presentationDetents([.medium])
        .interactiveDismissDisabled(busy)
        .onAppear { focused = true }
    }

    private func save() {
        guard !busy, !name.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        busy = true
        Task {
            do {
                try await team.setMyName(name)
                Haptics.success()
            } catch {
                self.error = StandupCore.ErrorText.describe(error)
            }
            busy = false
        }
    }
}
