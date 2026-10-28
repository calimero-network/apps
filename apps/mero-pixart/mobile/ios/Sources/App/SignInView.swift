import PixartCore
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
                Text("Mero PixArt")
                    .font(Theme.heading(34))
                    .foregroundStyle(Theme.ink)
                    .padding(.top, 24)
                Text("Your team's artwork, on your phone. Look closely, check layers and share the image.")
                    .font(Theme.body(17))
                    .foregroundStyle(Theme.muted)
                    .padding(.top, 10)
                VStack(alignment: .leading, spacing: 14) {
                    Feature(icon: "photo.on.rectangle.angled", text: "Every project in your teams, at a glance")
                    Feature(icon: "square.3.layers.3d", text: "Pinch into the artwork and peek at its layers")
                    Feature(icon: "square.and.arrow.up", text: "Export the image as PNG")
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
                Text("Your projects stay on your team's nodes. This phone holds no node; it signs in through your account's relay.")
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
