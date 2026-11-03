import DocsCore
import MeroKitUI
import SwiftUI

/// Sign in with a Calimero account: a passkey on your Calimero Cloud cluster, or a development node.
struct SignInView: View {
    @ObservedObject var session: MeroAppSession
    @ObservedObject var client: MeroClient

    var body: some View {
        ZStack {
            Theme.ground.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 0) {
                Spacer()
                AppMark(size: 64)
                Text("Mero Docs")
                    .font(Theme.heading(34))
                    .foregroundStyle(Theme.ink)
                    .padding(.top, 24)
                Text("Your workspace's documents, on your phone. Read them, search them and talk them through in comments.")
                    .font(Theme.body(17))
                    .foregroundStyle(Theme.muted)
                    .padding(.top, 10)
                VStack(alignment: .leading, spacing: 14) {
                    Feature(icon: "doc.richtext", text: "Read documents as they were written")
                    Feature(icon: "magnifyingglass", text: "Search every folder at once")
                    Feature(icon: "text.bubble", text: "Comment on any paragraph")
                }
                .padding(.top, 28)
                Spacer()
                CloudSignInPanel(style: .app)
                    .environmentObject(session)
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
