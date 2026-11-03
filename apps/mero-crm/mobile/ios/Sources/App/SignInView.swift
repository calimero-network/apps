import MeroKitUI
import SwiftUI

/// Signed out: what the app is, and Calimero sign-in (a Cloud passkey, or a development node).
struct SignInView: View {
    @EnvironmentObject private var session: MeroAppSession
    @ObservedObject var client: MeroClient

    private let points = [
        ("rectangle.split.3x1", "A pipeline you move deals through, with the next step on every card."),
        ("checklist", "A to-do list that puts overdue follow-ups first."),
        ("lock", "Lives on your team's own nodes. No vendor holds your customer list."),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                Spacer(minLength: 40)
                AppMark()
                VStack(alignment: .leading, spacing: 10) {
                    Text("Mero CRM").font(.largeTitle.weight(.bold)).foregroundStyle(Palette.ink)
                    Text("A simple, private sales CRM: deals, the people behind them, and what to do next.")
                        .font(.body).foregroundStyle(Palette.ink2)
                }
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(points, id: \.1) { icon, text in
                        Label {
                            Text(text).font(.subheadline).foregroundStyle(Palette.ink)
                        } icon: {
                            Image(systemName: icon).foregroundStyle(Palette.ink)
                        }
                    }
                }
                if session.pendingInvitation != nil {
                    Card {
                        Label("You're invited to a workspace. Sign in to join it.", systemImage: "envelope.open")
                            .font(.subheadline.weight(.medium)).foregroundStyle(Palette.ink)
                    }
                }
                CloudSignInPanel(style: .app)
                    .disabled(session.isRestoring)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
        .screenBackground()
    }
}

/// The lime rounded square with the pipeline glyph.
struct AppMark: View {
    var size: CGFloat = 64
    var body: some View {
        RoundedRectangle(cornerRadius: size / 3.5, style: .continuous)
            .fill(Palette.lime)
            .frame(width: size, height: size)
            .overlay(
                Image(systemName: "rectangle.split.3x1")
                    .font(.system(size: size * 0.45, weight: .semibold))
                    .foregroundStyle(Palette.ink))
    }
}
