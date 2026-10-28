import StandupCore
import SwiftUI
import UIKit

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
    static let danger = Color(hex: 0xD93A2B)
    static let dangerSoft = Color(hex: 0xFDECEA)
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
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(tint.opacity(isEnabled ? 1 : 0.4))
            .frame(maxWidth: .infinity, minHeight: 46)
            .padding(.horizontal, 14)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Palette.hairline, lineWidth: 1))
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

/// A small pill: "I can help", tag filters, people to decide with.
struct Chip: View {
    let title: String
    var icon: String?
    var selected = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let icon { Image(systemName: icon).font(.footnote.weight(.semibold)) }
                Text(title).font(.subheadline.weight(.medium)).lineLimit(1)
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

struct Badge: View {
    let title: String
    var muted = false

    var body: some View {
        Text(title)
            .font(.caption.weight(.semibold))
            .foregroundStyle(muted ? Palette.ink2 : Palette.ink)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(muted ? Palette.sunken : Palette.lime, in: Capsule())
    }
}

struct Avatar: View {
    let account: String
    let name: String?
    var size: CGFloat = 36

    var body: some View {
        let hue = Double(People.avatarHue(account)) / 360
        Text(People.initials(account, name))
            .font(.system(size: size * 0.38, weight: .semibold))
            .foregroundStyle(Color(hue: hue, saturation: 0.6, brightness: 0.35))
            .frame(width: size, height: size)
            .background(Color(hue: hue, saturation: 0.25, brightness: 0.96), in: Circle())
            .accessibilityHidden(true)
    }
}

struct EmptyState: View {
    let icon: String
    let title: String
    var message: String?

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: icon).font(.system(size: 30, weight: .regular)).foregroundStyle(Palette.ink3)
            Text(title).font(.headline).foregroundStyle(Palette.ink)
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

/// A labelled field of an update: Done, Next, Blocked.
struct FieldBlock: View {
    let label: String
    let text: String
    var danger = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased()).font(.caption2.weight(.semibold)).tracking(0.5)
                .foregroundStyle(danger ? Palette.danger : Palette.ink3)
            RichTextView(text: text)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(danger ? 10 : 0)
        .background(danger ? Palette.dangerSoft : .clear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

/// An update's text with its bullets, links and `code`, never as markup.
struct RichTextView: View {
    let text: String
    var font: Font = .subheadline

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(RichText.parse(text).enumerated()), id: \.offset) { _, block in
                switch block {
                case .paragraph(let inlines):
                    Text(attributed(inlines))
                case .list(let items):
                    ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text("•").foregroundStyle(Palette.ink3)
                            Text(attributed(item))
                        }
                    }
                }
            }
        }
        .font(font)
        .foregroundStyle(Palette.ink)
        .tint(Palette.ink)
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func attributed(_ inlines: [RichText.Inline]) -> AttributedString {
        var out = AttributedString()
        for inline in inlines {
            switch inline {
            case .text(let s):
                out += AttributedString(s)
            case .code(let s):
                var code = AttributedString(s)
                code.font = .system(.footnote, design: .monospaced)
                code.backgroundColor = Palette.sunken
                out += code
            case .link(let s):
                var link = AttributedString(s)
                link.link = URL(string: s)
                link.underlineStyle = .single
                out += link
            }
        }
        return out
    }
}

/// A multi-line field with its label, for the sheets.
struct LabelledEditor: View {
    let label: String
    let placeholder: String
    @Binding var text: String
    var limit: Int = Limits.field
    var minLines = 2
    var identifier: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink)
            TextField(placeholder, text: $text, axis: .vertical)
                .lineLimit(minLines...8)
                .accessibilityIdentifier(identifier ?? "")
                .padding(12)
                .background(Palette.sunken, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .onChange(of: text) { value in
                    if value.count > limit { text = String(value.prefix(limit)) }
                }
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

extension View {
    /// The app's grey ground behind cards.
    func screenBackground() -> some View {
        background(Palette.background.ignoresSafeArea())
    }
}
