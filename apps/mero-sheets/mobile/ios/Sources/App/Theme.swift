import SheetsCore
import SwiftUI
import UIKit

/// The Calimero light look: lime fills with ink on them, near-black text, white
/// cards with hairline borders on a very light grey ground.
enum Theme {
    static let lime = Color(hex: 0xA5FF11)
    static let ink = Color(hex: 0x0B0B0C)
    static let ground = Color(hex: 0xF5F6F8)
    static let surface = Color.white
    static let sunken = Color(hex: 0xF0F1F4)
    static let line = Color(hex: 0xE3E5EA)
    static let lineStrong = Color(hex: 0xCDD0D7)
    static let text2 = Color(hex: 0x4A4D55)
    static let text3 = Color(hex: 0x868B95)
    static let danger = Color(hex: 0xC2304A)

    static let radius: CGFloat = 14
    static let gutter: CGFloat = 16

    /// Chart series, in the web's categorical order (`--c-series-1…8` in `app/src/index.css`).
    static let series: [Color] = [0x2A78D6, 0xEB6834, 0x1BAF7A, 0xEDA100, 0xE87BA4, 0x008300, 0x4A3AA7, 0xE34948]
        .map { Color(hex: $0) }

    /// Grid chrome: header fill and the selected-header tint.
    static let header = Color(hex: 0xF5F6F8)
    static let cellFont = Font.system(size: 13, design: .monospaced)

    /// The web's eight label/avatar swatches.
    static let swatches: [Color] = [0xA5FF3F, 0x5FA8D3, 0xC77DBB, 0x8B9AA8, 0x6E8BB5, 0xE0A04B, 0x7FC96B, 0xB47FD6]
        .map { Color(hex: $0) }

    static func heading(_ size: CGFloat) -> Font { .system(size: size, weight: .semibold) }
    static let mono = Font.system(size: 12, design: .monospaced)

    static func haptic(_ style: UIImpactFeedbackGenerator.FeedbackStyle = .medium) {
        UIImpactFeedbackGenerator(style: style).impactOccurred()
    }

    static func success() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255)
    }
}

/// Lime fill, ink text: every primary action.
struct PrimaryButtonStyle: ButtonStyle {
    var fullWidth = true
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(Theme.ink)
            .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: 50)
            .padding(.horizontal, fullWidth ? 0 : 20)
            .background(Theme.lime.opacity(isEnabled ? 1 : 0.45), in: RoundedRectangle(cornerRadius: Theme.radius))
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}

/// White, hairline: secondary actions.
struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(Theme.ink)
            .frame(maxWidth: .infinity, minHeight: 50)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.radius))
            .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.line, lineWidth: 1))
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

struct CardModifier: ViewModifier {
    var padding: CGFloat = 16

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.radius))
            .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.line, lineWidth: 0.75))
    }
}

extension View {
    func card(padding: CGFloat = 16) -> some View { modifier(CardModifier(padding: padding)) }
}

/// A round initial for a person (assignee free text, or an account key).
struct Avatar: View {
    let seed: String?
    var size: CGFloat = 24

    var body: some View {
        if let seed, !seed.isEmpty {
            Text(String(seed.prefix(1)).lowercased())
                .font(.system(size: size * 0.48, weight: .semibold))
                .foregroundStyle(Theme.ink)
                .frame(width: size, height: size)
                .background(Theme.swatches[SheetsFormat.swatch(seed: seed)], in: Circle())
                .accessibilityHidden(true)
        } else {
            Image(systemName: "person.crop.circle")
                .font(.system(size: size * 0.75))
                .foregroundStyle(Theme.text3)
                .frame(width: size, height: size)
                .accessibilityHidden(true)
        }
    }
}

struct Pill: View {
    let text: String
    var mono = false

    var body: some View {
        Text(text)
            .font(mono ? Theme.mono : .system(size: 12, weight: .semibold))
            .foregroundStyle(Theme.text2)
            .padding(.horizontal, 9)
            .padding(.vertical, 4)
            .background(Theme.sunken, in: Capsule())
    }
}

/// Empty, loading-failed and first-run states: an icon, a line, a reason, an action.
struct EmptyState: View {
    let icon: String
    let title: String
    let message: String
    var action: (title: String, run: () -> Void)?

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 26, weight: .medium))
                .foregroundStyle(Theme.ink)
                .frame(width: 60, height: 60)
                .background(Theme.lime.opacity(0.35), in: RoundedRectangle(cornerRadius: 18))
            Text(title).font(Theme.heading(19)).foregroundStyle(Theme.ink).multilineTextAlignment(.center)
            Text(message).font(.system(size: 15)).foregroundStyle(Theme.text2).multilineTextAlignment(.center)
            if let action {
                Button(action.title, action: action.run)
                    .buttonStyle(PrimaryButtonStyle(fullWidth: false))
                    .padding(.top, 6)
            }
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// A failure over content that is still on screen.
struct NoticeBanner: View {
    let text: String
    let dismiss: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle").foregroundStyle(Theme.danger)
            Text(text).font(.system(size: 14)).foregroundStyle(Theme.ink).frame(maxWidth: .infinity, alignment: .leading)
            Button(action: dismiss) { Image(systemName: "xmark").foregroundStyle(Theme.text3) }
                .accessibilityLabel("Dismiss")
        }
        .card(padding: 12)
        .padding(.horizontal, Theme.gutter)
        .transition(.move(edge: .top).combined(with: .opacity))
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
                        Text(row.0).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.text3)
                        Text(row.1).font(Theme.mono).foregroundStyle(Theme.text2).textSelection(.enabled)
                    }
                }
            }
            .padding(.top, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
        } label: {
            Label("Details", systemImage: "info.circle").font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.text2)
        }
        .tint(Theme.text2)
    }
}

extension CloudStyle {
    /// The sign-in and approvals views in Mero Sheets' colours.
    static let app = CloudStyle(
        ink: Theme.ink, muted: Theme.text2, accent: Theme.lime, onAccent: Theme.ink, danger: Theme.danger,
        field: Theme.surface, hairline: Theme.lineStrong)
}
