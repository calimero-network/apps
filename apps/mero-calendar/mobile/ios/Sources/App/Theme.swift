import SwiftUI
import UIKit

/// Calimero light: lime fills with ink on them, near-black ink text, white and
/// very light grey surfaces, hairline borders, rounded cards.
enum Theme {
    static let lime = Color(hex: 0xA5FF11)
    static let ink = Color(hex: 0x0B0B0C)
    static let ground = Color(hex: 0xF6F7F8)
    static let surface = Color.white
    static let sunken = Color(hex: 0xF0F1F3)
    static let line = Color(hex: 0x0B0B0C).opacity(0.08)
    static let muted = Color(hex: 0x6B6F76)
    static let faint = Color(hex: 0x9A9EA6)
    static let danger = Color(hex: 0xE5484D)
    static let now = Color(hex: 0xE5484D)

    static let cardRadius: CGFloat = 14
    static let fieldRadius: CGFloat = 12

    static func heading(_ size: CGFloat) -> Font { .system(size: size, weight: .semibold) }
    static func body(_ size: CGFloat = 15, _ weight: Font.Weight = .regular) -> Font { .system(size: size, weight: weight) }

    /// "CALENDARS"-style section label.
    static func label(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.system(size: 11, weight: .semibold))
            .tracking(0.8)
            .foregroundStyle(muted)
    }

    /// An event color from its `#rrggbb` string.
    static func eventColor(_ hex: String) -> Color {
        let digits = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return Color(hex: 0x3B6FE0) }
        return Color(hex: value)
    }

    static func haptic(_ style: UIImpactFeedbackGenerator.FeedbackStyle = .medium) {
        UIImpactFeedbackGenerator(style: style).impactOccurred()
    }

    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
}

extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(
            .sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255, opacity: alpha)
    }
}

// MARK: - Buttons

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
            .background(Theme.lime.opacity(enabled ? 1 : 0.45), in: RoundedRectangle(cornerRadius: Theme.fieldRadius))
            .opacity(configuration.isPressed ? 0.8 : 1)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
    }
}

/// White with a hairline: the secondary action.
struct SecondaryButtonStyle: ButtonStyle {
    var fullWidth = true

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.body(16, .semibold))
            .foregroundStyle(Theme.ink)
            .padding(.horizontal, 20)
            .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: 50)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.fieldRadius))
            .overlay(RoundedRectangle(cornerRadius: Theme.fieldRadius).stroke(Theme.line, lineWidth: 1))
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

/// A small rounded pill ("Today").
struct PillButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.body(13, .semibold))
            .foregroundStyle(Theme.ink)
            .padding(.horizontal, 12)
            .frame(height: 30)
            .background(Theme.surface, in: Capsule())
            .overlay(Capsule().stroke(Theme.line, lineWidth: 1))
            .opacity(configuration.isPressed ? 0.6 : 1)
    }
}

// MARK: - Surfaces

extension View {
    /// A white card with a hairline border.
    func card(padding: CGFloat = 16) -> some View {
        self.padding(padding)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.cardRadius))
            .overlay(RoundedRectangle(cornerRadius: Theme.cardRadius).stroke(Theme.line, lineWidth: 1))
    }

    /// A text field's frame.
    func fieldStyle() -> some View {
        self.font(Theme.body(16))
            .padding(.horizontal, 14)
            .frame(minHeight: 48)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.fieldRadius))
            .overlay(RoundedRectangle(cornerRadius: Theme.fieldRadius).stroke(Theme.line, lineWidth: 1))
    }
}

/// The app mark: a lime tile with the calendar symbol.
struct AppMark: View {
    var size: CGFloat = 64
    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.28)
            .fill(Theme.lime)
            .frame(width: size, height: size)
            .overlay(
                Image(systemName: "calendar")
                    .font(.system(size: size * 0.46, weight: .semibold))
                    .foregroundStyle(Theme.ink))
    }
}

/// A small lime tile with a symbol, leading a card row.
struct IconTile: View {
    let symbol: String
    var size: CGFloat = 40
    var body: some View {
        RoundedRectangle(cornerRadius: 10)
            .fill(Theme.lime)
            .frame(width: size, height: size)
            .overlay(Image(systemName: symbol).font(.system(size: size * 0.45, weight: .semibold)).foregroundStyle(Theme.ink))
    }
}

/// An empty, signed-out or failed state: an icon, a title, a line, actions.
struct EmptyStateView<Actions: View>: View {
    let symbol: String
    let title: String
    let message: String
    @ViewBuilder var actions: () -> Actions

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 30, weight: .regular))
                .foregroundStyle(Theme.muted)
                .frame(width: 64, height: 64)
                .background(Theme.sunken, in: Circle())
            Text(title).font(Theme.heading(18)).foregroundStyle(Theme.ink)
            Text(message).font(Theme.body(15)).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
            VStack(spacing: 10) { actions() }.padding(.top, 8)
        }
        .padding(24)
        .frame(maxWidth: .infinity)
    }
}

/// An error (or warning) line with an optional retry.
struct Banner: View {
    let text: String
    var isError = true
    var retry: (() -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: isError ? "exclamationmark.circle.fill" : "info.circle.fill")
                .foregroundStyle(isError ? Theme.danger : Theme.ink)
            Text(text).font(Theme.body(14)).foregroundStyle(Theme.ink).frame(maxWidth: .infinity, alignment: .leading)
            if let retry {
                Button("Try again", action: retry).font(Theme.body(14, .semibold)).foregroundStyle(Theme.ink)
            }
        }
        .padding(12)
        .background(isError ? Theme.danger.opacity(0.08) : Theme.lime.opacity(0.25), in: RoundedRectangle(cornerRadius: 12))
    }
}

/// Technical ids behind a disclosure.
struct DetailsDisclosure: View {
    let rows: [(String, String)]
    @State private var open = false

    var body: some View {
        DisclosureGroup(isExpanded: $open) {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(rows, id: \.0) { row in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.0).font(Theme.body(12, .semibold)).foregroundStyle(Theme.muted)
                        Text(row.1).font(.system(size: 12, design: .monospaced)).foregroundStyle(Theme.ink)
                            .textSelection(.enabled)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 8)
        } label: {
            Label("Details", systemImage: "info.circle").font(Theme.body(14, .semibold)).foregroundStyle(Theme.ink)
        }
        .tint(Theme.ink)
    }
}

/// A round avatar with an initial.
struct Avatar: View {
    let name: String
    var size: CGFloat = 36
    var body: some View {
        Circle()
            .fill(Theme.lime.opacity(0.35))
            .frame(width: size, height: size)
            .overlay(
                Text(String(name.prefix(1)).uppercased())
                    .font(.system(size: size * 0.42, weight: .semibold))
                    .foregroundStyle(Theme.ink))
    }
}
