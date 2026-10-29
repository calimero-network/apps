import MeroKitUI
import SwiftUI

/// Signed out: what the app is, and the one button that signs in with a Calimero account.
struct SignInView: View {
    @ObservedObject var session: MeroAppSession
    @ObservedObject var client: MeroClient
    let invited: Bool

    var body: some View {
        ZStack {
            Theme.ground.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    AppMark(size: 64).padding(.top, 48)
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Mero Blocks").font(Theme.heading(34)).foregroundStyle(Theme.ink)
                        Text(
                            "Build together in real time. The world is a Calimero context: every block you place is shared state, with no game server anywhere."
                        )
                        .font(Theme.body(16)).foregroundStyle(Theme.ink2)
                    }
                    VStack(alignment: .leading, spacing: 14) {
                        Point(icon: "server.rack", text: "No game server")
                        Point(icon: "person.2", text: "Play with friends from a link")
                        Point(icon: "person.crop.circle", text: "Your Calimero account")
                    }
                    .card()

                    if invited {
                        HStack(spacing: 12) {
                            Image(systemName: "envelope.open").foregroundStyle(Theme.ink)
                            Text("You've been invited to a world. Sign in to join it.")
                                .font(Theme.body(14)).foregroundStyle(Theme.ink)
                        }
                        .padding(14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.limeSoft))
                    }

                    if let message = client.errorMessage {
                        ErrorBanner(message: message) {}
                    }

                    Button {
                        Haptics.tap()
                        Task { await session.signIn() }
                    } label: {
                        HStack(spacing: 10) {
                            if client.isLoading { ProgressView().tint(Theme.ink) }
                            Text(client.isLoading ? "Signing in…" : "Sign in with Calimero")
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(client.isLoading)

                    Text("The Calimero wallet approves this device. Nothing runs on the phone but the app.")
                        .font(Theme.body(13)).foregroundStyle(Theme.muted)
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 32)
            }
        }
    }

    private struct Point: View {
        let icon: String
        let text: String

        var body: some View {
            HStack(spacing: 12) {
                Image(systemName: icon).font(.system(size: 17, weight: .medium)).foregroundStyle(Theme.ink)
                    .frame(width: 24)
                Text(text).font(Theme.body(15, .medium)).foregroundStyle(Theme.ink)
            }
        }
    }
}
