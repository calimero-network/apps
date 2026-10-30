import SwiftUI
import UIKit
import UpdatesCore

/// Calimero light: near-black ink on white and light grey, hairline borders,
/// lime as the one accent fill with ink text on it.
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
    static let good = Color(hex: 0x0B6B43)
    static let goodSoft = Color(hex: 0xE3F5EC)
    static let warn = Color(hex: 0x6B4E00)
    static let warnSoft = Color(hex: 0xFFF3D1)
    static let danger = Color(hex: 0xD93A2B)
    static let dangerSoft = Color(hex: 0xFDECEA)
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255)
    }

    /// A category's colour, or the faint ink when it has none.
    init(css: String) {
        if let rgb = Catalog.rgb(css) { self.init(hex: rgb) } else { self = Palette.ink3 }
    }
}

/// Power Grotesk (the web app's display face, bundled) for headings.
enum Typeface {
    static func display(_ size: CGFloat, bold: Bool = true) -> Font {
        let name = bold ? "PowerGrotesk-Bold" : "PowerGrotesk-Regular"
        if UIFont(name: name, size: size) != nil { return .custom(name, size: size) }
        return .system(size: size, weight: bold ? .semibold : .regular)
    }
}

enum Haptics {
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func error() { UINotificationFeedbackGenerator().notificationOccurred(.error) }
}

/// SF Symbols for the things the web draws with its own icons.
enum Symbols {
    static func askKind(_ kind: String) -> String {
        switch kind {
        case "intro": return "link"
        case "hire": return "briefcase"
        case "customer": return "cart"
        case "advice": return "lightbulb"
        case "fundraising": return "dollarsign.circle"
        default: return "sparkles"
        }
    }

    static func delta(_ direction: Metrics.Direction) -> String {
        switch direction {
        case .up: return "arrow.up.right"
        case .down: return "arrow.down.right"
        case .flat: return "minus"
        }
    }
}

// MARK: - Buttons

struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    var compact = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font((compact ? Font.subheadline : .body).weight(.semibold))
            .foregroundStyle(Palette.ink)
            .frame(maxWidth: compact ? nil : .infinity, minHeight: compact ? 36 : 50)
            .padding(.horizontal, compact ? 14 : 16)
            .background(
                Palette.lime.opacity(isEnabled ? 1 : 0.45),
                in: RoundedRectangle(cornerRadius: compact ? 10 : 14, style: .continuous)
            )
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
            .frame(maxWidth: compact ? nil : .infinity, minHeight: compact ? 36 : 46)
            .padding(.horizontal, compact ? 12 : 14)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: compact ? 10 : 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: compact ? 10 : 14, style: .continuous)
                    .strokeBorder(Palette.hairline, lineWidth: 1)
            )
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

/// A quiet text action: "Reply", "Edit note", "Undo".
struct LinkButton: View {
    let title: String
    var tint: Color = Palette.ink2
    let action: () -> Void

    var body: some View {
        Button(title, action: action)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(tint)
            .buttonStyle(.plain)
    }
}

/// A pill: filters, "I can help". Lime when selected.
struct Chip: View {
    let title: String
    var icon: String?
    var selected = false
    var count: UInt64 = 0
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let icon { Image(systemName: icon).font(.footnote.weight(.semibold)) }
                Text(title).font(.subheadline.weight(.medium)).lineLimit(1)
                if count > 0 {
                    Text("\(count)").font(.caption.weight(.bold)).foregroundStyle(Palette.ink2)
                }
            }
            .foregroundStyle(Palette.ink)
            .padding(.horizontal, 12)
            .frame(minHeight: 34)
            .background(selected ? Palette.lime : Palette.sunken, in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// A category: its colour dot, emoji and name.
struct CategoryChip: View {
    let category: CategoryView
    var selected = false
    var count: UInt64 = 0
    var suffix = ""
    var action: (() -> Void)?

    var body: some View {
        let label = HStack(spacing: 6) {
            Circle().fill(Color(css: category.color)).frame(width: 8, height: 8)
            if !category.emoji.isEmpty { Text(category.emoji).font(.footnote) }
            Text(category.name + suffix).font(.footnote.weight(.medium)).lineLimit(1)
            if count > 0 { Text("\(count)").font(.caption2.weight(.bold)).foregroundStyle(Palette.ink2) }
        }
        .foregroundStyle(Palette.ink)
        .padding(.horizontal, 10)
        .frame(minHeight: action == nil ? 24 : 32)
        .background(selected ? Palette.lime : Palette.sunken, in: Capsule())
        if let action {
            Button(action: action) { label }.buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
        } else {
            label
        }
    }
}

// MARK: - Cards and labels

struct Card<Content: View>: View {
    var padding: CGFloat = 16
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(padding)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Palette.hairline, lineWidth: 0.5))
    }
}

