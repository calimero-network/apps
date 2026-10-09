import SwiftUI

#if canImport(UIKit)
import UIKit
#endif

// MARK: - Feedback

/// Light haptic helper.
enum Haptics {
    static func tap() {
        #if os(iOS)
        UIImpactFeedbackGenerator(style: .soft).impactOccurred()
        #endif
    }

    static func success() {
        #if os(iOS)
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        #endif
    }
}

// MARK: - Buttons

/// Lime fill, ink label, 1px hairline edge, radius 8. The one call to action on
/// a screen.
struct PrimaryButtonStyle: ButtonStyle {
    var fullWidth = true
    var height: CGFloat = 48
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(Theme.ink)
            .padding(.horizontal, 18)
            .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: height)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                    .fill(configuration.isPressed ? Theme.accentPressed : Theme.accent)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                    .stroke(Theme.limeEdge, lineWidth: 1)
            )
            .opacity(isEnabled ? 1 : 0.5)
            .contentShape(Rectangle())
    }
}

/// White fill, ink label, strong hairline. Secondary actions.
struct SecondaryButtonStyle: ButtonStyle {
    var fullWidth = true
    var height: CGFloat = 44
    var destructive = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(destructive ? Theme.danger : Theme.ink)
            .padding(.horizontal, 14)
            .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: height)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                    .fill(
                        configuration.isPressed
                            ? (destructive ? Theme.dangerSoft : Theme.surfaceHover) : Theme.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                    .stroke(
                        configuration.isPressed && destructive ? Theme.danger : Theme.borderStrong,
                        lineWidth: 1)
            )
            .opacity(isEnabled ? 1 : 0.5)
            .contentShape(Rectangle())
    }
}

/// A 36pt round icon button (dim icon; pressed = hover surface).
struct IconButtonStyle: ButtonStyle {
    var size: CGFloat = 36
    var bordered = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .regular))
            .foregroundStyle(Theme.textDim)
            .frame(width: size, height: size)
            .background(
                Circle().fill(
                    configuration.isPressed ? Theme.surfaceHover : (bordered ? Theme.surface : Color.clear))
            )
            .overlay(Circle().stroke(bordered ? Theme.borderStrong : Color.clear, lineWidth: 1))
            .contentShape(Circle())
    }
}

/// Spinner or icon + label, for buttons with a loading state.
struct ButtonLabel: View {
    let title: String
    var icon: String?
    var isLoading = false

    var body: some View {
        HStack(spacing: 8) {
            if isLoading {
                ProgressView().tint(Theme.ink).controlSize(.small)
            } else if let icon {
                Image(systemName: icon).font(.system(size: 14, weight: .semibold))
            }
            Text(title)
        }
    }
}

// MARK: - Containers

/// White card, 1px hairline, radius 14, extra-small ink shadow.
struct Card<Content: View>: View {
    var padding: CGFloat = Theme.cardPadding
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous).fill(Theme.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                    .stroke(Theme.border, lineWidth: 1)
            )
            .shadow(color: Theme.ink.opacity(0.05), radius: 1, y: 1)
    }
}

/// Card head: icon tile, title, optional meta line.
struct CardHeader: View {
    let icon: String
    let title: String
    var meta: String?
    var accent = false

    var body: some View {
        HStack(spacing: 12) {
            IconTile(systemName: icon, accent: accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                if let meta {
                    Text(meta)
                        .font(.system(size: 12.5))
                        .foregroundStyle(Theme.textFaint)
                }
            }
            Spacer(minLength: 0)
        }
    }
}

/// 34pt rounded square holding an SF Symbol.
struct IconTile: View {
    let systemName: String
    var accent = false
    var size: CGFloat = 34

    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: size * 0.47, weight: .regular))
            .foregroundStyle(accent ? Theme.accentInk : Theme.textDim)
            .frame(width: size, height: size)
            .background(
                RoundedRectangle(cornerRadius: size * 0.26, style: .continuous)
                    .fill(accent ? Theme.accentSoft : Theme.bgSubtle)
            )
            .accessibilityHidden(true)
    }
}

