import SwiftUI

@main
struct MeroARApp: App {
    #if DEBUG
    @StateObject private var app = AppState.launch()
    #else
    @StateObject private var app = AppState()
    #endif

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(app)
                .environmentObject(app.client)
                .tint(Theme.accent)
                .preferredColorScheme(.dark)
                .task { await app.restore() }
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var app: AppState

    var body: some View {
        ZStack {
            switch app.phase {
            case .restoring:
                RestoringView().transition(.opacity)
            case .signedOut:
                WelcomeView().transition(.opacity)
            case .lobby:
                LobbyView().transition(.opacity)
            case .inRoom:
                RoomView().transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: app.phase)
    }
}

/// Shown while a stored session reconnects to the cluster.
private struct RestoringView: View {
    var body: some View {
        ZStack {
            ScreenBackground()
            VStack(spacing: 16) {
                BrandMark(size: 56)
                ProgressView().tint(Theme.textDim)
                Text("Reconnecting…")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.textDim)
            }
        }
    }
}
