import SwiftUI

#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Mero Tag's design tokens: a map-first, modern look. Cool neutrals, a
/// vivid indigo→violet accent (``accentGradient``) for actions and the brand,
/// mint for "live", generous radii and rounded type. Every colour has a dark
/// variant, so the app follows the system setting.
enum Tag {
    // MARK: Surfaces
    static let bg = Color.dynamic(light: 0xF3F4F8, dark: 0x0A0B10)
    static let bgSubtle = Color.dynamic(light: 0xEAECF3, dark: 0x171922)
    static let surface = Color.dynamic(light: 0xFFFFFF, dark: 0x13151D)
    static let surfaceHover = Color.dynamic(light: 0xF2F3F8, dark: 0x1C1F2A)
    static let surfaceSunken = Color.dynamic(light: 0xEEF0F6, dark: 0x0F1118)
    static let border = Color.dynamic(light: 0xE4E6EE, dark: 0x252836)
    static let borderStrong = Color.dynamic(light: 0xD3D6E2, dark: 0x343849)

    // MARK: Text
    static let ink = Color.dynamic(light: 0x0D0F1A, dark: 0xF3F4F8)
    static let textDim = Color.dynamic(light: 0x464B5E, dark: 0xB7BBCB)
    static let textFaint = Color.dynamic(light: 0x6E7387, dark: 0x8A8FA3)

    // MARK: Accent
    /// Indigo: the brand and primary actions. White text on it.
    static let accent = Color(hex: 0x5B4BFF)
    static let accentPressed = Color(hex: 0x4A3AE8)
    static let accentViolet = Color(hex: 0x9B5CFF)
    /// Text and icons placed on the accent.
    static let onAccent = Color.white
    static let accentSoft = Color.dynamic(light: 0xECEAFF, dark: 0x1F1B45)
    /// Accent-family text on surfaces; selected borders; tab tint.
    static let accentInk = Color.dynamic(light: 0x4A39F0, dark: 0xA99EFF)
    /// The brand gradient: buttons, the mark, the hero.
    static let accentGradient = LinearGradient(
        colors: [Color(hex: 0x5B4BFF), Color(hex: 0x9B5CFF)], startPoint: .topLeading, endPoint: .bottomTrailing)
    /// Live / sharing now.
    static let live = Color(hex: 0x14C99A)
    static let liveSoft = Color.dynamic(light: 0xDDF8EF, dark: 0x0F2C25)

    // MARK: Status
    static let danger = Color.dynamic(light: 0xE0283C, dark: 0xFF7A88)
    static let dangerSoft = Color.dynamic(light: 0xFDECEE, dark: 0x3A1820)
    static let warning = Color.dynamic(light: 0xB25E00, dark: 0xFFB65C)
    static let warningSoft = Color.dynamic(light: 0xFFF3E2, dark: 0x352512)
    static let info = Color.dynamic(light: 0x2563EB, dark: 0x82AFFF)
    static let infoSoft = Color.dynamic(light: 0xE8F0FE, dark: 0x16223A)
    static let success = Color.dynamic(light: 0x0E9F78, dark: 0x4FE0B4)
    static let successSoft = Color.dynamic(light: 0xDDF8EF, dark: 0x0F2C25)

    /// The edge on accent fills (buttons, brand mark).
    static let accentEdge = Color.white.opacity(0.18)
    /// Focus ring around a focused input.
    static let ring = Color(hex: 0x5B4BFF).opacity(0.35)
    /// Soft, cool card shadow.
    static let shadow = Color(hex: 0x1A1F3D).opacity(0.08)

    // MARK: Metrics
    enum Radius {
        static let control: CGFloat = 14
        static let tile: CGFloat = 12
        static let callout: CGFloat = 14
        static let card: CGFloat = 22
        static let id: CGFloat = 8
    }

    enum Space {
        /// Screen gutter.
        static let gutter: CGFloat = 18
        /// Inside a card.
        static let card: CGFloat = 20
        /// Between cards.
        static let stack: CGFloat = 18
    }

    // MARK: Type (SF Pro Rounded for display, SF Pro for text)
    enum Typeface {
        static let display = Font.system(size: 40, weight: .heavy, design: .rounded)
        static let pageTitle = Font.system(size: 30, weight: .bold, design: .rounded)
        static let title = Font.system(size: 22, weight: .bold, design: .rounded)
        static let brand = Font.system(size: 18, weight: .bold, design: .rounded)
        static let h2 = Font.system(size: 17, weight: .semibold)
        static let section = Font.system(size: 16, weight: .semibold)
        static let body = Font.system(size: 16)
        static let bodySmall = Font.system(size: 14.5)
        static let label = Font.system(size: 13.5, weight: .semibold)
        static let hint = Font.system(size: 13)
        static let meta = Font.system(size: 13)
        static let badge = Font.system(size: 12, weight: .semibold)
        static let eyebrow = Font.system(size: 12, weight: .bold)
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
        self.font(Tag.Typeface.eyebrow)
            .textCase(.uppercase)
            .tracking(0.8)
            .foregroundStyle(Tag.textFaint)
    }
}
