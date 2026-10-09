import SwiftUI

/// Calimero light design tokens — the same palette the light web apps ship
/// (`apps/mero-vote` / `apps/mero-forum` `index.css`, 2026-10-06 redesign).
///
/// Rules that come with them:
/// - Lime (`accent`) is a FILL, never text on white: it fails contrast. Text in
///   the lime family on a light surface is `accentInk`; text on a lime fill is
///   `ink`.
/// - Cards are white with a 1px hairline and at most an extra-small shadow.
/// - The system font throughout (SF Pro / SF Mono). Power Grotesk is commercial
///   and has no app-embedding licence, so it is deliberately not bundled.
enum Theme {
    // ── Surfaces ─────────────────────────────────────────────────────────────
    static let bg = Color(hex: 0xF6F6F3)
    static let bgSubtle = Color(hex: 0xEFEFEB)
    static let surface = Color(hex: 0xFFFFFF)
    static let surfaceHover = Color(hex: 0xF3F3F0)
    static let surfaceSunken = Color(hex: 0xF1F1EE)

    // ── Lines ────────────────────────────────────────────────────────────────
    static let border = Color(hex: 0xE5E5E0)
    static let borderStrong = Color(hex: 0xD4D4CE)
    /// 1px edge on lime fills (buttons, brand mark).
    static let limeEdge = Color.black.opacity(0.06)

    // ── Text ─────────────────────────────────────────────────────────────────
    static let ink = Color(hex: 0x131215)
    static let textDim = Color(hex: 0x4A4A4F)
    static let textFaint = Color(hex: 0x6B6B70)

    // ── Accent ───────────────────────────────────────────────────────────────
    static let accent = Color(hex: 0xA5FF11)
    static let accentPressed = Color(hex: 0xB4FF3A)
    static let accentSoft = Color(hex: 0xF0FFD6)
    static let accentInk = Color(hex: 0x4A7300)
    static let focusRing = Color(hex: 0xA5FF11).opacity(0.45)

    // ── Status ───────────────────────────────────────────────────────────────
    static let danger = Color(hex: 0xC62828)
    static let dangerSoft = Color(hex: 0xFDECEC)
    static let warning = Color(hex: 0x9A5B00)
    static let warningSoft = Color(hex: 0xFFF4E0)
    static let info = Color(hex: 0x1D5FBF)
    static let infoSoft = Color(hex: 0xEAF1FC)
    static let success = Color(hex: 0x2F7A00)
    static let successSoft = Color(hex: 0xEEF8E4)

    static let overlay = Color(hex: 0x131215).opacity(0.32)

    // ── Shape & spacing ──────────────────────────────────────────────────────
    enum Radius {
        static let control: CGFloat = 8
        static let tile: CGFloat = 9
        static let callout: CGFloat = 10
        static let card: CGFloat = 14
    }

    /// Screen gutter on a phone.
    static let gutter: CGFloat = 16
    static let cardPadding: CGFloat = 20

    /// Colour placed objects get by default — the brand lime, so a new object
    /// reads as "ours" against a real room.
    static let objectColorHex = "A5FF11"
}

extension Color {
    /// `Color(hex: 0xF6F6F3)` — sRGB, opaque.
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1)
    }
}

/// Deterministic avatar tones (forum `index.css`): hash(id) % 6.
enum AvatarTone {
    private static let tones: [(bg: UInt32, fg: UInt32)] = [
        (0xF0FFD6, 0x4A7300),
        (0xE6EEFB, 0x1D4F9F),
        (0xFBE9E4, 0x9A3412),
        (0xEFE8FB, 0x5B3AA8),
        (0xFDF3DC, 0x8A5300),
        (0xE2F4F1, 0x116A5C),
    ]

    static func colors(for id: String) -> (bg: Color, fg: Color) {
        // FNV-1a: stable across launches, unlike `hashValue`.
        var hash: UInt32 = 2_166_136_261
        for byte in id.utf8 {
            hash ^= UInt32(byte)
            hash = hash &* 16_777_619
        }
        let tone = tones[Int(hash % UInt32(tones.count))]
        return (Color(hex: tone.bg), Color(hex: tone.fg))
    }
}
