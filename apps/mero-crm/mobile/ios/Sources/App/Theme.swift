import CrmCore
import SwiftUI
import UIKit

/// Calimero light: near-black ink on white and light grey, hairline borders,
/// lime as the one accent fill with ink text on it. The CRM's status colours
/// (won, at risk, overdue) are the web app's `--crm-done/high/urgent`.
enum Palette {
    static let ink = Color(hex: 0x0B0B0C)
    static let ink2 = Color(hex: 0x5B5E66)
    static let ink3 = Color(hex: 0x8E9199)
    static let background = Color(hex: 0xF6F7F8)
    static let surface = Color.white
    static let sunken = Color(hex: 0xEFF0F2)
    static let hairline = Color(hex: 0xE3E5E8)
    static let lime = Color(hex: 0xA5FF11)
    static let limeSoft = Color(hex: 0xEEFFD0)
    static let good = Color(hex: 0x1F9A5B)
    static let goodSoft = Color(hex: 0xE6F5EC)
    static let warn = Color(hex: 0xB86E0F)
    static let warnSoft = Color(hex: 0xFBF0E1)
    static let danger = Color(hex: 0xD0384D)
    static let dangerSoft = Color(hex: 0xFCEBED)

    static func health(_ level: HealthLevel) -> Color {
        switch level {
        case .healthy: return good
        case .atRisk: return warn
        case .critical: return danger
        }
    }

    static func tone(_ tone: DueTone) -> (Color, Color) {
        switch tone {
        case .overdue: return (danger, dangerSoft)
        case .today: return (ink, lime)
        case .soon: return (ink, sunken)
        case .later: return (ink2, sunken)
        }
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255)
    }
}

enum Haptics {
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func error() { UINotificationFeedbackGenerator().notificationOccurred(.error) }
}

/// SF Symbols for the activity kinds (Material twins in the Android app's Theme.kt).
enum Icons {
    static func kind(_ raw: String) -> String {
        switch ActivityKind(rawValue: raw) {
        case .call: return "phone"
        case .meeting: return "calendar"
        case .task: return "checkmark.square"
        case .email: return "envelope"
        case .deadline: return "flag"
        case nil: return "circle"
        }
    }
}

// MARK: - Buttons

struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(Palette.ink)
            .frame(maxWidth: .infinity, minHeight: 50)
            .padding(.horizontal, 16)
            .background(Palette.lime.opacity(isEnabled ? 1 : 0.45), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    var tint: Color = Palette.ink
    var compact = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font((compact ? Font.subheadline : .body).weight(.semibold))
            .foregroundStyle(tint.opacity(isEnabled ? 1 : 0.4))
            .frame(maxWidth: .infinity, minHeight: compact ? 38 : 46)
            .padding(.horizontal, compact ? 10 : 14)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Palette.hairline, lineWidth: 1))
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

/// A small lime pill button, for "Schedule in 2d".
struct SmallPrimaryStyle: ButtonStyle {
    var filled = true
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.footnote.weight(.semibold))
            .foregroundStyle(Palette.ink)
            .padding(.horizontal, 12)
            .frame(minHeight: 32)
            .background(filled ? Palette.lime : Palette.sunken, in: Capsule())
            .opacity(configuration.isPressed ? 0.75 : 1)
    }
}

