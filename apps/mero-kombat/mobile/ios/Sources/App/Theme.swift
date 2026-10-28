import KombatCore
import SwiftUI
import UIKit

/// The Calimero light style: lime accent fills with ink text on them, near-black ink, white and
/// very light grey surfaces, hairline borders. Same values as the Android app's `KombatColors`.
/// The fight screen is the one dark surface: the arena is a night stage.
enum Theme {
    static let lime = Color(hex: 0xA5FF11)
    static let ink = Color(hex: 0x0B0B0C)
    static let ink2 = Color(hex: 0x3A3B40)
    static let muted = Color(hex: 0x6E7077)
    static let ground = Color(hex: 0xF5F6F3)
    static let surface = Color.white
    static let sunken = Color(hex: 0xEEF0EB)
    static let line = Color(hex: 0x0B0B0C, alpha: 0.10)
    static let danger = Color(hex: 0xC62828)
    static let dangerSoft = Color(hex: 0xFDECEC)
    static let online = Color(hex: 0x22C55E)
    static let limeSoft = Color(hex: 0xA5FF11, alpha: 0.22)

    // The fight screen.
    static let stage = Color(hex: 0x0B0B0C)
    static let padFill = Color(hex: 0xFFFFFF, alpha: 0.10)
    static let padPressed = Color(hex: 0xA5FF11, alpha: 0.85)
    static let padLine = Color(hex: 0xFFFFFF, alpha: 0.22)
    static let onStage = Color(hex: 0xFFFFFF, alpha: 0.92)
    static let onStageMuted = Color(hex: 0xFFFFFF, alpha: 0.6)

    static let radius: CGFloat = 16
    static let hairline: CGFloat = 0.75

    /// Power Grotesk when bundled, the system face otherwise.
    static func heading(_ size: CGFloat) -> Font {
        if UIFont(name: "PowerGrotesk-Bold", size: size) != nil { return .custom("PowerGrotesk-Bold", size: size) }
        return .system(size: size, weight: .semibold)
    }
    static func body(_ size: CGFloat = 15, _ weight: Font.Weight = .regular) -> Font { .system(size: size, weight: weight) }
    static let mono = Font.system(size: 12, design: .monospaced)
}

extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(
            .sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255, opacity: alpha)
    }
}

extension View {
    /// A white card with a hairline border.
    func card(padding: CGFloat = 16) -> some View {
        self.padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).fill(Theme.surface))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
                    .strokeBorder(Theme.line, lineWidth: Theme.hairline))
    }
}

/// Lime fill, ink text: the one primary action on a screen.
struct PrimaryButtonStyle: ButtonStyle {
    var fullWidth = true
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.body(15, .semibold))
            .foregroundStyle(Theme.ink)
            .padding(.horizontal, 18)
            .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: 48)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.lime))
            .opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.45)
    }
}

/// White with a hairline border: every other action.
struct SecondaryButtonStyle: ButtonStyle {
    var fullWidth = true
    var destructive = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.body(15, .semibold))
            .foregroundStyle(destructive ? Theme.danger : Theme.ink)
            .padding(.horizontal, 16)
            .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: 44)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(configuration.isPressed ? Theme.sunken : Theme.surface))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.line, lineWidth: 1))
            .opacity(isEnabled ? 1 : 0.45)
    }
}

/// The app mark: a fighter on a lime tile.
struct AppMark: View {
    var size: CGFloat = 56

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
            .fill(Theme.lime)
            .frame(width: size, height: size)
            .overlay(
                Image(systemName: "figure.martial.arts")
                    .font(.system(size: size * 0.52, weight: .semibold))
                    .foregroundStyle(Theme.ink))
            .accessibilityHidden(true)
    }
}

/// A fighter's tile: a dark plate in their costume colour with the fighter figure on it. An empty
/// corner is a sunken tile with a question mark.
struct FighterBadge: View {
    let fighter: String?
    var size: CGFloat = 44
    var mirrored = false

    var body: some View {
        let info = fighter.flatMap { $0.isEmpty ? nil : FighterInfo.of($0) }
        RoundedRectangle(cornerRadius: size * 0.27, style: .continuous)
            .fill(info == nil ? Theme.sunken : Theme.stage)
            .frame(width: size, height: size)
            .overlay {
                if let info {
                    Image(systemName: "figure.martial.arts")
                        .font(.system(size: size * 0.5, weight: .semibold))
                        .foregroundStyle(Color(hex: info.color))
                        .scaleEffect(x: mirrored ? -1 : 1, y: 1)
                } else {
                    Image(systemName: "questionmark")
                        .font(.system(size: size * 0.38, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                }
            }
            .accessibilityHidden(true)
    }
}

/// A section label inside a card.
struct CardTitle: View {
    let text: String
    var trailing: String?

    var body: some View {
        HStack {
            Text(text).font(Theme.heading(17)).foregroundStyle(Theme.ink)
            Spacer()
            if let trailing { Text(trailing).font(Theme.body(13)).foregroundStyle(Theme.muted) }
        }
    }
}

/// A red banner for an error, with a dismiss button.
struct ErrorBanner: View {
    let message: String
    let onDismiss: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Theme.danger)
            Text(message).font(Theme.body(14)).foregroundStyle(Theme.ink).frame(maxWidth: .infinity, alignment: .leading)
            Button(action: onDismiss) {
                Image(systemName: "xmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted)
            }
            .accessibilityLabel("Dismiss")
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.dangerSoft))
    }
}

/// Technical values (ids), behind a disclosure.
struct DetailRow: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(Theme.body(12, .semibold)).foregroundStyle(Theme.muted)
            Text(value).font(Theme.mono).foregroundStyle(Theme.ink2).textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

enum Haptics {
    private static let light = UIImpactFeedbackGenerator(style: .light)
    private static let rigid = UIImpactFeedbackGenerator(style: .rigid)

    static func tap() { light.impactOccurred() }
    /// A fight pad button going down: short and crisp, prepared ahead so it never lags the press.
    static func pad() { rigid.impactOccurred(intensity: 0.7); rigid.prepare() }
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func warning() { UINotificationFeedbackGenerator().notificationOccurred(.warning) }
}
