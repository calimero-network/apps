import SwiftUI

// MARK: - Buttons

/// Calimero button variants (vote `index.css` `.btn`): radius 8, 14/500 label,
/// 8pt icon gap. Primary is lime with ink text and a 1px dark edge.
struct CalButtonStyle: ButtonStyle {
    enum Kind { case primary, secondary, plain, danger }
    enum Size { case small, regular, large }

    var kind: Kind = .primary
    var size: Size = .regular
    var fullWidth = false

    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        let pressed = configuration.isPressed
        configuration.label
            .font(size == .large ? .system(size: 16, weight: .semibold) : .system(size: 14, weight: .medium))
            .labelStyle(CalLabelStyle(gap: size == .small ? 6 : 8))
            .lineLimit(1)
            .foregroundStyle(foreground(pressed: pressed))
            .padding(.horizontal, horizontalPadding)
            .frame(height: height)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .background(
                RoundedRectangle(cornerRadius: Cal.Radius.control, style: .continuous)
                    .fill(fill(pressed: pressed)))
            .overlay(
                RoundedRectangle(cornerRadius: Cal.Radius.control, style: .continuous)
                    .strokeBorder(stroke(pressed: pressed), lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: Cal.Radius.control, style: .continuous))
            .opacity(isEnabled ? 1 : 0.5)
            .animation(.easeOut(duration: 0.12), value: pressed)
    }

    private var height: CGFloat {
        switch size {
        case .small: return 30
        case .regular: return 36
        case .large: return 48
        }
    }

    private var horizontalPadding: CGFloat {
        switch size {
        case .small: return 10
        case .regular: return 14
        case .large: return 18
        }
    }

    private func foreground(pressed: Bool) -> Color {
        switch kind {
        case .primary: return Cal.onLime
        case .secondary: return Cal.ink
        case .plain: return pressed ? Cal.ink : Cal.textDim
        case .danger: return Cal.danger
        }
    }

    private func fill(pressed: Bool) -> Color {
        switch kind {
        case .primary: return pressed ? Cal.limePressed : Cal.lime
        case .secondary: return pressed ? Cal.surfaceHover : Cal.surface
        case .plain: return pressed ? Cal.surfaceHover : .clear
        case .danger: return pressed ? Cal.dangerSoft : Cal.surface
        }
    }

    private func stroke(pressed: Bool) -> Color {
        switch kind {
        case .primary: return Cal.limeEdge
        case .secondary: return Cal.borderStrong
        case .plain: return .clear
        case .danger: return pressed ? Cal.danger : Cal.borderStrong
        }
    }
}

extension ButtonStyle where Self == CalButtonStyle {
    static var calPrimary: CalButtonStyle { CalButtonStyle(kind: .primary) }
    static var calSecondary: CalButtonStyle { CalButtonStyle(kind: .secondary) }
    static var calPlain: CalButtonStyle { CalButtonStyle(kind: .plain) }
    static func cal(
        _ kind: CalButtonStyle.Kind, size: CalButtonStyle.Size = .regular, fullWidth: Bool = false
    ) -> CalButtonStyle {
        CalButtonStyle(kind: kind, size: size, fullWidth: fullWidth)
    }
}

struct CalLabelStyle: LabelStyle {
    var gap: CGFloat = 8
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: gap) {
            configuration.icon.imageScale(.small)
            configuration.title
        }
    }
}

/// A primary action with a built-in progress state.
struct LoadingButton: View {
    let title: String
    var systemImage: String?
    var isLoading = false
    var kind: CalButtonStyle.Kind = .primary
    var size: CalButtonStyle.Size = .large
    var fullWidth = true
    let action: () -> Void

    var body: some View {
        Button {
            Platform.tap()
            action()
        } label: {
            HStack(spacing: 8) {
                if isLoading {
                    ProgressView()
                        .controlSize(.small)
                        .tint(kind == .primary ? Cal.onLime : Cal.ink)
                } else if let systemImage {
                    Image(systemName: systemImage).imageScale(.small)
                }
                Text(title)
            }
        }
        .buttonStyle(.cal(kind, size: size, fullWidth: fullWidth))
        .disabled(isLoading)
        .accessibilityLabel(isLoading ? "\(title), in progress" : title)
    }
}

