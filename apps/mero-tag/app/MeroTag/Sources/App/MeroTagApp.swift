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
            Cal.bg.ignoresSafeArea()
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
        .animation(.easeInOut(duration: 0.25), value: app.phase)
        .tint(Cal.accentInk)
        .task { await app.restore() }
        .onOpenURL { url in
            Task { await app.handleOpenURL(url) }
        }
    }
}

private struct LaunchView: View {
    var body: some View {
        VStack(spacing: 16) {
            BrandMark(size: 44)
            ProgressView().controlSize(.small).tint(Cal.textFaint)
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
            HomeView(store: store)
                .tabItem { Label("Trackers", systemImage: "dot.radiowaves.left.and.right") }
            LiveMapView(store: store)
                .tabItem { Label("Map", systemImage: "map") }
            SpaceView(store: store)
                .tabItem { Label("Space", systemImage: "person.2") }
        }
        .environmentObject(sharing)
        .onAppear { sharing.attach(store) }
    }
}
