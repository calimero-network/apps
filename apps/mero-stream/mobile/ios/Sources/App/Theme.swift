import StreamCore
import SwiftUI
import UIKit

/// Calimero light for the lists: lime accent fills with ink text on them,
/// near-black ink, white and very light grey surfaces, hairline borders. The
/// call itself is dark, like the web app's stage (`--stage`, `--tile-bg`).
/// Android `Theme.kt` holds the same values.
enum Palette {
    static let lime = Color(hex: 0xA5FF11)
    static let limeSoft = Color(hex: 0xEEFFD1)
    static let ink = Color(hex: 0x0B0B0C)
    static let inkSoft = Color(hex: 0x3C4049)
    static let muted = Color(hex: 0x6B7080)
    static let ground = Color(hex: 0xF5F6F8)
    static let surface = Color.white
    static let sunken = Color(hex: 0xF0F1F4)
    static let hairline = Color(hex: 0xE3E5EA)
    static let danger = Color(hex: 0xC62828)
    static let dangerSoft = Color(hex: 0xFFE7EC)
    static let warnSoft = Color(hex: 0xFFF1C2)

    // The call.
    static let stage = Color(hex: 0x131215)
    static let tile = Color(hex: 0x222126)
    static let control = Color(hex: 0x2E2D33)
    static let stageText = Color(hex: 0xE8E8EA)
    static let stageFaint = Color(hex: 0x9A9AA0)

    /// Avatar tones: background, ink.
    static let tones: [(Color, Color)] = [
        (Color(hex: 0xE4F9C4), Color(hex: 0x2F5000)),
        (Color(hex: 0xDDE7FF), Color(hex: 0x23408F)),
        (Color(hex: 0xFFE4D1), Color(hex: 0x8A3B0B)),
        (Color(hex: 0xF3DDFB), Color(hex: 0x6A1E86)),
        (Color(hex: 0xD5F4EE), Color(hex: 0x0D5E50)),
        (Color(hex: 0xFFF1C2), Color(hex: 0x6B4E00)),
    ]

    static func tone(_ seed: String) -> (Color, Color) {
        var hash: UInt32 = 2_166_136_261
        for byte in seed.utf8 { hash = (hash ^ UInt32(byte)) &* 16_777_619 }
        return tones[Int(hash % UInt32(tones.count))]
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255)
    }
}

enum Typeface {
    /// Power Grotesk when bundled, the system face otherwise.
    static func display(_ size: CGFloat, bold: Bool = true) -> Font {
        let name = bold ? "PowerGrotesk-Bold" : "PowerGrotesk-Regular"
        if UIFont(name: name, size: size) != nil { return .custom(name, size: size) }
        return .system(size: size, weight: bold ? .bold : .regular)
    }
}

enum Haptics {
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func toggle() { UIImpactFeedbackGenerator(style: .medium).impactOccurred() }
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func failure() { UINotificationFeedbackGenerator().notificationOccurred(.error) }
}

// MARK: - Buttons

/// Lime fill, ink text: the one primary action on a screen.
struct PrimaryButtonStyle: ButtonStyle {
    var compact = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: compact ? 15 : 17, weight: .semibold))
            .foregroundStyle(Palette.ink)
            .padding(.horizontal, compact ? 16 : 20)
            .frame(maxWidth: compact ? nil : .infinity, minHeight: compact ? 34 : 50)
            .background(Capsule().fill(Palette.lime))
            .opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.45)
    }
}

/// Outlined, for the second action.
struct SecondaryButtonStyle: ButtonStyle {
    var compact = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: compact ? 15 : 17, weight: .semibold))
            .foregroundStyle(Palette.ink)
            .padding(.horizontal, compact ? 16 : 20)
            .frame(maxWidth: compact ? nil : .infinity, minHeight: compact ? 34 : 50)
            .background(Capsule().fill(Palette.surface))
            .overlay(Capsule().stroke(Palette.hairline, lineWidth: 1))
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

// MARK: - Pieces

/// A person's initials on a tone.
struct Avatar: View {
    let name: String
    var seed: String?
    var size: CGFloat = 40

    var body: some View {
        let tone = Palette.tone(seed ?? name)
        Text(People.initials(name))
            .font(.system(size: size * 0.38, weight: .bold))
            .foregroundStyle(tone.1)
            .frame(width: size, height: size)
            .background(Circle().fill(tone.0))
            .accessibilityHidden(true)
    }
}

/// White, rounded, hairline-bordered.
struct Card<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Palette.surface))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Palette.hairline, lineWidth: 0.5))
    }
}

/// A rounded square holding an SF Symbol: the leading mark on a list row.
struct RowIcon: View {
    let symbol: String

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(Palette.ink)
            .frame(width: 42, height: 42)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.limeSoft))
            .accessibilityHidden(true)
    }
}