/// Section eyebrow: 12pt, medium, uppercase, tracked, faint.
struct Eyebrow: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 12, weight: .medium))
            .tracking(0.5)
            .foregroundStyle(Theme.textFaint)
    }
}

// MARK: - Status

enum Tone {
    case neutral, accent, success, warning, danger, info

    var foreground: Color {
        switch self {
        case .neutral: return Theme.textDim
        case .accent: return Theme.accentInk
        case .success: return Theme.success
        case .warning: return Theme.warning
        case .danger: return Theme.danger
        case .info: return Theme.info
        }
    }

    var background: Color {
        switch self {
        case .neutral: return Theme.bgSubtle
        case .accent: return Theme.accentSoft
        case .success: return Theme.successSoft
        case .warning: return Theme.warningSoft
        case .danger: return Theme.dangerSoft
        case .info: return Theme.infoSoft
        }
    }

    var icon: String {
        switch self {
        case .neutral, .info: return "info.circle"
        case .accent, .success: return "checkmark.circle"
        case .warning: return "exclamationmark.triangle"
        case .danger: return "exclamationmark.circle"
        }
    }
}

/// Pill badge, 22pt tall.
struct Badge: View {
    let text: String
    var tone: Tone = .neutral

    var body: some View {
        Text(text)
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(tone.foreground)
            .padding(.horizontal, 8)
            .frame(height: 22)
            .background(Capsule().fill(tone.background))
    }
}

/// Soft-tinted callout with a leading icon: errors, notices, hints.
struct Callout: View {
    var tone: Tone = .info
    var title: String?
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: tone.icon)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(tone.foreground)
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 2) {
                if let title {
                    Text(title)
                        .font(.system(size: 13.5, weight: .semibold))
                        .foregroundStyle(Theme.ink)
                }
                Text(message)
                    .font(.system(size: 13.5))
                    .foregroundStyle(Theme.textDim)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.callout, style: .continuous).fill(tone.background)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.callout, style: .continuous)
                .stroke(tone.foreground.opacity(0.18), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

/// Dashed empty state: icon tile, title, body, optional action.
struct EmptyState<Action: View>: View {
    let icon: String
    let title: String
    let message: String
    @ViewBuilder var action: Action

    var body: some View {
        VStack(spacing: 10) {
            IconTile(systemName: icon, size: 40)
            Text(title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.ink)
            Text(message)
                .font(.system(size: 14))
                .foregroundStyle(Theme.textDim)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 420)
            action
        }
        .padding(.vertical, 28)
        .padding(.horizontal, 20)
        .frame(maxWidth: .infinity)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                .strokeBorder(Theme.borderStrong, style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
        )
    }
}

// MARK: - Inputs

/// 44pt white field, strong hairline; focus = ink border + lime ring.
struct TextInput: View {
    let placeholder: String
    @Binding var text: String
    var icon: String?
    var monospaced = false
    var identifier: String?

    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 10) {
            if let icon {
                Image(systemName: icon)
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.textFaint)
                    .frame(width: 18)
            }
            TextField("", text: $text, prompt: Text(placeholder).foregroundColor(Theme.textFaint))
                .font(monospaced ? .system(size: 14, design: .monospaced) : .system(size: 15))
                .foregroundStyle(Theme.ink)
                .tint(Theme.ink)
                .focused($focused)
                .autocorrectionDisabled()
                #if os(iOS)
                .textInputAutocapitalization(.never)
                #endif
                .accessibilityIdentifier(identifier ?? placeholder)
            if !text.isEmpty && focused {
                Button {
                    text = ""
                } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.textFaint)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear")
            }
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 44)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous).fill(Theme.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                .stroke(focused ? Theme.ink : Theme.borderStrong, lineWidth: 1)
        )
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.control + 3, style: .continuous)
                .stroke(focused ? Theme.focusRing : Color.clear, lineWidth: 3)
                .padding(-3)
        )
        .animation(.easeOut(duration: 0.15), value: focused)
    }
}

