import DesignCore
import MeroKitUI
import SwiftUI

/// Sign in with a Calimero account: the wallet certifies this phone's key.
struct SignInView: View {
    @ObservedObject var session: MeroAppSession
    @ObservedObject var client: MeroClient

    var body: some View {
        ZStack {
            Theme.ground.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 0) {
                Spacer()
                AppMark(size: 64)
                Text("Mero Design")
                    .font(Theme.heading(34))
                    .foregroundStyle(Theme.ink)
                    .padding(.top, 24)
                Text("Your team's boards, on your phone. View designs, present screens and leave comments.")
                    .font(Theme.body(17))
                    .foregroundStyle(Theme.muted)
                    .padding(.top, 10)
                VStack(alignment: .leading, spacing: 14) {
                    Feature(icon: "hand.draw", text: "Pan and pinch around any board")
                    Feature(icon: "play.rectangle", text: "Present screens full screen")
                    Feature(icon: "bubble.left", text: "Read and add comments")
                }
                .padding(.top, 28)
                Spacer()
                if let error = client.errorMessage {
                    Text(error)
                        .font(Theme.body(14))
                        .foregroundStyle(Theme.danger)
                        .padding(.bottom, 12)
                        .accessibilityIdentifier("signInError")
                }
                Button {
                    Haptics.tap()
                    Task { await session.signIn() }
                } label: {
                    HStack(spacing: 10) {
                        if client.isLoading { ProgressView().tint(Theme.ink) }
                        Text(client.isLoading ? "Waiting for the wallet…" : "Sign in with Calimero")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(client.isLoading)
                .accessibilityIdentifier("signInButton")
                Text("Your boards stay on your team's nodes. This phone holds no node; it signs in through your account's relay.")
                    .font(Theme.body(12))
                    .foregroundStyle(Theme.faint)
                    .padding(.top, 14)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 16)
        }
    }
}

private struct Feature: View {
    let icon: String
    let text: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(Theme.ink)
                .frame(width: 36, height: 36)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Theme.line, lineWidth: Theme.hairline))
            Text(text).font(Theme.body(15)).foregroundStyle(Theme.ink2)
        }
    }
}