struct SectionLabel: View {
    let title: String
    var trailing: String?

    var body: some View {
        HStack {
            Text(title.uppercased()).font(.footnote.weight(.semibold)).tracking(0.6).foregroundStyle(Palette.ink2)
            Spacer()
            if let trailing { Text(trailing).font(.footnote).foregroundStyle(Palette.ink3) }
        }
        .padding(.horizontal, 4)
        .padding(.top, 8)
    }
}

/// A screen's heading and the line under it.
struct PageHeader: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(Typeface.display(28)).foregroundStyle(Palette.ink)
            Text(subtitle).font(.subheadline).foregroundStyle(Palette.ink2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 4)
    }
}

enum BadgeTone { case lime, muted, good, warn }

struct Badge: View {
    let title: String
    var tone: BadgeTone = .lime
    var icon: String?

    var body: some View {
        HStack(spacing: 4) {
            if let icon { Image(systemName: icon).font(.caption2.weight(.bold)) }
            Text(title).font(.caption.weight(.semibold))
        }
        .foregroundStyle(foreground)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(background, in: Capsule())
    }

    private var foreground: Color {
        switch tone {
        case .lime: return Palette.ink
        case .muted: return Palette.ink2
        case .good: return Palette.good
        case .warn: return Palette.warn
        }
    }

    private var background: Color {
        switch tone {
        case .lime: return Palette.lime
        case .muted: return Palette.sunken
        case .good: return Palette.goodSoft
        case .warn: return Palette.warnSoft
        }
    }
}

struct Avatar: View {
    let account: String
    let name: String
    var team = false
    var size: CGFloat = 36

    var body: some View {
        let hue = Double(People.avatarHue(account)) / 360
        Text(People.initials(name, account))
            .font(.system(size: size * 0.38, weight: .semibold))
            .foregroundStyle(team ? Palette.ink : Color(hue: hue, saturation: 0.6, brightness: 0.35))
            .frame(width: size, height: size)
            .background(team ? Palette.lime : Color(hue: hue, saturation: 0.25, brightness: 0.96), in: Circle())
            .accessibilityHidden(true)
    }
}

/// An icon on a rounded tile, for headers and empty states.
struct IconTile: View {
    let icon: String
    var accent = false
    var size: CGFloat = 40

    var body: some View {
        Image(systemName: icon)
            .font(.system(size: size * 0.42, weight: .semibold))
            .foregroundStyle(Palette.ink)
            .frame(width: size, height: size)
            .background(accent ? Palette.lime : Palette.sunken, in: RoundedRectangle(cornerRadius: size / 3.5, style: .continuous))
    }
}

struct EmptyState: View {
    let icon: String
    let title: String
    var message: String?

    var body: some View {
        VStack(spacing: 10) {
            IconTile(icon: icon, size: 52)
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
    }
}

/// Grey placeholders while the first read is in flight.
struct SkeletonCard: View {
    var height: CGFloat = 120
    var body: some View {
        RoundedRectangle(cornerRadius: 14, style: .continuous)
            .fill(Palette.sunken)
            .frame(height: height)
            .redacted(reason: .placeholder)
    }
}

/// A grey rounded input, single or multi-line, with a length cap.
struct InputField: View {
    let placeholder: String
    @Binding var text: String
    var limit = 20_000
    var axis: Axis = .horizontal
    var lines: ClosedRange<Int> = 1...1
    var font: Font = .body

