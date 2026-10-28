import MeroKitUI
import SwiftUI

/// Signed out: what the app is, and Calimero sign-in.
struct SignInView: View {
    @EnvironmentObject private var session: MeroAppSession
    @ObservedObject var client: MeroClient
    @State private var signingIn = false

    private let points = [
        "Lives on your team's own nodes. No server, nobody else can read it.",
        "Yesterday's plan becomes today's draft, so posting takes seconds.",
        "Decisions are never edited, only superseded, so the why survives.",
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                Spacer(minLength: 40)
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(Palette.lime)
                    .frame(width: 64, height: 64)
                    .overlay(Image(systemName: "sun.max").font(.system(size: 30, weight: .semibold)).foregroundStyle(Palette.ink))
                VStack(alignment: .leading, spacing: 10) {
                    Text("Mero Standup").font(.largeTitle.weight(.bold)).foregroundStyle(Palette.ink)
                    Text(
                        "Async standups and a decision log for your team. Post what you did, what is next and what is in your way; record what you decided and why."
                    )
                    .font(.body).foregroundStyle(Palette.ink2)
                }
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(points, id: \.self) { point in
                        Label {
                            Text(point).font(.subheadline).foregroundStyle(Palette.ink)
                        } icon: {
                            Image(systemName: "checkmark.circle").foregroundStyle(Palette.ink)
                        }
                    }
                }
                if session.pendingInvitation != nil {
                    Card {
                        Label("You're invited to a team. Sign in to join it.", systemImage: "envelope.open")
                            .font(.subheadline.weight(.medium)).foregroundStyle(Palette.ink)
                    }
                }
                VStack(spacing: 12) {
                    Button {
                        Haptics.tap()
                        signingIn = true
                        Task {
                            await session.signIn()
                            signingIn = false
                        }
                    } label: {
                        if busy {
                            HStack(spacing: 8) {
                                ProgressView().tint(Palette.ink)
                                Text("Connecting…")
                            }
                        } else {
                            Text("Sign in with Calimero")
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(busy)
                    if let message = client.errorMessage, !busy {
                        ErrorLine(message: message)
                    }
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
        .screenBackground()
    }

    private var busy: Bool { signingIn || session.isRestoring }
}