/// Label above a field (13pt medium ink) with an optional faint hint below.
struct Field<Content: View>: View {
    let label: String
    var hint: String?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.ink)
            content
            if let hint {
                Text(hint)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textFaint)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

// MARK: - Identity

/// Round avatar with deterministic tone and initials. `me` uses the accent tone.
struct Avatar: View {
    let id: String
    let name: String
    var size: CGFloat = 32
    var me = false

    var body: some View {
        let tone = me ? (bg: Theme.accentSoft, fg: Theme.accentInk) : AvatarTone.colors(for: id)
        Text(initials)
            .font(.system(size: size * 0.4, weight: .bold))
            .foregroundStyle(tone.fg)
            .frame(width: size, height: size)
            .background(Circle().fill(tone.bg))
            .accessibilityHidden(true)
    }

    private var initials: String {
        let words = name.split(whereSeparator: { $0 == " " || $0 == "-" || $0 == "_" })
        let letters = words.prefix(2).compactMap(\.first).map(String.init).joined()
        return letters.isEmpty ? "?" : letters.uppercased()
    }
}

/// A mono id in a sunken field with a copy button.
struct IdField: View {
    let value: String
    @State private var copied = false

    var body: some View {
        HStack(spacing: 6) {
            Text(value)
                .font(.system(size: 12.5, design: .monospaced))
                .foregroundStyle(Theme.textDim)
                .lineLimit(1)
                .truncationMode(.middle)
                .textSelection(.enabled)
            Spacer(minLength: 0)
            Button {
                #if os(iOS)
                UIPasteboard.general.string = value
                #endif
                Haptics.tap()
                copied = true
                Task {
                    try? await Task.sleep(nanoseconds: 1_400_000_000)
                    copied = false
                }
            } label: {
                Image(systemName: copied ? "checkmark" : "doc.on.doc")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(copied ? Theme.accentInk : Theme.textFaint)
                    .frame(width: 26, height: 26)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(copied ? "Copied" : "Copy")
        }
        .padding(.leading, 8)
        .frame(height: 30)
        .background(
            RoundedRectangle(cornerRadius: 6, style: .continuous).fill(Theme.surfaceSunken)
        )
        .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).stroke(Theme.border, lineWidth: 1))
    }
}

/// "Show technical details": ids live behind this, never in the main UI.
struct TechnicalDetails: View {
    let rows: [(label: String, value: String)]
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Rectangle().fill(Theme.border).frame(height: 1)
            Button {
                withAnimation(.easeOut(duration: 0.2)) { open.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .semibold))
                        .rotationEffect(.degrees(open ? 90 : 0))
                    Text(open ? "Hide technical details" : "Show technical details")
                        .font(.system(size: 13, weight: .medium))
                }
                .foregroundStyle(Theme.textFaint)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("technicalDetailsToggle")

            if open {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(rows.indices, id: \.self) { index in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(rows[index].label)
                                .font(.system(size: 12.5))
                                .foregroundStyle(Theme.textFaint)
                            IdField(value: rows[index].value)
                        }
                    }
                }
                .transition(.opacity)
            }
        }
    }
}

// MARK: - AR overlay chrome

/// Translucent white material chip with ink content — the only chrome drawn
/// over the camera feed. Material keeps it legible over any real room.
struct ARChip<Content: View>: View {
    var padding = EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12)
    @ViewBuilder var content: Content

    var body: some View {
        content
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(Theme.ink)
            .padding(padding)
            .background(ARMaterial(shape: Capsule()))
    }
}

/// White-tinted material + hairline, for any shape drawn over the camera.
struct ARMaterial<S: InsettableShape>: View {
    let shape: S

    var body: some View {
        shape
            .fill(.regularMaterial)
            .overlay(shape.fill(Color.white.opacity(0.55)))
            .overlay(shape.strokeBorder(Color.white.opacity(0.8), lineWidth: 1))
            .shadow(color: Theme.ink.opacity(0.12), radius: 10, y: 4)
            .environment(\.colorScheme, .light)
    }
}

/// Full-screen light backdrop.
struct ScreenBackground: View {
    var body: some View {
        Theme.bg.ignoresSafeArea()
    }
}
