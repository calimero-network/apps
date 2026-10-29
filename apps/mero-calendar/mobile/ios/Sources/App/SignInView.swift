import MeroKitUI
import SwiftUI

/// Signed out: what the app is, and "Continue with Calimero".
struct SignInView: View {
    @ObservedObject var session: MeroAppSession
    @ObservedObject var client: MeroClient
    @State private var signingIn = false

    var body: some View {
        ZStack {
            Theme.ground.ignoresSafeArea()
            VStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 28) {
                        VStack(alignment: .leading, spacing: 14) {
                            AppMark(size: 64)
                            Text("Mero Calendar").font(Theme.heading(34)).foregroundStyle(Theme.ink)
                            Text("Shared team calendars and truly private events.")
                                .font(Theme.body(17)).foregroundStyle(Theme.muted)
                        }
                        .padding(.top, 48)

                        VStack(spacing: 0) {
                            FeatureRow(
                                symbol: "person.3", title: "Teams share calendars",
                                text: "Everyone in a team sees the same calendars, synced peer to peer.")
                            Divider().overlay(Theme.line)
                            FeatureRow(
                                symbol: "lock.fill", title: "Private events stay private",
                                text: "A private event never leaves this device.")
                            Divider().overlay(Theme.line)
                            FeatureRow(
                                symbol: "arrow.triangle.2.circlepath", title: "Live on every device",
                                text: "Changes show up for your team as they happen.")
                        }
                        .card(padding: 4)
                    }
                    .padding(.horizontal, 20)
                }

                VStack(spacing: 10) {
                    if let error = client.errorMessage, !signingIn {
                        Text(error).font(Theme.body(13)).foregroundStyle(Theme.danger).multilineTextAlignment(.center)
                    }
                    Button {
                        Theme.haptic()
                        signingIn = true
                        Task {
                            await session.signIn()
                            signingIn = false
                        }
                    } label: {
                        if signingIn {
                            ProgressView().tint(Theme.ink)
                        } else {
                            Text("Continue with Calimero")
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(signingIn)
                }
                .padding(20)
            }
        }
    }
}

private struct FeatureRow: View {
    let symbol: String
    let title: String
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: symbol)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Theme.ink)
                .frame(width: 36, height: 36)
                .background(Theme.lime.opacity(0.35), in: RoundedRectangle(cornerRadius: 9))
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(Theme.body(15, .semibold)).foregroundStyle(Theme.ink)
                Text(text).font(Theme.body(14)).foregroundStyle(Theme.muted)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
    }
}
