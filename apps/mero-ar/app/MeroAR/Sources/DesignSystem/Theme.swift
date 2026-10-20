import SwiftUI

/// Mero AR's own look: a dark, spatial-computing UI. Deep space background,
/// glass panels that read over a camera feed, an aurora gradient (violet →
/// cyan) for the brand and primary actions, and bold, tightly tracked type.
///
/// Rules:
/// - Gradient is for the brand mark and the one primary action per screen.
/// - Panels are glass (`.ultraThinMaterial` over a faint white wash) with a
///   hairline highlight, never opaque cards.
/// - Text on dark is white at three strengths (`text`, `textDim`, `textFaint`).
/// - SF Symbols only. No emoji.
enum Theme {
    // ── Space ────────────────────────────────────────────────────────────────
    static let bg = Color(hex: 0x05050A)
    static let bgRaised = Color(hex: 0x0D0D16)
    static let bgSheet = Color(hex: 0x10101B)

    // ── Glass ────────────────────────────────────────────────────────────────
    static let glassFill = Color.white.opacity(0.06)
    static let glassFillStrong = Color.white.opacity(0.11)
    static let glassStroke = Color.white.opacity(0.12)
    static let glassHighlight = Color.white.opacity(0.22)

    // ── Text ─────────────────────────────────────────────────────────────────
    static let text = Color.white
    static let textDim = Color.white.opacity(0.68)
    static let textFaint = Color.white.opacity(0.45)

    // ── Aurora ───────────────────────────────────────────────────────────────
    static let violet = Color(hex: 0x8B5CF6)
    static let indigo = Color(hex: 0x6366F1)
    static let cyan = Color(hex: 0x22D3EE)
    static let pink = Color(hex: 0xF472B6)
    /// Accent for text, icons and focus on dark surfaces.
    static let accent = Color(hex: 0xA5B4FC)
    static let aurora = LinearGradient(colors: [violet, indigo, cyan], startPoint: .topLeading, endPoint: .bottomTrailing)
    static let auroraSoft = LinearGradient(
        colors: [violet.opacity(0.35), cyan.opacity(0.25)], startPoint: .topLeading, endPoint: .bottomTrailing)

    // ── Status ───────────────────────────────────────────────────────────────
    static let success = Color(hex: 0x34D399)
    static let warning = Color(hex: 0xFBBF24)
    static let danger = Color(hex: 0xF87171)
    static let info = Color(hex: 0x60A5FA)

    // ── Shape & spacing ──────────────────────────────────────────────────────
    enum Radius {
        static let control: CGFloat = 16
        static let tile: CGFloat = 14
        static let card: CGFloat = 26
        static let dock: CGFloat = 30
    }

    static let gutter: CGFloat = 20

    /// The palette an object can be painted with, as the contract stores it.
    static let objectColors: [String] = ["8B5CF6", "22D3EE", "F472B6", "FBBF24", "34D399", "F8FAFC"]
    /// A new object's colour.
    static let objectColorHex = "8B5CF6"

    // ── Type ─────────────────────────────────────────────────────────────────
    static func display(_ size: CGFloat) -> Font { .system(size: size, weight: .heavy, design: .default) }
    static func title(_ size: CGFloat = 20) -> Font { .system(size: size, weight: .bold, design: .default) }
}

extension Color {
    /// `Color(hex: 0x05050A)`: sRGB, opaque.
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1)
    }

    /// `Color(hexString: "8B5CF6")`, `#` optional; violet when unparseable.
    init(hexString: String) {
        var s = hexString.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        self.init(hex: s.count == 6 ? UInt32(s, radix: 16) ?? 0x8B5CF6 : 0x8B5CF6)
    }
}

/// Deterministic avatar gradients: hash(id) picks one of six.
enum AvatarTone {
    private static let tones: [(UInt32, UInt32)] = [
        (0x8B5CF6, 0x22D3EE), (0xF472B6, 0x8B5CF6), (0x22D3EE, 0x34D399),
        (0xFBBF24, 0xF472B6), (0x6366F1, 0xF472B6), (0x34D399, 0x60A5FA),
    ]

    static func gradient(for id: String) -> LinearGradient {
        // FNV-1a: stable across launches, unlike `hashValue`.
        var hash: UInt32 = 2_166_136_261
        for byte in id.utf8 {
            hash ^= UInt32(byte)
            hash = hash &* 16_777_619
        }
        let tone = tones[Int(hash % UInt32(tones.count))]
        return LinearGradient(
            colors: [Color(hex: tone.0), Color(hex: tone.1)], startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}
