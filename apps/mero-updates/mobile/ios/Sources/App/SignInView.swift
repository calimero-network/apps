import MeroKitUI
import SwiftUI

/// Signed out: what the app is, and Calimero sign-in.
struct SignInView: View {
    @EnvironmentObject private var session: MeroAppSession
    @ObservedObject var client: MeroClient
    @State private var signingIn = false

    private let points: [(String, String)] = [
        ("doc.text", "Structured updates: TL;DR, KPIs with the change since last time, and asks."),
        ("hand.raised", "Investors react, reply and offer help on an ask in one tap."),
        ("lock", "No SaaS database. Updates live on the company's and its investors' own nodes."),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                Spacer(minLength: 40)
                IconTile(icon: "tray.full", accent: true, size: 64)
                VStack(alignment: .leading, spacing: 10) {
                    Text("Mero Updates").font(Typeface.display(34)).foregroundStyle(Palette.ink)
                    Text("Investor updates and investor relations, peer to peer.")
                        .font(.body).foregroundStyle(Palette.ink2)
                }
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(points, id: \.1) { icon, point in
                        Label {
                            Text(point).font(.subheadline).foregroundStyle(Palette.ink)
                        } icon: {
                            Image(systemName: icon).foregroundStyle(Palette.ink)
                        }
                    }
                }
                if session.pendingInvitation != nil {
                    Card {
                        Label("You're invited to a company. Sign in to join it.", systemImage: "envelope.open")
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
