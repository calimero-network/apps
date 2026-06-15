import SwiftUI

/// Mero AR visual language — a deep indigo→purple→pink "spatial / depth" palette.
enum Theme {
    static let bg0 = Color(red: 0.06, green: 0.04, blue: 0.13)   // near-black violet
    static let bg1 = Color(red: 0.11, green: 0.07, blue: 0.22)

    static let accent  = Color(red: 0.55, green: 0.45, blue: 1.00) // violet
    static let accent2 = Color(red: 0.82, green: 0.38, blue: 0.98) // magenta
    static let accent3 = Color(red: 0.36, green: 0.78, blue: 0.99) // cyan

    static let brand = LinearGradient(
        colors: [accent3, accent, accent2],
        startPoint: .topLeading, endPoint: .bottomTrailing)

    static let glowA = RadialGradient(
        colors: [accent.opacity(0.55), .clear],
        center: .center, startRadius: 0, endRadius: 260)
    static let glowB = RadialGradient(
        colors: [accent2.opacity(0.5), .clear],
        center: .center, startRadius: 0, endRadius: 300)

    static let field = Color.white.opacity(0.06)
    static let stroke = Color.white.opacity(0.12)
}
