import MeroKitUI
import SwiftUI

/// Signed out: what the game is, and the one button that signs in with a Calimero account. Laid out
/// for landscape: the pitch on the left, signing in on the right.
struct SignInView: View {
    @ObservedObject var session: MeroAppSession
    @ObservedObject var client: MeroClient
    let invited: Bool

    var body: some View {
        ZStack {
            Theme.ground.ignoresSafeArea()
            ScrollView {
                HStack(alignment: .top, spacing: 32) {
                    VStack(alignment: .leading, spacing: 16) {
                        AppMark(size: 60)
                        Text("Merraria").font(Theme.heading(34)).foregroundStyle(Theme.ink)
                        Text(
                            "Mine and build together in a 2D world with no game server. Every dig is shared state between the players' own devices."
                        )
                        .font(Theme.body(16)).foregroundStyle(Theme.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                        VStack(alignment: .leading, spacing: 12) {
                            Point(icon: "server.rack", text: "No game server")
                            Point(icon: "person.2", text: "Play with friends by invitation")
                            Point(icon: "person.crop.circle", text: "Your Calimero account")
                        }
                        .padding(.top, 4)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    VStack(alignment: .leading, spacing: 16) {
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
                    .card(padding: 20)
                    .frame(maxWidth: 380)
                }
                .padding(.horizontal, 32)
                .padding(.vertical, 28)
            }
        }
    }

    private struct Point: View {
        let icon: String
        let text: String

        var body: some View {
            HStack(spacing: 12) {
                Image(systemName: icon).font(.system(size: 16, weight: .medium)).foregroundStyle(Theme.ink)
                    .frame(width: 24)
                Text(text).font(Theme.body(15, .medium)).foregroundStyle(Theme.ink)
            }
        }
    }
}