/// 34×34 transparent icon button (vote `.icon-btn`); `bordered` adds a surface.
struct IconButton: View {
    let systemImage: String
    let label: String
    var bordered = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Cal.textDim)
                .frame(width: 34, height: 34)
                .background(
                    RoundedRectangle(cornerRadius: Cal.Radius.control, style: .continuous)
                        .fill(bordered ? Cal.surface : .clear))
                .overlay(
                    RoundedRectangle(cornerRadius: Cal.Radius.control, style: .continuous)
                        .strokeBorder(bordered ? Cal.borderStrong : .clear, lineWidth: 1))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

// MARK: - Inputs

/// Label above a 44pt field: white, 1px strong border, radius 8; focus turns
/// the border ink and adds the lime ring.
struct CalTextField: View {
    let label: String
    var placeholder = ""
    @Binding var text: String
    var help: String?
    var optional = false
    var monospaced = false
    var keyboardKind: KeyboardKind = .plain
    var submitLabel: SubmitLabel = .done
    var onSubmit: () -> Void = {}

    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 4) {
                Text(label).font(Cal.Typeface.label).foregroundStyle(Cal.ink)
                if optional {
                    Text("optional").font(Cal.Typeface.hint).foregroundStyle(Cal.textFaint)
                }
            }

            TextField("", text: $text, prompt: Text(placeholder).foregroundColor(Cal.textFaint))
                .font(monospaced ? .system(size: 14, design: .monospaced) : .system(size: 15))
                .foregroundStyle(Cal.ink)
                .tint(Cal.ink)
                .keyboard(keyboardKind)
                .submitLabel(submitLabel)
                .onSubmit(onSubmit)
                .focused($focused)
                .padding(.horizontal, 12)
                .frame(minHeight: 44)
                .background(
                    RoundedRectangle(cornerRadius: Cal.Radius.control, style: .continuous).fill(Cal.surface))
                .overlay(
                    RoundedRectangle(cornerRadius: Cal.Radius.control, style: .continuous)
                        .strokeBorder(focused ? Cal.ink : Cal.borderStrong, lineWidth: 1))
                .background(
                    RoundedRectangle(cornerRadius: Cal.Radius.control + 3, style: .continuous)
                        .stroke(Cal.ring, lineWidth: focused ? 3 : 0)
                        .padding(-1.5))
                .animation(.easeOut(duration: 0.15), value: focused)
                .accessibilityLabel(label)

            if let help {
                Text(help)
                    .font(.system(size: 12))
                    .foregroundStyle(Cal.textFaint)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

// MARK: - Cards

/// White card, 1px hairline, radius 14, shadow-xs.
struct Card<Content: View>: View {
    var padding: CGFloat = Cal.Space.card
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: Cal.Radius.card, style: .continuous).fill(Cal.surface))
            .overlay(
                RoundedRectangle(cornerRadius: Cal.Radius.card, style: .continuous)
                    .strokeBorder(Cal.border, lineWidth: 1))
            .shadow(color: Cal.shadow, radius: 1, y: 1)
    }
}

/// Icon tile + title + meta, the head of a card.
struct CardHeader<Trailing: View>: View {
    let systemImage: String
    let title: String
    var meta: String?
    var accent = false
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(spacing: 12) {
            IconTile(systemImage: systemImage, accent: accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(Cal.Typeface.section).foregroundStyle(Cal.ink)
                if let meta {
                    Text(meta).font(Cal.Typeface.meta).foregroundStyle(Cal.textFaint)
                }
            }
            Spacer(minLength: 8)
            trailing
        }
    }
}

extension CardHeader where Trailing == EmptyView {
    init(systemImage: String, title: String, meta: String? = nil, accent: Bool = false) {
        self.init(systemImage: systemImage, title: title, meta: meta, accent: accent) { EmptyView() }
    }
}

/// 34pt rounded square holding an SF Symbol. `accent` = soft lime with ink-green.
struct IconTile: View {
    let systemImage: String
    var accent = false
    var size: CGFloat = 34

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: size * 0.44, weight: .medium))
            .foregroundStyle(accent ? Cal.accentInk : Cal.textDim)
            .frame(width: size, height: size)
            .background(
                RoundedRectangle(cornerRadius: size * 0.27, style: .continuous)
                    .fill(accent ? Cal.accentSoft : Cal.bgSubtle))
            .accessibilityHidden(true)
    }
}

