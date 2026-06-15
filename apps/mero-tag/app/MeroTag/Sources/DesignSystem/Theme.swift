import SwiftUI

/// Mero Tag visual language — a cool teal→blue→indigo "live location" palette.
enum Theme {
    static let bg0 = Color(red: 0.04, green: 0.07, blue: 0.13)   // near-black navy
    static let bg1 = Color(red: 0.06, green: 0.12, blue: 0.22)

    static let accent   = Color(red: 0.18, green: 0.83, blue: 0.71) // mint
    static let accent2  = Color(red: 0.22, green: 0.52, blue: 0.98) // blue
    static let accent3  = Color(red: 0.45, green: 0.38, blue: 0.98) // indigo

    /// Gradient for primary buttons / brand fills.
    static let brand = LinearGradient(
        colors: [accent, accent2, accent3],
        startPoint: .topLeading, endPoint: .bottomTrailing)

    /// Background blobs gradient.
    static let glowA = RadialGradient(
        colors: [accent.opacity(0.55), .clear],
        center: .center, startRadius: 0, endRadius: 260)
    static let glowB = RadialGradient(
        colors: [accent3.opacity(0.55), .clear],
        center: .center, startRadius: 0, endRadius: 300)

    static let field = Color.white.opacity(0.06)
    static let stroke = Color.white.opacity(0.12)
}
