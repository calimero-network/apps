import MerrariaCore
import SwiftUI
import UIKit

/// The Calimero light style for the shell: lime accent fills with ink text on them, near-black
/// ink, white and very light grey surfaces, hairline borders. The game keeps its own look; its
/// controls are dark glass with lime when held. Same values as the Android app's `MerrariaTheme`.
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

    /// The game's own night-sky ground (`app/index.html`), behind the page while it loads.
    static let gameGround = Color(hex: 0x0B140E)
    /// On-screen controls: dark glass, a white hairline, white icons; lime while held.
    static let control = Color(hex: 0x0B0B0C, alpha: 0.42)
    static let controlLine = Color(hex: 0xFFFFFF, alpha: 0.28)

    static let radius: CGFloat = 16
    static let hairline: CGFloat = 0.75

    static func heading(_ size: CGFloat) -> Font { .system(size: size, weight: .semibold) }
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
            .background(
                RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).fill(Theme.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
                    .strokeBorder(Theme.line, lineWidth: Theme.hairline)
            )
    }

    /// A list row that draws its own card: no separator, no inset background.
    func plainRow() -> some View {
        listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
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
                    .fill(configuration.isPressed ? Theme.sunken : Theme.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.line, lineWidth: 1)
            )
            .opacity(isEnabled ? 1 : 0.45)
    }
}

/// The app mark: the web app's grass block and pickaxe (`app/public/favicon.svg`).
struct AppMark: View {
    var size: CGFloat = 56

    var body: some View {
        Image("AppMark")
            .resizable()
            .interpolation(.high)
            .aspectRatio(contentMode: .fit)
            .frame(width: size, height: size)
            .accessibilityHidden(true)
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

/// One hotbar tile's colour swatch, as the web HUD draws it.
struct TileSwatch: View {
    let color: UInt32
    var size: CGFloat = 20

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.18, style: .continuous)
            .fill(Color(hex: color))
            .frame(width: size, height: size)
            .overlay(
                RoundedRectangle(cornerRadius: size * 0.18, style: .continuous)
                    .strokeBorder(Color.black.opacity(0.25), lineWidth: 0.75))
    }
}

enum Haptics {
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func soft() { UIImpactFeedbackGenerator(style: .soft).impactOccurred() }
    static func select() { UISelectionFeedbackGenerator().selectionChanged() }
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func warning() { UINotificationFeedbackGenerator().notificationOccurred(.warning) }
}

/// The system share sheet.
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Self.Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Self.Context) {}
}

struct SharedLink: Identifiable {
    let url: String
    var id: String { url }
}
