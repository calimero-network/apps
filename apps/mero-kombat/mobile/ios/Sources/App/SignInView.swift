import MeroKitUI
import SwiftUI

/// Signed out: what the app is, the one button that signs in with a Calimero account, and
/// practice, which needs no account. Two columns: the phone is held sideways.
struct SignInView: View {
    @ObservedObject var session: MeroAppSession
    @ObservedObject var client: MeroClient
    let invited: Bool
    let onPractice: () -> Void

    var body: some View {
        ZStack {
            Theme.ground.ignoresSafeArea()
            ScrollView {
                HStack(alignment: .top, spacing: 32) {
                    VStack(alignment: .leading, spacing: 18) {
                        AppMark(size: 56)
                        Text("Mero Kombat").font(Theme.heading(34)).foregroundStyle(Theme.ink)
                        Text(
                            "A one-on-one fighting game where every punch is a transaction. Two fighters, best of three rounds, no game server."
                        )
                        .font(Theme.body(16)).foregroundStyle(Theme.ink2)
                        VStack(alignment: .leading, spacing: 12) {
                            Point(icon: "server.rack", text: "No game server")
                            Point(icon: "bolt.fill", text: "Every blow is a transaction")
                            Point(icon: "person.crop.circle", text: "Your Calimero account")
                        }
                        .card()
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    VStack(alignment: .leading, spacing: 14) {
                        if invited {
                            HStack(spacing: 12) {
                                Image(systemName: "envelope.open").foregroundStyle(Theme.ink)
                                Text("You've been invited to an arena. Sign in to join it.")
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

                        Button {
                            Haptics.tap()
                            onPractice()
                        } label: {
                            Label("Practice vs CPU", systemImage: "target")
                        }
                        .buttonStyle(SecondaryButtonStyle())

                        Text("The Calimero wallet approves this device. Practice needs no account.")
                            .font(Theme.body(13)).foregroundStyle(Theme.muted)
                    }
                    .frame(maxWidth: 340)
                    .padding(.top, 74)
                }
                .padding(.horizontal, 32)
                .padding(.vertical, 24)
                .frame(maxWidth: 900)
                .frame(maxWidth: .infinity)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
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