struct EmptyState: View {
    let symbol: String
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 28, weight: .regular))
                .foregroundStyle(Palette.ink)
                .frame(width: 64, height: 64)
                .background(Circle().fill(Palette.limeSoft))
            Text(title).font(Typeface.display(20)).foregroundStyle(Palette.ink)
            Text(message)
                .font(.system(size: 15))
                .foregroundStyle(Palette.muted)
                .multilineTextAlignment(.center)
        }
        .padding(28)
        .frame(maxWidth: .infinity)
    }
}

/// A dismissable line for a failed action.
struct NoticeBanner: View {
    let text: String
    var symbol = "exclamationmark.circle.fill"
    var tint = Palette.danger
    var background = Palette.dangerSoft
    let dismiss: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol).foregroundStyle(tint)
            Text(text).font(.system(size: 14)).foregroundStyle(Palette.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button(action: dismiss) {
                Image(systemName: "xmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.muted)
            }
            .accessibilityLabel("Dismiss")
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(background))
    }
}

/// Ids and other technical values, folded away behind "Details".
struct DetailsDisclosure: View {
    let rows: [(String, String)]
    var dark = false
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeOut(duration: 0.2)) { open.toggle() }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "info.circle")
                    Text("Details")
                    Spacer()
                    Image(systemName: "chevron.down").rotationEffect(.degrees(open ? 180 : 0))
                }
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(dark ? Palette.stageFaint : Palette.inkSoft)
                .padding(.vertical, 12)
            }
            if open {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(rows.filter { !$0.1.isEmpty }, id: \.0) { row in
                        CopyRow(label: row.0, value: row.1, dark: dark)
                    }
                }
                .padding(.bottom, 8)
            }
        }
    }
}

struct CopyRow: View {
    let label: String
    let value: String
    var dark = false
    @State private var copied = false

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.system(size: 12, weight: .medium))
                    .foregroundStyle(dark ? Palette.stageFaint : Palette.muted)
                Text(value).font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(dark ? Palette.stageText : Palette.ink)
                    .lineLimit(1).truncationMode(.middle)
            }
            Spacer()
            Button {
                UIPasteboard.general.string = value
                copied = true
                Haptics.tap()
            } label: {
                Image(systemName: copied ? "checkmark" : "doc.on.doc").font(.system(size: 14))
                    .foregroundStyle(dark ? Palette.stageFaint : Palette.inkSoft)
                    .frame(width: 32, height: 32)
            }
            .accessibilityLabel(copied ? "Copied" : "Copy \(label)")
        }
    }
}

/// The header every create sheet shares: Cancel, a title, and the action.
struct SheetBar: View {
    let title: String
    let action: String
    let canAct: Bool
    let busy: Bool
    let cancel: () -> Void
    let act: () -> Void

    var body: some View {
        HStack {
            Button("Cancel", action: cancel)
                .font(.system(size: 16))
                .foregroundStyle(Palette.ink)
                .disabled(busy)
            Spacer()
            Text(title).font(.system(size: 16, weight: .semibold)).foregroundStyle(Palette.ink)
            Spacer()
            Button(action: act) {
                if busy {
                    ProgressView().tint(Palette.ink).frame(minWidth: 44)
                } else {
                    Text(action)
                }
            }
            .buttonStyle(PrimaryButtonStyle(compact: true))
            .disabled(!canAct || busy)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .overlay(alignment: .bottom) { Rectangle().fill(Palette.hairline).frame(height: 0.5) }
    }
}

/// A rounded text field on the sunken grey.
struct FieldBox: View {
    let placeholder: String
    @Binding var text: String
    var symbol: String?

    var body: some View {
        HStack(spacing: 10) {
            if let symbol { Image(systemName: symbol).foregroundStyle(Palette.muted) }
            TextField(placeholder, text: $text)
                .font(.system(size: 17))
                .foregroundStyle(Palette.ink)
                .textInputAutocapitalization(.sentences)
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 50)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.sunken))
    }
}

extension View {
    /// The light background every list screen shares.
    func screenBackground() -> some View {
        background(Palette.ground.ignoresSafeArea())
    }

    /// The nav bar every list screen shares: white, inline, ink.
    func streamNavigation(_ title: String) -> some View {
        navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Palette.surface, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
    }
}

/// Share a link with the system sheet.
struct ShareLinkSheet: UIViewControllerRepresentable {
    let text: String

    func makeUIViewController(context: Self.Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [text], applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Self.Context) {}
}

/// A minted link waiting to be shared.
struct SharedLink: Identifiable {
    let id = UUID()
    let url: String
}