    var body: some View {
        TextField(placeholder, text: $text, axis: axis)
            .lineLimit(lines)
            .font(font)
            .padding(12)
            .background(Palette.sunken, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .onChange(of: text) { value in
                if value.count > limit { text = String(value.prefix(limit)) }
            }
    }
}

/// Copyable technical values, behind a "Details" disclosure.
struct DetailRow: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(Palette.ink2)
            Text(value).font(.caption.monospaced()).foregroundStyle(Palette.ink).textSelection(.enabled)
        }
        .contextMenu {
            Button { UIPasteboard.general.string = value } label: { Label("Copy", systemImage: "doc.on.doc") }
        }
    }
}

struct DetailsDisclosure: View {
    let rows: [(String, String)]

    var body: some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(rows, id: \.0) { DetailRow(label: $0.0, value: $0.1) }
            }
            .padding(.top, 8)
        } label: {
            Label("Details", systemImage: "info.circle").font(.subheadline.weight(.medium)).foregroundStyle(Palette.ink2)
        }
        .tint(Palette.ink2)
    }
}

/// A KPI value's change: arrow and "+12%".
struct DeltaLabel: View {
    let delta: String

    var body: some View {
        let direction = Metrics.direction(delta)
        HStack(spacing: 3) {
            Image(systemName: Symbols.delta(direction)).font(.caption2.weight(.bold))
            Text(delta).font(.caption.weight(.semibold))
        }
        .foregroundStyle(direction == .up ? Palette.good : direction == .down ? Palette.danger : Palette.ink2)
    }
}

/// A trend line for a series of KPI values.
struct Sparkline: View {
    let values: [String]

    var body: some View {
        let points = Metrics.points(values)
        if points.count < 2 {
            Text("Not enough reports for a trend").font(.caption).foregroundStyle(Palette.ink3)
                .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
        } else {
            GeometryReader { geo in
                let path = Self.path(points, in: geo.size)
                ZStack {
                    path.fill.fill(Palette.ink.opacity(0.06))
                    path.line.stroke(Palette.ink, style: StrokeStyle(lineWidth: 1.75, lineCap: .round, lineJoin: .round))
                    Circle().fill(Palette.ink).frame(width: 6, height: 6).position(path.last)
                }
            }
            .frame(height: 48)
            .accessibilityHidden(true)
        }
    }

    private static func path(_ values: [Double], in size: CGSize) -> (line: Path, fill: Path, last: CGPoint) {
        let pad: CGFloat = 3
        let lo = values.min() ?? 0
        let span = (values.max() ?? 0) - lo
        let points = values.enumerated().map { i, v -> CGPoint in
            let x = pad + CGFloat(i) / CGFloat(values.count - 1) * (size.width - pad * 2)
            let y = size.height - pad - CGFloat(span == 0 ? 0.5 : (v - lo) / span) * (size.height - pad * 2)
            return CGPoint(x: x, y: y)
        }
        var line = Path()
        line.addLines(points)
        var fill = line
        fill.addLine(to: CGPoint(x: size.width - pad, y: size.height - pad))
        fill.addLine(to: CGPoint(x: pad, y: size.height - pad))
        fill.closeSubpath()
        return (line, fill, points.last ?? .zero)
    }
}

extension View {
    /// The app's grey ground behind cards.
    func screenBackground() -> some View {
        background(Palette.background.ignoresSafeArea())
    }
}

extension CloudStyle {
    /// The sign-in and approvals views in Mero Updates' colours.
    static let app = CloudStyle(
        ink: Palette.ink, muted: Palette.ink2, accent: Palette.lime, onAccent: Palette.ink, danger: Palette.danger,
        field: Palette.surface, hairline: Palette.hairline)
}
