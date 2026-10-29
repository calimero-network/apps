import PassCore
import SwiftUI
import UIKit

/// Calimero light: lime accent fills with ink text on them, near-black ink,
/// white and very light grey surfaces, hairline borders. Android `Theme.kt`
/// holds the same values.
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
    static let danger = Color(hex: 0xC2214E)
    static let dangerSoft = Color(hex: 0xFFE7EC)
    static let warn = Color(hex: 0x8A5A00)
    static let warnSoft = Color(hex: 0xFFF4D6)
    static let good = Color(hex: 0x1E7A3C)

    /// A tile's background and ink from a stable hue (``ItemView/hue(_:)``).
    static func tile(_ name: String) -> (Color, Color) {
        let hue = Double(ItemView.hue(name)) / 360
        return (Color(hue: hue, saturation: 0.32, brightness: 0.97), Color(hue: hue, saturation: 0.85, brightness: 0.38))
    }

    /// Strength meter colour for a 0–4 score.
    static func strength(_ score: Int) -> Color {
        score <= 1 ? danger : score == 2 ? Color(hex: 0xC27C0E) : good
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
    /// The web app ships no display face of its own, so headings are the system face, semibold.
    static func display(_ size: CGFloat) -> Font { .system(size: size, weight: .semibold) }
}

enum Haptics {
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
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
    var destructive = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: compact ? 15 : 17, weight: .semibold))
            .foregroundStyle(destructive ? Palette.danger : Palette.ink)
            .padding(.horizontal, compact ? 16 : 20)
            .frame(maxWidth: compact ? nil : .infinity, minHeight: compact ? 34 : 50)
            .background(Capsule().fill(Palette.surface))
            .overlay(Capsule().stroke(Palette.hairline, lineWidth: 1))
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

// MARK: - Pieces

/// A team's, vault's or item's tile: its initial on a colour from its name.
struct Tile: View {
    let name: String
    var size: CGFloat = 40
    var symbol: String?

    var body: some View {
        let tone = Palette.tile(name)
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.28, style: .continuous).fill(tone.0)
            if let symbol {
                Image(systemName: symbol).font(.system(size: size * 0.42, weight: .semibold))
            } else {
                Text(ItemView.monogram(name)).font(.system(size: size * 0.42, weight: .bold))
            }
        }
        .foregroundStyle(tone.1)
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// White, rounded, hairline-bordered.
struct Card<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        content
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Palette.surface))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Palette.hairline, lineWidth: 0.5))
    }
}

struct EmptyState: View {
    let symbol: String
    let title: String
    let message: String
    var action: (title: String, run: () -> Void)?

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 28, weight: .regular))
                .foregroundStyle(Palette.ink)
                .frame(width: 64, height: 64)
                .background(Circle().fill(Palette.limeSoft))
            Text(title).font(Typeface.display(20)).foregroundStyle(Palette.ink).multilineTextAlignment(.center)
            Text(message).font(.system(size: 15)).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
            if let action {
                Button(action.title, action: action.run).buttonStyle(PrimaryButtonStyle(compact: true)).padding(.top, 4)
            }
        }
        .padding(32)
        .frame(maxWidth: .infinity)
    }
}

struct ErrorState: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 26))
                .foregroundStyle(Palette.danger)
                .frame(width: 60, height: 60)
                .background(Circle().fill(Palette.dangerSoft))
            Text("Couldn't load this").font(Typeface.display(19)).foregroundStyle(Palette.ink)
            Text(message).font(.system(size: 15)).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
            Button("Try again", action: retry).buttonStyle(SecondaryButtonStyle(compact: true))
        }
        .padding(32)
        .frame(maxWidth: .infinity)
    }
}

/// A notice strip: danger for failures, warn for "waiting", plain for info.
struct Banner: View {
    enum Tone { case danger, warn, info }