/// A row flush inside a `Card(padding: 0)`: [tile][title+meta][trailing][chevron].
struct ListRow<Leading: View, Trailing: View>: View {
    let title: String
    var subtitle: String?
    var showsChevron = true
    @ViewBuilder var leading: Leading
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(spacing: 12) {
            leading
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(Cal.Typeface.section)
                    .foregroundStyle(Cal.ink)
                    .lineLimit(1)
                if let subtitle {
                    Text(subtitle)
                        .font(Cal.Typeface.meta)
                        .foregroundStyle(Cal.textFaint)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            trailing
            if showsChevron {
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Cal.textFaint)
                    .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, Cal.Space.gutter)
        .padding(.vertical, 12)
        .frame(minHeight: 64)
        .contentShape(Rectangle())
    }
}

/// Pressed state for rows used as buttons / navigation links.
struct RowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? Cal.surfaceHover : Color.clear)
    }
}

/// 1px hairline.
struct Hairline: View {
    var body: some View {
        Rectangle().fill(Cal.border).frame(height: 1)
    }
}

// MARK: - Empty state & callouts

/// Dashed outline, centred: icon tile, title, body, optional action.
struct EmptyState<Action: View>: View {
    let systemImage: String
    let title: String
    let message: String
    var compact = false
    @ViewBuilder var action: Action

    var body: some View {
        VStack(spacing: 10) {
            IconTile(systemImage: systemImage, size: 40)
                .padding(.bottom, 4)
            Text(title)
                .font(Cal.Typeface.section)
                .foregroundStyle(Cal.ink)
            Text(message)
                .font(Cal.Typeface.bodySmall)
                .foregroundStyle(Cal.textDim)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 420)
                .fixedSize(horizontal: false, vertical: true)
            action.padding(.top, 8)
        }
        .padding(.vertical, compact ? 22 : 32)
        .padding(.horizontal, compact ? 16 : 20)
        .frame(maxWidth: .infinity)
        .overlay(
            RoundedRectangle(cornerRadius: Cal.Radius.card, style: .continuous)
                .strokeBorder(Cal.borderStrong, style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
    }
}

extension EmptyState where Action == EmptyView {
    init(systemImage: String, title: String, message: String, compact: Bool = false) {
        self.init(systemImage: systemImage, title: title, message: message, compact: compact) { EmptyView() }
    }
}

enum Tone {
    case neutral, accent, success, warning, danger, info

    var foreground: Color {
        switch self {
        case .neutral: return Cal.textDim
        case .accent: return Cal.accentInk
        case .success: return Cal.success
        case .warning: return Cal.warning
        case .danger: return Cal.danger
        case .info: return Cal.info
        }
    }

    var background: Color {
        switch self {
        case .neutral: return Cal.bgSubtle
        case .accent: return Cal.accentSoft
        case .success: return Cal.successSoft
        case .warning: return Cal.warningSoft
        case .danger: return Cal.dangerSoft
        case .info: return Cal.infoSoft
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

/// Soft-tinted message box with a leading icon.
struct Callout: View {
    var tone: Tone = .info
    var title: String?
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: tone.icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(tone.foreground)
                .padding(.top, 1)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                if let title {
                    Text(title).font(.system(size: 13.5, weight: .semibold)).foregroundStyle(Cal.ink)
                }
                Text(message)
                    .font(.system(size: 13.5))
                    .foregroundStyle(Cal.textDim)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 14)
        .background(RoundedRectangle(cornerRadius: Cal.Radius.callout, style: .continuous).fill(tone.background))
        .overlay(
            RoundedRectangle(cornerRadius: Cal.Radius.callout, style: .continuous)
                .strokeBorder(tone.foreground.opacity(0.18), lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Page chrome

/// Page title (26/700) + optional description, as at the top of each web page.
struct PageHeader<Trailing: View>: View {
    let title: String
    var subtitle: String?
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(Cal.Typeface.pageTitle)
                    .tracking(-0.4)
                    .foregroundStyle(Cal.ink)
                    .accessibilityAddTraits(.isHeader)
                if let subtitle {
                    Text(subtitle)
                        .font(Cal.Typeface.bodySmall)
                        .foregroundStyle(Cal.textDim)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 8)
            trailing
        }
        .padding(.top, 8)
    }
}

extension PageHeader where Trailing == EmptyView {
    init(title: String, subtitle: String? = nil) {
        self.init(title: title, subtitle: subtitle) { EmptyView() }
    }
}

/// Section label above a group of cards.
struct SectionLabel: View {
    let title: String
    var body: some View {
        Text(title)
            .eyebrow()
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 12)
            .accessibilityAddTraits(.isHeader)
    }
}

extension View {
    /// The standard scrolling page: warm background, 16pt gutters.
    func calPage() -> some View {
        self
            .padding(.horizontal, Cal.Space.gutter)
            .padding(.bottom, 24)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
    }
}
