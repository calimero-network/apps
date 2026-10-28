import SwiftUI
import UIKit

/// Calimero light: lime accent fills with ink text on them, near-black ink, white and very light
/// grey surfaces, hairline borders. The board keeps the web app's content colours (hit red, miss
/// blue, pending amber). Android `Theme.kt` holds the same values.
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

    // The board.
    static let water = Color(hex: 0xF2F4F7)
    static let gridLine = Color(hex: 0xE4E4E6)
    static let ship = Color(hex: 0x2B2F38)
    static let hit = Color(hex: 0xC81E1E)
    static let sunk = Color(hex: 0x7A1010)
    static let miss = Color(hex: 0x2563A8)
    static let pending = Color(hex: 0xA16207)
    static let pendingSoft = Color(hex: 0xFFF1C2)
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255)
    }
}

enum Typeface {
    /// Figtree (the web app's face, bundled) for headings; the system face if it is missing.
    static func display(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        if !UIFont.fontNames(forFamilyName: "Figtree").isEmpty {
            return .custom("Figtree", size: size).weight(weight)
        }
        return .system(size: size, weight: weight)
    }
}

enum Haptics {
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func heavy() { UIImpactFeedbackGenerator(style: .heavy).impactOccurred() }
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

/// White, rounded, hairline-bordered.
struct Card<Content: View>: View {
    var padding: CGFloat = 16
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Palette.surface))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Palette.hairline, lineWidth: 0.5))
    }
}

/// A rounded square holding a symbol: lobbies, players, results.
struct SymbolTile: View {
    let symbol: String
    var tone: Color = Palette.limeSoft
    var tint: Color = Palette.ink
    var size: CGFloat = 40

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: size * 0.42, weight: .semibold))
            .foregroundStyle(tint)
            .frame(width: size, height: size)
            .background(RoundedRectangle(cornerRadius: size * 0.28, style: .continuous).fill(tone))
            .accessibilityHidden(true)
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
            Text(title).font(Typeface.display(20)).foregroundStyle(Palette.ink)
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

/// A dismissable line at the top of a screen for a refused or failed action.
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

/// A small pill: lime for good news or yours, grey for neutral, red for bad.
struct Badge: View {
    enum Tone { case strong, neutral, danger, pending }
    let text: String
    var tone: Tone = .strong

    var body: some View {
        Text(text)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(foreground)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Capsule().fill(background))
    }

    private var background: Color {
        switch tone {
        case .strong: return Palette.lime
        case .neutral: return Palette.sunken
        case .danger: return Palette.dangerSoft
        case .pending: return Palette.pendingSoft
        }
    }

    private var foreground: Color {
        switch tone {
        case .danger: return Palette.danger
        case .pending: return Palette.pending
        default: return Palette.ink
        }
    }
}

/// The bar every create sheet shares: Cancel, a title, and the action.
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

/// A section label above a group of cards.
struct SectionLabel: View {
    let text: String

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 12, weight: .semibold))
            .tracking(0.6)
            .foregroundStyle(Palette.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

extension View {
    /// The nav bar every screen shares: white, inline, ink.
    func appNavigation(_ title: String) -> some View {
        navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Palette.surface, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
    }
}