/// A selectable pill: filters, kinds, stages.
struct Chip: View {
    let title: String
    var icon: String?
    var count: Int?
    var selected = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let icon { Image(systemName: icon).font(.footnote.weight(.semibold)) }
                Text(title).font(.subheadline.weight(.medium)).lineLimit(1)
                if let count { Text("\(count)").font(.footnote.weight(.semibold)).foregroundStyle(selected ? Palette.ink : Palette.ink3) }
            }
            .foregroundStyle(Palette.ink)
            .padding(.horizontal, 12)
            .frame(minHeight: 34)
            .background(selected ? Palette.lime : Palette.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(selected ? Color.clear : Palette.hairline, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// A static label pill.
struct Pill: View {
    let text: String
    var icon: String?
    var fg: Color = Palette.ink2
    var bg: Color = Palette.sunken

    var body: some View {
        HStack(spacing: 4) {
            if let icon { Image(systemName: icon).font(.caption2.weight(.semibold)) }
            Text(text).font(.caption.weight(.semibold)).lineLimit(1)
        }
        .foregroundStyle(fg)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(bg, in: Capsule())
    }
}

struct StatusPill: View {
    let status: String
    var body: some View {
        switch status {
        case "won": Pill(text: "Won", icon: "checkmark", fg: Palette.good, bg: Palette.goodSoft)
        case "lost": Pill(text: "Lost", icon: "xmark", fg: Palette.danger, bg: Palette.dangerSoft)
        default: Pill(text: "Open", fg: Palette.ink, bg: Palette.limeSoft)
        }
    }
}

/// When the next step is due, with its kind.
struct DueChip: View {
    let kind: String
    let dueAt: UInt64
    var subject: String?
    @EnvironmentObject private var model: PipelineModel

    var body: some View {
        let label = Days.dueLabel(Days.date(dueAt), now: model.now(), model.calendar)
        let (fg, bg) = Palette.tone(label.tone)
        HStack(spacing: 4) {
            Image(systemName: Icons.kind(kind)).font(.caption2.weight(.semibold))
            Text(subject.map { "\(label.text) · \($0)" } ?? label.text).font(.caption.weight(.semibold)).lineLimit(1)
        }
        .foregroundStyle(fg)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(bg, in: Capsule())
    }
}

struct HealthDot: View {
    let health: DealHealth
    var body: some View {
        Circle().fill(Palette.health(health.level)).frame(width: 8, height: 8)
            .accessibilityLabel("Health \(health.score), \(health.level.label)")
    }
}

// MARK: - Cards and labels

struct Card<Content: View>: View {
    var padding: CGFloat = 16
    var spacing: CGFloat = 12
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: spacing) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(padding)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Palette.hairline, lineWidth: 0.5))
    }
}

struct CardTitle: View {
    let title: String
    var icon: String?
    var trailing: String?

    var body: some View {
        HStack(spacing: 8) {
            if let icon { Image(systemName: icon).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink) }
            Text(title).font(.headline).foregroundStyle(Palette.ink)
            Spacer()
            if let trailing { Text(trailing).font(.footnote.weight(.semibold)).foregroundStyle(Palette.ink3) }
        }
    }
}

struct SectionLabel: View {
    let title: String
    var trailing: String?
    var color: Color = Palette.ink2

    var body: some View {
        HStack {
            Text(title.uppercased()).font(.footnote.weight(.semibold)).tracking(0.6).foregroundStyle(color)
            Spacer()
            if let trailing { Text(trailing).font(.footnote).foregroundStyle(Palette.ink3) }
        }
        .padding(.horizontal, 4)
        .padding(.top, 8)
    }
}

/// Initials on a soft colour from the seed.
struct Avatar: View {
    let seed: String
    var size: CGFloat = 36

    var body: some View {
        let hue = Double(Self.hue(seed)) / 360
        Text(Self.initials(seed))
            .font(.system(size: size * 0.38, weight: .semibold))
            .foregroundStyle(Color(hue: hue, saturation: 0.6, brightness: 0.35))
            .frame(width: size, height: size)
            .background(Color(hue: hue, saturation: 0.25, brightness: 0.96), in: Circle())
            .accessibilityHidden(true)
    }

    static func initials(_ name: String) -> String {
        let words = name.split(whereSeparator: { $0.isWhitespace }).prefix(2)
        let s = words.compactMap(\.first).map(String.init).joined().uppercased()
        return s.isEmpty ? "?" : s
    }

    static func hue(_ seed: String) -> Int {
        var h: UInt32 = 0
        for b in seed.utf8 { h = h &* 31 &+ UInt32(b) }
        return Int(h % 360)
    }
}

struct EmptyState: View {
    let icon: String
    let title: String
    var message: String?

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: icon).font(.system(size: 28, weight: .regular)).foregroundStyle(Palette.ink2)
                .frame(width: 56, height: 56)
                .background(Palette.sunken, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            Text(title).font(.headline).foregroundStyle(Palette.ink).multilineTextAlignment(.center)
            if let message {
                Text(message).font(.subheadline).foregroundStyle(Palette.ink2).multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 28)
        .padding(.horizontal, 16)
    }
}

