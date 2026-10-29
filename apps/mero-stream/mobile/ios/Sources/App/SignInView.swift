import MeroKitUI
import SwiftUI

/// Signed out: what the app is, and Calimero sign-in.
struct SignInView: View {
    @EnvironmentObject private var session: MeroAppSession
    @ObservedObject var client: MeroClient
    @State private var signingIn = false

    private let points: [(String, String)] = [
        ("person.2.wave.2", "Create a stream, invite people, and meet in its rooms."),
        ("antenna.radiowaves.left.and.right", "Video rides ephemeral presence, so nothing about a call is stored."),
        ("laptopcomputer.and.iphone", "A phone and a browser can be in the same room."),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                Spacer(minLength: 40)
                Image(systemName: "video.fill")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(Palette.ink)
                    .frame(width: 64, height: 64)
                    .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Palette.lime))
                VStack(alignment: .leading, spacing: 10) {
                    Text("Mero Stream").font(Typeface.display(34)).foregroundStyle(Palette.ink)
                    Text("Video rooms on your own Calimero nodes. Up to two people share their camera at once; everyone else watches.")
                        .font(.body).foregroundStyle(Palette.inkSoft)
                }
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(points, id: \.1) { point in
                        Label {
                            Text(point.1).font(.subheadline).foregroundStyle(Palette.ink)
                        } icon: {
                            Image(systemName: point.0).foregroundStyle(Palette.ink)
                        }
                    }
                }
                if session.pendingInvitation != nil {
                    Card {
                        Label("You're invited to a stream. Sign in to join it.", systemImage: "envelope.open")
                            .font(.subheadline.weight(.medium)).foregroundStyle(Palette.ink)
                            .padding(14)
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
                        Text(message).font(.footnote).foregroundStyle(Palette.danger)
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
