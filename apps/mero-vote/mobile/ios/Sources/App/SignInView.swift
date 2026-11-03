import MeroKitUI
import SwiftUI
import VoteCore

/// The front door: what Mero Vote is, and one way in.
struct SignInView: View {
    @EnvironmentObject private var session: MeroAppSession
    var invited = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                VStack(alignment: .leading, spacing: 16) {
                    Image(systemName: "checkmark.seal.fill")
                        .font(.system(size: 32, weight: .semibold))
                        .foregroundStyle(Palette.ink)
                        .frame(width: 76, height: 76)
                        .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(Palette.lime))
                    Text("Mero Vote").font(Typeface.display(34)).foregroundStyle(Palette.ink)
                    Text("Private polls with verifiable tallies.")
                        .font(.system(size: 19, weight: .medium))
                        .foregroundStyle(Palette.inkSoft)
                }
                VStack(alignment: .leading, spacing: 18) {
                    point("lock.fill", "Encrypted here", "Your choice leaves this phone as ciphertext and a proof.", accent: true)
                    point("key.fill", "Shared key", "Trustees hold the decryption key together; no one holds all of it.")
                    point("chart.bar.fill", "Audited by everyone", "Every member's node recomputes the tally from the frozen ballots.")
                }
                if invited {
                    HStack(spacing: 10) {
                        Image(systemName: "envelope.open")
                        Text("You're invited to a voting group. Sign in to accept.")
                            .font(.system(size: 15, weight: .medium))
                    }
                    .foregroundStyle(Palette.ink)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Palette.limeSoft))
                }
            }
            .padding(.horizontal, 28)
            .padding(.top, 56)
        }
        .safeAreaInset(edge: .bottom) {
            CloudSignInPanel(style: .app)
            .padding(.horizontal, 24)
            .padding(.vertical, 16)
            .background(Palette.ground)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Palette.ground.ignoresSafeArea())
    }

    private func point(_ symbol: String, _ title: String, _ text: String, accent: Bool = false) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: symbol)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Palette.ink)
                .frame(width: 40, height: 40)
                .background(Circle().fill(accent ? Palette.lime : Palette.surface))
                .overlay(Circle().stroke(Palette.hairline, lineWidth: accent ? 0 : 0.5))
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 16, weight: .semibold)).foregroundStyle(Palette.ink)
                Text(text).font(.system(size: 15)).foregroundStyle(Palette.muted)
            }
        }
    }
}
