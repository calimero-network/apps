import SwiftUI

#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Calimero light design tokens — the same palette as the apps' web redesign
/// (`apps/apps/mero-vote/app/src/index.css`): warm off-white page, white
/// hairline cards, ink text, lime fills with ink on top. Lime is never used as
/// text on white (it fails contrast); `accentInk` is the lime-family text colour.
///
/// Every colour carries a dark variant, so the app follows the system setting
/// instead of forcing one.
enum Cal {
    // MARK: Surfaces
    static let bg = Color.dynamic(light: 0xF6F6F3, dark: 0x111113)
    static let bgSubtle = Color.dynamic(light: 0xEFEFEB, dark: 0x18181B)
    static let surface = Color.dynamic(light: 0xFFFFFF, dark: 0x1C1C1F)
    static let surfaceHover = Color.dynamic(light: 0xF3F3F0, dark: 0x242428)
    static let surfaceSunken = Color.dynamic(light: 0xF1F1EE, dark: 0x161618)
    static let border = Color.dynamic(light: 0xE5E5E0, dark: 0x2C2C31)
    static let borderStrong = Color.dynamic(light: 0xD4D4CE, dark: 0x3A3A40)

    // MARK: Text
    static let ink = Color.dynamic(light: 0x131215, dark: 0xEDEDEE)
    static let textDim = Color.dynamic(light: 0x4A4A4F, dark: 0xB4B4BA)
    static let textFaint = Color.dynamic(light: 0x6B6B70, dark: 0x8E8E95)

    // MARK: Accent
    /// Lime: primary button fill, brand mark, live dot. Never text on white.
    static let lime = Color(hex: 0xA5FF11)
    static let limePressed = Color(hex: 0xB4FF3A)
    /// Text and icons placed on lime — ink in both modes.
    static let onLime = Color(hex: 0x131215)
    static let accentSoft = Color.dynamic(light: 0xF0FFD6, dark: 0x24311A)
    /// Lime-family text on surfaces; selected borders; tab tint.
    static let accentInk = Color.dynamic(light: 0x4A7300, dark: 0xA5FF11)

    // MARK: Status
    static let danger = Color.dynamic(light: 0xC62828, dark: 0xFF7B7B)
    static let dangerSoft = Color.dynamic(light: 0xFDECEC, dark: 0x3A1E1E)
    static let warning = Color.dynamic(light: 0x9A5B00, dark: 0xF2B45A)
    static let warningSoft = Color.dynamic(light: 0xFFF4E0, dark: 0x352A17)
    static let info = Color.dynamic(light: 0x1D5FBF, dark: 0x7FB0FF)
    static let infoSoft = Color.dynamic(light: 0xEAF1FC, dark: 0x1B2638)
    static let success = Color.dynamic(light: 0x2F7A00, dark: 0x8FE04A)
    static let successSoft = Color.dynamic(light: 0xEEF8E4, dark: 0x1F2D16)

    /// The 1px edge on lime fills (buttons, brand mark).
    static let limeEdge = Color.black.opacity(0.06)
    /// Focus ring around a focused input.
    static let ring = Color(hex: 0xA5FF11).opacity(0.45)
    /// Ink-tinted card shadow (shadow-xs).
    static let shadow = Color(hex: 0x131215).opacity(0.05)

    // MARK: Metrics
    enum Radius {
        static let control: CGFloat = 8
        static let tile: CGFloat = 9
        static let callout: CGFloat = 10
        static let card: CGFloat = 14
        static let id: CGFloat = 6
    }

    enum Space {
        /// Screen gutter.
        static let gutter: CGFloat = 16
        /// Inside a card.
        static let card: CGFloat = 20
        /// Between cards.
        static let stack: CGFloat = 16
    }

    // MARK: Type (system font; Power Grotesk is not licensed for embedding)
    enum Typeface {
        static let pageTitle = Font.system(size: 26, weight: .bold)
        static let title = Font.system(size: 20, weight: .bold)
        static let brand = Font.system(size: 17, weight: .bold)
        static let h2 = Font.system(size: 16, weight: .semibold)
        static let section = Font.system(size: 15, weight: .semibold)
        static let body = Font.system(size: 15)
        static let bodySmall = Font.system(size: 14)
        static let label = Font.system(size: 13, weight: .medium)
        static let hint = Font.system(size: 13)
        static let meta = Font.system(size: 12.5)
        static let badge = Font.system(size: 12, weight: .medium)
        static let eyebrow = Font.system(size: 12, weight: .medium)
        static let mono = Font.system(size: 12.5, design: .monospaced)
    }
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity)
    }

    /// A colour that follows the system appearance.
    static func dynamic(light: UInt32, dark: UInt32) -> Color {
        #if canImport(UIKit)
        return Color(UIColor { traits in
            UIColor(Color(hex: traits.userInterfaceStyle == .dark ? dark : light))
        })
        #elseif canImport(AppKit)
        return Color(NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            return NSColor(Color(hex: isDark ? dark : light))
        })
        #else
        return Color(hex: light)
        #endif
    }
}

extension Text {
    /// 12pt, medium, uppercase, tracked — section labels and menu heads.
    func eyebrow() -> some View {
        self.font(Cal.Typeface.eyebrow)
            .textCase(.uppercase)
            .tracking(0.5)
            .foregroundStyle(Cal.textFaint)
    }
}
