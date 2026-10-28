import IssueTrackerCore
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

    /// Status dots, as on the web (`--it-open`, `--it-high`, `--it-urgent`, `--it-done`).
    static func status(_ status: String) -> Color {
        switch status {
        case "In progress": return Color(hex: 0xB86E0F)
        case "Blocked": return Color(hex: 0xD0384D)
        case "Done": return Color(hex: 0x1F9A5B)
        default: return Color(hex: 0x7A8094)
        }
    }

    static func priority(_ priority: String) -> Color {
        switch priority {
        case "urgent": return Color(hex: 0xD0384D)
        case "high": return Color(hex: 0xB86E0F)
        case "medium": return Color(hex: 0x4F6FA3)
        default: return text3
        }
    }

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

struct StatusDot: View {
    let status: String
    var size: CGFloat = 9

    var body: some View {
        Circle().fill(Theme.status(status)).frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// Three ascending bars filled by priority; urgent is a tinted square with a bang.
struct PriorityGlyph: View {
    let priority: String
    var size: CGFloat = 15

    var body: some View {
        Group {
            if priority == "urgent" {
                Image(systemName: "exclamationmark")
                    .font(.system(size: size * 0.6, weight: .heavy))
                    .foregroundStyle(.white)
                    .frame(width: size, height: size)
                    .background(Theme.priority("urgent"), in: RoundedRectangle(cornerRadius: 4))
            } else {
                let filled = ["low": 1, "medium": 2, "high": 3][priority] ?? 0
                HStack(alignment: .bottom, spacing: 1.5) {
                    ForEach(0..<3, id: \.self) { i in
                        RoundedRectangle(cornerRadius: 1.5)
                            .fill(i < filled ? Theme.priority(priority) : Theme.lineStrong)
                            .frame(width: 3, height: [5, 8, 11][i])
                    }
                }
                .frame(width: size, height: size, alignment: .bottom)
            }
        }
        .accessibilityLabel("Priority \(priority)")
    }
}

struct LabelChip: View {
    let label: String
    var onRemove: (() -> Void)?

    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(Theme.swatches[TrackerFormat.labelSwatch(label)]).frame(width: 7, height: 7)
            Text(label).font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.text2).lineLimit(1)
            if let onRemove {
                Button(action: onRemove) {
                    Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).foregroundStyle(Theme.text3)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Remove label \(label)")
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Theme.sunken, in: Capsule())
    }
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
                .background(Theme.swatches[TrackerFormat.swatch(seed: seed)], in: Circle())
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
