import CalendarCore
import MeroKit
import MeroKitUI
import SwiftUI

@main
struct MeroCalendarApp: App {
    @StateObject private var session = MeroAppSession(
        packageName: CalendarConstants.packageName, callback: AppConfig.callback, config: AppConfig.providerConfig,
        walletURL: AppConfig.walletURL, keychainService: AppConfig.keychainService)

    var body: some Scene {
        WindowGroup {
            RootView(session: session, client: session.client)
                .preferredColorScheme(.light)
                .tint(Theme.ink)
                .onOpenURL { url in Task { await session.handle(url) } }
        }
    }
}

/// Things kept on this device: private events and the names given to things.
enum DeviceStores {
    static let keyValue: KeyValueStore = DefaultsStore()
    static let privateEvents = PrivateEventStore(store: keyValue)
    static let names = NameBook(store: keyValue)
}

/// Restoring → spinner; signed out → sign in; signed in → teams.
struct RootView: View {
    @ObservedObject var session: MeroAppSession
    @ObservedObject var client: MeroClient
    @State private var didRestore = false

    var body: some View {
        Group {
            if let demo = DemoMode.backend {
                // Debug, `-MeroDemo YES`: the demo account, no sign-in.
                SignedInView(session: session, backend: demo)
            } else if !didRestore || session.isRestoring {
                StatusScreen(text: "Restoring your session…")
            } else if session.isSignedIn, let backend = session.backend {
                SignedInView(session: session, backend: backend)
                    .id(session.revision)
            } else if session.isSignedIn {
                StatusScreen(text: "Connecting to your relay…") {
                    Button("Sign out") { Task { await session.signOut() } }
                        .buttonStyle(SecondaryButtonStyle(fullWidth: false))
                }
            } else {
                SignInView(session: session, client: client)
            }
        }
        .task {
            guard !didRestore, !DemoMode.isOn else { return }
            await session.restore()
            didRestore = true
        }
    }
}

struct StatusScreen<Actions: View>: View {
    let text: String
    @ViewBuilder var actions: () -> Actions

    init(text: String, @ViewBuilder actions: @escaping () -> Actions = { EmptyView() }) {
        self.text = text
        self.actions = actions
    }

    var body: some View {
        ZStack {
            Theme.ground.ignoresSafeArea()
            VStack(spacing: 16) {
                AppMark(size: 56)
                ProgressView().tint(Theme.ink)
                Text(text).font(Theme.body(14)).foregroundStyle(Theme.muted)
                actions()
            }
        }
    }
}

/// Where the app goes after the teams list.
enum Route: Hashable {
    case team(Team)
    case calendar(Team, TeamCalendar)
}

/// The signed-in app: a navigation stack from the teams list, and the
/// "Join …?" prompt for an invitation link that opened the app.
struct SignedInView: View {
    @ObservedObject var session: MeroAppSession
    let backend: any MeroAppBackend
    @StateObject private var teams: TeamsModel
    @State private var path: [Route] = []
    @State private var joining = false
    @State private var joinError: String?

    init(session: MeroAppSession, backend: any MeroAppBackend) {
        self.session = session
        self.backend = backend
        _teams = StateObject(
            wrappedValue: TeamsModel(
                backend: backend, names: DeviceStores.names,
                didJoin: { [weak session] in await session?.didJoinNamespace() }))
    }

    var body: some View {
        NavigationStack(path: $path) {
            TeamsView(session: session, model: teams, path: $path)
                .navigationDestination(for: Route.self) { route in
                    switch route {
                    case .team(let team):
                        CalendarsView(
                            model: CalendarsModel(
                                backend: backend, team: team, names: DeviceStores.names,
                                justJoined: teams.justJoined.contains(team.id)),
                            teams: teams, path: $path)
                    case .calendar(let team, let calendar):
                        CalendarScreen(
                            model: CalendarModel(
                                backend: backend, team: team, calendar: calendar, names: DeviceStores.names,
                                privateStore: DeviceStores.privateEvents))
                    }
                }
        }
        .alert(
            joinPromptTitle, isPresented: Binding(get: { session.pendingInvitation != nil && !joining }, set: { _ in }),
            actions: {
                Button("Join") { Task { await joinPending() } }
                Button("Not now", role: .cancel) { session.dismissPendingInvitation() }
            },
            message: { Text("You were invited to a team on Mero Calendar.") }
        )
        .alert(
            "Couldn't join", isPresented: Binding(get: { joinError != nil }, set: { if !$0 { joinError = nil } }),
            actions: { Button("OK", role: .cancel) {} }, message: { Text(joinError ?? "") })
        .overlay {
            if joining {
                ZStack {
                    Color.black.opacity(0.15).ignoresSafeArea()
                    VStack(spacing: 12) {
                        ProgressView().tint(Theme.ink)
                        Text("Joining…").font(Theme.body(14, .semibold))
                    }
                    .card(padding: 24)
                }
            }
        }
    }

    private var joinPromptTitle: String {
        let name = session.pendingInvitation.flatMap(TeamsModel.teamName(inLink:))
        return name.map { "Join \($0)?" } ?? "Join this team?"
    }

    private func joinPending() async {
        guard let link = session.pendingInvitation else { return }
        joining = true
        defer { joining = false }
        session.dismissPendingInvitation()
        do {
            let id = try await teams.join(link: link)
            Theme.success()
            if let team = teams.teams.first(where: { $0.id == id }) { path = [.team(team)] }
        } catch {
            joinError = ErrorText.describe(error, doing: "join the team")
        }
    }
}
