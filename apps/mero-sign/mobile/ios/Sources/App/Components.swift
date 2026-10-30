import MeroKitUI
import SignCore
import SwiftUI

/// The status words on a soft tone: lime waiting on you, amber waiting on
/// others, green complete.
struct StatusPill: View {
    let entry: DocumentEntry

    var body: some View {
        let (text, symbol, fill, ink) = style
        Label(text, systemImage: symbol)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(ink)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Capsule().fill(fill))
    }

    private var style: (String, String, Color, Color) {
        switch entry.bucket {
        case .toSign: return ("Needs your signature", "signature", Palette.lime, Palette.ink)
        case .waiting:
            return (
                entry.iSigned ? "You signed" : SignFormat.status(entry.document.status), "clock", Palette.waitSoft,
                Palette.wait
            )
        case .completed: return ("Signed", "checkmark.seal.fill", Palette.goodSoft, Palette.good)
        }
    }
}

/// A document in a list: a paper glyph, its name, where it is and its status.
struct DocumentRowView: View {
    let entry: DocumentEntry
    var showAgreement = true

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: entry.isComplete ? "doc.text.fill" : "doc.text")
                .font(.system(size: 20, weight: .medium))
                .foregroundStyle(entry.isComplete ? Palette.good : Palette.ink)
                .frame(width: 44, height: 52)
                .background(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(entry.isComplete ? Palette.goodSoft : Palette.sunken))
            VStack(alignment: .leading, spacing: 5) {
                Text(entry.document.name)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Palette.ink)
                    .lineLimit(2)
                Text(subtitle)
                    .font(.system(size: 13))
                    .foregroundStyle(Palette.muted)
                    .lineLimit(1)
                HStack(spacing: 8) {
                    StatusPill(entry: entry)
                    if !entry.isComplete, entry.progress.required > 0 {
                        Text(SignFormat.progress(entry)).font(.system(size: 12)).foregroundStyle(Palette.muted)
                    }
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Palette.muted)
                .padding(.top, 4)
        }
        .padding(14)
        .contentShape(Rectangle())
    }

    private var subtitle: String {
        let when = SignFormat.when(nanos: entry.document.uploadedAt)
        return showAgreement ? "\(entry.agreement.name) · \(when)" : when
    }
}

/// A small grey heading above a group of cards.
struct SectionLabel: View {
    let text: String
    var trailing: String?

    var body: some View {
        HStack {
            Text(text.uppercased())
                .font(.system(size: 12, weight: .semibold))
                .tracking(0.6)
                .foregroundStyle(Palette.muted)
            Spacer()
            if let trailing {
                Text(trailing).font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.muted)
            }
        }
        .padding(.horizontal, 4)
    }
}

/// The account button in a nav bar: who you are, open an invitation, sign out.
struct AccountMenu: View {
    @EnvironmentObject private var session: MeroAppSession
    var openInvitation: (() -> Void)?
    @State private var confirmSignOut = false

    /// " on <host>", or " on <host> (development)" for a mock-attested cluster.
    private var nodeLine: String {
        guard let url = session.client.nodeURL else { return "" }
        let host = URL(string: url)?.host ?? url
        return session.client.allowMock ? " on \(host) (development)" : " on \(host)"
    }

    var body: some View {
        Menu {
            if let account = session.account {
                Section("Signed in as \(SignIds.short(account))\(nodeLine)") {
                    Button {
                        UIPasteboard.general.string = account
                    } label: {
                        Label("Copy account id", systemImage: "doc.on.doc")
                    }
                }
            }
            if let openInvitation {
                Button(action: openInvitation) { Label("Open an invitation link", systemImage: "link") }
            }
            Button(role: .destructive) {
                confirmSignOut = true
            } label: {
                Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
            }
        } label: {
            Image(systemName: "person.crop.circle")
                .font(.system(size: 19, weight: .regular))
                .foregroundStyle(Palette.ink)
        }
        .accessibilityLabel("Account")
        .confirmationDialog("Sign out of Mero Sign?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { Task { await session.signOut() } }
        }
    }
}
