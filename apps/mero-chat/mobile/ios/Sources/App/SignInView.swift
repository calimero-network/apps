import MeroKitUI
import SwiftUI

/// The web app's landing page, at phone width: the header card, the hero and
/// the connect button. On the phone "connect" is signing in with the
/// Calimero account; the wallet certifies a key this device keeps.
struct SignInView: View {
    @ObservedObject var session: SessionModel
    @ObservedObject var client: MeroClient

    var body: some View {
        ZStack {
            GroundBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    header
                        .padding(.bottom, 44)
                    hero
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 32)
            }
        }
    }

    private var header: some View {
        HStack {
            AppMark(size: 24)
            Spacer()
            connectButton(fullWidth: false)
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(Theme.surface)
                .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Theme.surfaceSolid, lineWidth: 1))
                .shadow(color: Color(hex: 0x28326E, alpha: 0.12), radius: 18, y: 10)
        )
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text("Powered by Calimero")
                    .font(Theme.font(12, .semibold))
                    .foregroundStyle(Theme.accent)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(Capsule().fill(Color(light: 0xE3E9FF, dark: 0x1C2650)))
                HStack(spacing: 6) {
                    Image(systemName: "checkmark").font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                    Text("iOS + Web + Desktop").font(Theme.font(12, .semibold)).foregroundStyle(Theme.ink2)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(Capsule().fill(Theme.surface))
                .overlay(Capsule().stroke(Theme.line, lineWidth: 1))
            }
            Text("Mero Chat")
                .font(Theme.font(48, .heavy))
                .tracking(-1.5)
                .foregroundStyle(Theme.ink)
                .padding(.top, 4)
                .accessibilityIdentifier("signInTitle")
            Text("Team chat that lives on your nodes, not someone else's servers.")
                .font(Theme.font(24, .bold))
                .foregroundStyle(Theme.accent)
                .padding(.top, 16)
            Text("Private team chat on your own nodes: channels, threads and direct messages with no central server.")
                .font(Theme.font(17))
                .lineSpacing(8)
                .foregroundStyle(Theme.ink2)
                .padding(.top, 6)

            if let error = client.errorMessage {
                Banner(kind: .error, text: error)
                    .padding(.top, 20)
                    .accessibilityIdentifier("signInError")
            }

            connectButton(fullWidth: true)
                .padding(.top, 32)
            Text("Approve this device with your passkey in the Calimero wallet.")
                .font(Theme.font(13))
                .foregroundStyle(Theme.muted)
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
                .padding(.top, 12)

            HStack(spacing: 10) {
                bullet("Channels, threads and DMs")
                bullet("No central server")
            }
            .padding(.top, 28)
            bullet("Messages on your nodes").padding(.top, 10)
        }
    }

    private func bullet(_ text: String) -> some View {
        HStack(spacing: 8) {
            Circle().fill(Theme.lineStrong).frame(width: 5, height: 5)
            Text(text).font(Theme.font(14)).foregroundStyle(Theme.muted)
        }
    }

    private func connectButton(fullWidth: Bool) -> some View {
        Button {
            Task { await session.signIn() }
        } label: {
            HStack(spacing: 8) {
                if client.isLoading { ProgressView().tint(Theme.onInk) }
                Text("Continue with Calimero")
            }
            .frame(minHeight: fullWidth ? 46 : 40)
        }
        .buttonStyle(InkButtonStyle(fullWidth: fullWidth))
        .disabled(client.isLoading)
        .accessibilityIdentifier(fullWidth ? "signInButton" : "signInHeaderButton")
    }
}
