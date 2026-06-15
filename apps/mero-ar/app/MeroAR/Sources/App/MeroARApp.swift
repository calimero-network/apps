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
                case .inRoom:
                    RoomView()
                        .transition(.opacity.combined(with: .scale(scale: 1.02)))
                }
            }
            .animation(.smooth(duration: 0.5), value: app.phase)
            .preferredColorScheme(.dark)
            .environmentObject(app)
        }
    }
}
