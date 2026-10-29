import SwiftUI
import UIKit

/// Calimero light: lime accent fills with ink on them, near-black text,
/// white and very light grey surfaces, hairline borders, rounded cards.
/// Android's `Theme.kt` holds the same values.
enum Theme {
    static let lime = Color(hex: 0xA5FF11)
    static let ink = Color(hex: 0x0B0B0C)
    static let ink2 = Color(hex: 0x3A3B40)
    static let muted = Color(hex: 0x6E7076)
    static let faint = Color(hex: 0x9A9CA2)
    static let ground = Color(hex: 0xF6F6F4)
    static let surface = Color.white
    static let sunken = Color(hex: 0xEFEFEC)
    static let line = Color(hex: 0x0B0B0C, alpha: 0.08)
    static let lineStrong = Color(hex: 0x0B0B0C, alpha: 0.14)
    static let danger = Color(hex: 0xC2264B)
    /// Behind the artwork.
    static let stage = Color(hex: 0xECECE9)

    static let radius: CGFloat = 14
    static let hairline: CGFloat = 0.75

    /// Headings: the system face, semibold (the web ships no Power Grotesk).
    static func heading(_ size: CGFloat) -> Font { .system(size: size, weight: .semibold) }
    static func body(_ size: CGFloat = 15, _ weight: Font.Weight = .regular) -> Font { .system(size: size, weight: weight) }

    /// A colour per member, stable across launches and identical on Android.
    static func memberColor(_ id: String) -> Color {
        let palette: [UInt32] = [0x3E63F5, 0xE5484D, 0x12A594, 0xF76B15, 0x8E4EC6, 0xD6409F, 0x0090FF, 0x46A758]
        let sum = id.unicodeScalars.reduce(0) { ($0 &* 31 &+ Int($1.value)) & 0x7FFF_FFFF }
        return Color(hex: palette[sum % palette.count])
    }
}

extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(
            .sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255, opacity: alpha)
    }
}

/// Lime fill, ink text: the primary action.
struct PrimaryButtonStyle: ButtonStyle {
    var fullWidth = true
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.body(16, .semibold))
            .foregroundStyle(Theme.ink)
            .padding(.horizontal, 20)
            .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: 50)
            .background(Theme.lime.opacity(enabled ? 1 : 0.45), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// White fill, hairline border.
struct SecondaryButtonStyle: ButtonStyle {
    var fullWidth = true

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.body(15, .semibold))
            .foregroundStyle(Theme.ink)
            .padding(.horizontal, 18)
            .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: 44)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Theme.lineStrong, lineWidth: Theme.hairline))
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

extension View {
    /// A white card with a hairline border.
    func card(padding: CGFloat = 16) -> some View {
        self.padding(padding)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).stroke(Theme.line, lineWidth: Theme.hairline))
    }
}

enum Haptics {
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func error() { UINotificationFeedbackGenerator().notificationOccurred(.error) }
}
