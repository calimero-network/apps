import SwiftUI

@main
struct MeroARApp: App {
    @StateObject private var app = AppState()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(app)
                .environmentObject(app.client)
                .tint(Theme.ink)
                // The wallet returns to `meroar://enrol`. The auth sheet normally
                // captures it; this catches a callback the system delivers to the
                // app directly instead.
                .onOpenURL { url in Task { await app.handle(url: url) } }
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

/// Shown while a stored Cloud session reconnects to its relay.
private struct RestoringView: View {
    var body: some View {
        ZStack {
            ScreenBackground()
            VStack(spacing: 16) {
                BrandMark(size: 56)
                ProgressView().tint(Theme.textFaint)
                Text("Reconnecting to your relay…")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textFaint)
            }
        }
    }
}
