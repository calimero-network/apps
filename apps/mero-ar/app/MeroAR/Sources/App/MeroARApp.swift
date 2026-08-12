import SwiftUI

@main
struct MeroARApp: App {
    @StateObject private var app = AppState()

    var body: some Scene {
        WindowGroup {
            ZStack {
                switch app.phase {
                case .loggedOut:
                    WelcomeView()
                        .transition(.opacity)
                case .connecting:
                    ReconnectingView()
                        .transition(.opacity)
                case .inRoom:
                    RoomView()
                        .transition(.opacity.combined(with: .scale(scale: 1.02)))
                }
            }
            .animation(.smooth(duration: 0.5), value: app.phase)
            .preferredColorScheme(.dark)
            .environmentObject(app)
            .task {
                // Tokens are in the Keychain — walk straight back into the last
                // room instead of asking for the password again. The SDK refreshes
                // a stale access token on the first 401.
                if app.canResume { await app.resume() }
            }
        }
    }
}

/// Shown while a stored session is being restored.
private struct ReconnectingView: View {
    var body: some View {
        ZStack {
            AnimatedBackground()
            VStack(spacing: 18) {
                BrandMark(size: 84)
                ProgressView()
                    .tint(.white)
                Text("Reconnecting…")
                    .font(.callout)
                    .foregroundStyle(.white.opacity(0.7))
            }
        }
    }
}