    let tone: Tone
    let symbol: String
    let title: String?
    let text: String
    var dismiss: (() -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol).foregroundStyle(accent).padding(.top, 1)
            VStack(alignment: .leading, spacing: 3) {
                if let title { Text(title).font(.system(size: 14, weight: .semibold)).foregroundStyle(Palette.ink) }
                Text(text).font(.system(size: 14)).foregroundStyle(Palette.inkSoft)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            if let dismiss {
                Button(action: dismiss) {
                    Image(systemName: "xmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.muted)
                }
                .accessibilityLabel("Dismiss")
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(background))
    }

    private var accent: Color {
        switch tone {
        case .danger: return Palette.danger
        case .warn: return Palette.warn
        case .info: return Palette.ink
        }
    }

    private var background: Color {
        switch tone {
        case .danger: return Palette.dangerSoft
        case .warn: return Palette.warnSoft
        case .info: return Palette.limeSoft
        }
    }
}

/// Ids and other technical values, folded away behind "Details".
struct DetailsDisclosure: View {
    let rows: [(String, String)]
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
                .foregroundStyle(Palette.inkSoft)
                .padding(.vertical, 12)
            }
            if open {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(rows.filter { !$0.1.isEmpty }, id: \.0) { row in
                        CopyRow(label: row.0, value: row.1)
                    }
                }
                .padding(.bottom, 8)
            }
        }
    }
}

/// An id with a copy button (never a secret: secrets go through ``SecretClipboard``).
struct CopyRow: View {
    let label: String
    let value: String
    @State private var copied = false

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.muted)
                Text(value).font(.system(size: 13, design: .monospaced)).foregroundStyle(Palette.ink)
                    .lineLimit(1).truncationMode(.middle)
            }
            Spacer()
            Button {
                UIPasteboard.general.string = value
                copied = true
                Haptics.tap()
            } label: {
                Image(systemName: copied ? "checkmark" : "doc.on.doc").font(.system(size: 14))
                    .foregroundStyle(Palette.inkSoft)
                    .frame(width: 32, height: 32)
            }
            .accessibilityLabel(copied ? "Copied" : "Copy \(label)")
        }
    }
}

/// A small pill: lime when strong, grey otherwise.
struct Badge: View {
    let text: String
    var strong = false

    var body: some View {
        Text(text)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(Palette.ink)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Capsule().fill(strong ? Palette.lime : Palette.sunken))
    }
}

/// A small upper-case section heading.
struct SectionLabel: View {
    let text: String

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 12, weight: .semibold))
            .tracking(0.8)
            .foregroundStyle(Palette.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The sheet header every create/edit sheet shares: Cancel, a title, and the action.
struct SheetBar: View {
    let title: String
    let action: String?
    var canAct = true
    var busy = false
    let cancel: () -> Void
    var act: () -> Void = {}

    var body: some View {
        HStack {
            Button(action == nil ? "Done" : "Cancel", action: cancel)
                .font(.system(size: 16))
                .foregroundStyle(Palette.ink)
                .disabled(busy)
            Spacer()
            Text(title).font(.system(size: 16, weight: .semibold)).foregroundStyle(Palette.ink).lineLimit(1)
            Spacer()
            if let action {
                Button(action: act) {
                    if busy {
                        ProgressView().tint(Palette.ink).frame(minWidth: 44)
                    } else {
                        Text(action)
                    }
                }
                .buttonStyle(PrimaryButtonStyle(compact: true))
                .disabled(!canAct || busy)
            } else {
                Color.clear.frame(width: 44, height: 1)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .overlay(alignment: .bottom) { Rectangle().fill(Palette.hairline).frame(height: 0.5) }
    }
}

/// A labelled text input in the sheets' style.
struct InputField: View {
    let label: String
    @Binding var text: String
    var placeholder = ""
    var secure = false
    var multiline = false
    var monospaced = false

    @State private var revealed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.muted)
            HStack(alignment: multiline ? .top : .center, spacing: 8) {
                Group {
                    if multiline && (!secure || revealed) {
                        TextField(placeholder, text: $text, axis: .vertical).lineLimit(3...10)
                    } else if secure && !revealed {
                        SecureField(placeholder, text: $text)
                    } else {
                        TextField(placeholder, text: $text)
                    }
                }
                .font(.system(size: 16, design: monospaced || secure ? .monospaced : .default))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                if secure {
                    Button {
                        revealed.toggle()
                    } label: {
                        Image(systemName: revealed ? "eye.slash" : "eye").foregroundStyle(Palette.inkSoft)
                    }
                    .accessibilityLabel(revealed ? "Hide \(label)" : "Show \(label)")
                }
            }
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.sunken))
        }
    }
}

extension View {
    /// The nav bar every screen shares: white, inline, ink.
    func passNavigation(_ title: String) -> some View {
        navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Palette.surface, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
    }
}
