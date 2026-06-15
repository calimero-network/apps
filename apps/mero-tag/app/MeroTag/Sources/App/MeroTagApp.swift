import SwiftUI

@main
struct MeroTagApp: App {
    @StateObject private var app = AppState()

    var body: some Scene {
        WindowGroup {
            ZStack {
                switch app.phase {
                case .loggedOut:
                    WelcomeView()
                        .transition(.opacity)
                case .ready:
                    RootTabView()
                        .transition(.opacity.combined(with: .scale(scale: 1.02)))
                }
            }
            .animation(.smooth(duration: 0.5), value: app.phase)
            .preferredColorScheme(.dark)
            .environmentObject(app)
        }
    }
}

/// Main navigation once a session is active.
struct RootTabView: View {
    @EnvironmentObject private var app: AppState

    var body: some View {
        TabView {
            HomeView()
                .tabItem { Label("Trackers", systemImage: "dot.radiowaves.left.and.right") }
            LiveMapView()
                .tabItem { Label("Map", systemImage: "map") }
        }
        .tint(Theme.accent)
    }
}
