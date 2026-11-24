import SwiftUI

@main
struct MeroTagApp: App {
    @StateObject private var app = AppState()

    var body: some Scene {
        WindowGroup {
            AppRoot()
                .environmentObject(app)
        }
    }
}

/// Routes between sign-in, space selection and the main tabs.
struct AppRoot: View {
    @EnvironmentObject private var app: AppState

    var body: some View {
        ZStack {
            Tag.bg.ignoresSafeArea()
            switch app.phase {
            case .launching:
                LaunchView()
            case .signedOut:
                SignInView().transition(.opacity)
            case .choosingSpace:
                SpaceSetupView().transition(.opacity)
            case .ready:
                if let store = app.store {
                    RootTabView(store: store).transition(.opacity)
                }
            }
        }
        .animation(.spring(response: 0.45, dampingFraction: 0.9), value: app.phase)
        .tint(Tag.accentInk)
        .task { await app.restore() }
        .onOpenURL { url in
            Task { await app.handleOpenURL(url) }
        }
    }
}

private struct LaunchView: View {
    var body: some View {
        ZStack {
            HeroBackground()
            RadarMark().frame(width: 220, height: 220)
        }
        .accessibilityLabel("Loading")
    }
}

/// Main navigation once a space is open.
struct RootTabView: View {
    @ObservedObject var store: TrackerStore
    @StateObject private var sharing = LocationSharing()

    var body: some View {
        TabView {
            LiveMapView(store: store)
                .tabItem { Label("Map", systemImage: "map.fill") }
            HomeView(store: store)
                .tabItem { Label("People", systemImage: "person.2.fill") }
            SpaceView(store: store)
                .tabItem { Label("Space", systemImage: "circle.hexagongrid.fill") }
        }
        .tint(Tag.accent)
        .environmentObject(sharing)
        .onAppear { sharing.attach(store) }
    }
}