struct ErrorLine: View {
    let message: String
    var body: some View {
        Label { Text(message) } icon: { Image(systemName: "exclamationmark.circle") }
            .font(.footnote)
            .foregroundStyle(Palette.danger)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(Palette.dangerSoft, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

/// A label above a single-line field, for the sheets.
struct Field: View {
    let label: String
    let placeholder: String
    @Binding var text: String
    var keyboard: UIKeyboardType = .default
    var capitalization: TextInputAutocapitalization = .sentences

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink2)
            TextField(placeholder, text: $text)
                .keyboardType(keyboard)
                .textInputAutocapitalization(capitalization)
                .padding(12)
                .background(Palette.surface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Palette.hairline, lineWidth: 1))
        }
    }
}

/// A labelled row that opens a menu of choices.
struct PickerField<Content: View>: View {
    let label: String
    let value: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink2)
            Menu {
                content
            } label: {
                HStack {
                    Text(value).foregroundStyle(Palette.ink).lineLimit(1)
                    Spacer()
                    Image(systemName: "chevron.up.chevron.down").font(.footnote).foregroundStyle(Palette.ink3)
                }
                .padding(12)
                .background(Palette.surface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Palette.hairline, lineWidth: 1))
            }
        }
    }
}

/// Copyable technical values, behind a "Details" disclosure.
struct DetailsDisclosure: View {
    let rows: [(String, String)]
    @EnvironmentObject private var model: PipelineModel
    @State private var open = false

    var body: some View {
        DisclosureGroup(isExpanded: $open) {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(rows, id: \.0) { label, value in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(label).font(.caption).foregroundStyle(Palette.ink2)
                        Text(value).font(.caption.monospaced()).foregroundStyle(Palette.ink).textSelection(.enabled)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        UIPasteboard.general.string = value
                        Haptics.tap()
                        model.notice = Notice("Copied")
                    }
                }
                Text("Tap a value to copy it.").font(.caption).foregroundStyle(Palette.ink3)
            }
            .padding(.top, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
        } label: {
            Text("Details").font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink2)
        }
        .tint(Palette.ink2)
        .padding(14)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Palette.hairline, lineWidth: 0.5))
    }
}

/// A key–value line in a details card.
struct InfoRow: View {
    let label: String
    let value: String
    var valueColor: Color = Palette.ink

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(.subheadline).foregroundStyle(Palette.ink2)
            Spacer(minLength: 12)
            Text(value).font(.subheadline.weight(.medium)).foregroundStyle(valueColor).multilineTextAlignment(.trailing)
        }
    }
}

/// The toast a ``PipelineModel/notice`` shows.
struct NoticeOverlay: ViewModifier {
    @Binding var notice: Notice?

    func body(content: Content) -> some View {
        content.overlay(alignment: .top) {
            if let notice {
                Label {
                    Text(notice.text).lineLimit(3)
                } icon: {
                    Image(systemName: notice.isError ? "exclamationmark.circle.fill" : "checkmark.circle.fill")
                        .foregroundStyle(notice.isError ? Palette.danger : Palette.good)
                }
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Palette.ink)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(Palette.surface, in: Capsule())
                .overlay(Capsule().strokeBorder(Palette.hairline, lineWidth: 0.5))
                .shadow(color: .black.opacity(0.08), radius: 12, y: 4)
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .transition(.move(edge: .top).combined(with: .opacity))
                .id(notice.id)
                .onTapGesture { self.notice = nil }
                .task(id: notice.id) {
                    if notice.isError { Haptics.error() }
                    try? await Task.sleep(for: .seconds(notice.isError ? 4 : 2.2))
                    withAnimation { self.notice = nil }
                }
            }
        }
        .animation(.spring(duration: 0.3), value: notice)
    }
}

extension View {
    /// The app's grey ground behind cards.
    func screenBackground() -> some View {
        background(Palette.background.ignoresSafeArea())
    }

    func notices(_ notice: Binding<Notice?>) -> some View { modifier(NoticeOverlay(notice: notice)) }
}
