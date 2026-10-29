import SignCore
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
    /// Waiting on somebody: the web's `--glass-wait-ink` on a soft amber.
    static let wait = Color(hex: 0x6B4E00)
    static let waitSoft = Color(hex: 0xFFF1C2)
    /// Done: the web's `--glass-good-ink` on a soft green.
    static let good = Color(hex: 0x0B6B43)
    static let goodSoft = Color(hex: 0xD9F5E6)

    /// Avatar tones, picked by ``SignFormat/tone(_:tones:)``: background, ink.
    static let tones: [(Color, Color)] = [
        (Color(hex: 0xE4F9C4), Color(hex: 0x2F5000)),
        (Color(hex: 0xDDE7FF), Color(hex: 0x23408F)),
        (Color(hex: 0xFFE4D1), Color(hex: 0x8A3B0B)),
        (Color(hex: 0xF3DDFB), Color(hex: 0x6A1E86)),
        (Color(hex: 0xD5F4EE), Color(hex: 0x0D5E50)),
        (Color(hex: 0xFFF1C2), Color(hex: 0x6B4E00)),
    ]
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255)
    }
}

enum Typeface {
    /// Headings: the system face, semibold. The web app ships no display face
    /// of its own (it uses Figtree for everything), so there is none to bundle.
    static func display(_ size: CGFloat, bold: Bool = true) -> Font {
        .system(size: size, weight: bold ? .semibold : .regular)
    }
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

/// A person's (round) or a place's (rounded square) initials on a tone.
struct Avatar: View {
    let label: String
    var seed: String?
    var size: CGFloat = 40
    var square = false
    var symbol: String?

    var body: some View {
        let tone = Palette.tones[SignFormat.tone(seed ?? label)]
        ZStack {
            if square {
                RoundedRectangle(cornerRadius: size * 0.28, style: .continuous).fill(tone.0)
            } else {
                Circle().fill(tone.0)
            }
            if let symbol {
                Image(systemName: symbol).font(.system(size: size * 0.42, weight: .semibold))
            } else {
                Text(SignFormat.initials(label, id: seed ?? label))
                    .font(.system(size: size * 0.38, weight: .bold))
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
                .font(.system(size: 30, weight: .regular))
                .foregroundStyle(Palette.ink)
                .frame(width: 64, height: 64)
                .background(Circle().fill(Palette.limeSoft))
            Text(title).font(Typeface.display(20))
                .foregroundStyle(Palette.ink)
            Text(message)
                .font(.system(size: 15))
                .foregroundStyle(Palette.muted)
                .multilineTextAlignment(.center)
            if let action {
                Button(action.title, action: action.run)
                    .buttonStyle(PrimaryButtonStyle(compact: true))
                    .padding(.top, 4)
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

/// A dismissable line at the top of a screen for a failed action.
struct NoticeBanner: View {
    let text: String
    let dismiss: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Palette.danger)
            Text(text).font(.system(size: 14)).foregroundStyle(Palette.ink)
            Spacer(minLength: 0)
            Button(action: dismiss) {
                Image(systemName: "xmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.muted)
            }
            .accessibilityLabel("Dismiss")
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.dangerSoft))
        .padding(.horizontal, 16)
        .padding(.top, 8)
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

/// A lime pill that says something is done or yours.
struct Badge: View {
    let text: String
    var strong = true

    var body: some View {
        Text(text)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(Palette.ink)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Capsule().fill(strong ? Palette.lime : Palette.sunken))
    }
}

/// The sheet header every create/edit sheet shares: Cancel, a title, and the action.
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

extension View {
    /// The nav bar every screen shares: white, inline, ink.
    func signNavigation(_ title: String) -> some View {
        navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Palette.surface, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
    }
}
