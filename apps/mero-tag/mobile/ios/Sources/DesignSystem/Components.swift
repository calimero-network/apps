import SwiftUI

// MARK: - Buttons

/// Button variants. Primary is the indigo→violet gradient with white text and
/// a soft glow; it springs a little when pressed.
struct TagButtonStyle: ButtonStyle {
    enum Kind { case primary, secondary, plain, danger }
    enum Size { case small, regular, large }

    var kind: Kind = .primary
    var size: Size = .regular
    var fullWidth = false

    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        let pressed = configuration.isPressed
        configuration.label
            .font(size == .large ? .system(size: 17, weight: .semibold) : .system(size: 14.5, weight: .semibold))
            .labelStyle(TagLabelStyle(gap: size == .small ? 6 : 8))
            .lineLimit(1)
            .foregroundStyle(foreground(pressed: pressed))
            .padding(.horizontal, horizontalPadding)
            .frame(height: height)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .background(background(pressed: pressed))
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .strokeBorder(stroke(pressed: pressed), lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .shadow(
                color: kind == .primary && isEnabled ? Tag.accent.opacity(pressed ? 0.15 : 0.32) : .clear,
                radius: pressed ? 6 : 14, y: pressed ? 2 : 6)
            .scaleEffect(pressed ? 0.97 : 1)
            .opacity(isEnabled ? 1 : 0.45)
            .animation(.spring(response: 0.25, dampingFraction: 0.7), value: pressed)
    }

    private var radius: CGFloat { size == .large ? 18 : Tag.Radius.control }

    @ViewBuilder
    private func background(pressed: Bool) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        if kind == .primary {
            shape.fill(Tag.accentGradient).overlay(shape.fill(Color.black.opacity(pressed ? 0.12 : 0)))
        } else {
            shape.fill(fill(pressed: pressed))
        }
    }

    private var height: CGFloat {
        switch size {
        case .small: return 32
        case .regular: return 40
        case .large: return 56
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
        case .primary: return Tag.onAccent
        case .secondary: return Tag.ink
        case .plain: return pressed ? Tag.ink : Tag.textDim
        case .danger: return Tag.danger
        }
    }

    private func fill(pressed: Bool) -> Color {
        switch kind {
        case .primary: return pressed ? Tag.accentPressed : Tag.accent
        case .secondary: return pressed ? Tag.surfaceHover : Tag.surface
        case .plain: return pressed ? Tag.surfaceHover : .clear
        case .danger: return pressed ? Tag.dangerSoft : Tag.surface
        }
    }

    private func stroke(pressed: Bool) -> Color {
        switch kind {
        case .primary: return Tag.accentEdge
        case .secondary: return Tag.border
        case .plain: return .clear
        case .danger: return pressed ? Tag.danger : Tag.borderStrong
        }
    }
}

extension ButtonStyle where Self == TagButtonStyle {
    static var tagPrimary: TagButtonStyle { TagButtonStyle(kind: .primary) }
    static var tagSecondary: TagButtonStyle { TagButtonStyle(kind: .secondary) }
    static var tagPlain: TagButtonStyle { TagButtonStyle(kind: .plain) }
    static func tag(
        _ kind: TagButtonStyle.Kind, size: TagButtonStyle.Size = .regular, fullWidth: Bool = false
    ) -> TagButtonStyle {
        TagButtonStyle(kind: kind, size: size, fullWidth: fullWidth)
    }
}

struct TagLabelStyle: LabelStyle {
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
    var kind: TagButtonStyle.Kind = .primary
    var size: TagButtonStyle.Size = .large
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
                        .tint(kind == .primary ? Tag.onAccent : Tag.ink)
                } else if let systemImage {
                    Image(systemName: systemImage).imageScale(.small)
                }
                Text(title)
            }
        }
        .buttonStyle(.tag(kind, size: size, fullWidth: fullWidth))
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
                .foregroundStyle(Tag.textDim)
                .frame(width: 38, height: 38)
                .background(Circle().fill(bordered ? AnyShapeStyle(.regularMaterial) : AnyShapeStyle(Color.clear)))
                .overlay(Circle().strokeBorder(bordered ? Tag.border : .clear, lineWidth: 1))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

// MARK: - Inputs

/// Label above a 44pt field: white, 1px strong border, radius 8; focus turns
/// the border ink and adds the lime ring.
struct TagTextField: View {
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
                Text(label).font(Tag.Typeface.label).foregroundStyle(Tag.ink)
                if optional {
                    Text("optional").font(Tag.Typeface.hint).foregroundStyle(Tag.textFaint)
                }
            }

            TextField("", text: $text, prompt: Text(placeholder).foregroundColor(Tag.textFaint))
                .font(monospaced ? .system(size: 14, design: .monospaced) : .system(size: 15))
                .foregroundStyle(Tag.ink)
                .tint(Tag.ink)
                .keyboard(keyboardKind)
                .submitLabel(submitLabel)
                .onSubmit(onSubmit)
                .focused($focused)
                .padding(.horizontal, 14)
                .frame(minHeight: 50)
                .background(
                    RoundedRectangle(cornerRadius: Tag.Radius.control, style: .continuous).fill(Tag.surfaceSunken))
                .overlay(
                    RoundedRectangle(cornerRadius: Tag.Radius.control, style: .continuous)
                        .strokeBorder(focused ? Tag.accent : Tag.border, lineWidth: focused ? 1.5 : 1))
                .background(
                    RoundedRectangle(cornerRadius: Tag.Radius.control + 3, style: .continuous)
                        .stroke(Tag.ring, lineWidth: focused ? 3 : 0)
                        .padding(-1.5))
                .animation(.easeOut(duration: 0.15), value: focused)
                .accessibilityLabel(label)

            if let help {
                Text(help)
                    .font(.system(size: 12))
                    .foregroundStyle(Tag.textFaint)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

// MARK: - Cards

/// A raised card: radius 22, a hairline and a soft cool shadow.
struct Card<Content: View>: View {
    var padding: CGFloat = Tag.Space.card
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: Tag.Radius.card, style: .continuous).fill(Tag.surface))
            .overlay(
                RoundedRectangle(cornerRadius: Tag.Radius.card, style: .continuous)
                    .strokeBorder(Tag.border, lineWidth: 1))
            .shadow(color: Tag.shadow, radius: 18, y: 8)
    }
}

/// A floating, translucent card for content over the map.
struct GlassCard<Content: View>: View {
    var padding: CGFloat = 16
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: Tag.Radius.card, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Tag.Radius.card, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.25), lineWidth: 1))
            .shadow(color: Color.black.opacity(0.14), radius: 24, y: 10)
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
                Text(title).font(Tag.Typeface.section).foregroundStyle(Tag.ink)
                if let meta {
                    Text(meta).font(Tag.Typeface.meta).foregroundStyle(Tag.textFaint)
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

/// A rounded square holding an SF Symbol. `accent` = the brand gradient with
/// a white glyph.
struct IconTile: View {
    let systemImage: String
    var accent = false
    var size: CGFloat = 34

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: size * 0.44, weight: .semibold))
            .foregroundStyle(accent ? Tag.onAccent : Tag.textDim)
            .frame(width: size, height: size)
            .background(
                RoundedRectangle(cornerRadius: size * 0.32, style: .continuous)
                    .fill(accent ? AnyShapeStyle(Tag.accentGradient) : AnyShapeStyle(Tag.bgSubtle)))
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
                    .font(Tag.Typeface.section)
                    .foregroundStyle(Tag.ink)
                    .lineLimit(1)
                if let subtitle {
                    Text(subtitle)
                        .font(Tag.Typeface.meta)
                        .foregroundStyle(Tag.textFaint)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            trailing
            if showsChevron {
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Tag.textFaint)
                    .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, Tag.Space.gutter)
        .padding(.vertical, 12)
        .frame(minHeight: 64)
        .contentShape(Rectangle())
    }
}

/// Pressed state for rows used as buttons / navigation links.
struct RowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? Tag.surfaceHover : Color.clear)
    }
}

/// 1px hairline.
struct Hairline: View {
    var body: some View {
        Rectangle().fill(Tag.border).frame(height: 1)
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
            IconTile(systemImage: systemImage, accent: true, size: 52)
                .padding(.bottom, 6)
            Text(title)
                .font(Tag.Typeface.section)
                .foregroundStyle(Tag.ink)
            Text(message)
                .font(Tag.Typeface.bodySmall)
                .foregroundStyle(Tag.textDim)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 420)
                .fixedSize(horizontal: false, vertical: true)
            action.padding(.top, 8)
        }
        .padding(.vertical, compact ? 24 : 36)
        .padding(.horizontal, compact ? 16 : 22)
        .frame(maxWidth: .infinity)
        .background(RoundedRectangle(cornerRadius: Tag.Radius.card, style: .continuous).fill(Tag.surface))
        .overlay(
            RoundedRectangle(cornerRadius: Tag.Radius.card, style: .continuous)
                .strokeBorder(Tag.border, lineWidth: 1))
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
        case .neutral: return Tag.textDim
        case .accent: return Tag.accentInk
        case .success: return Tag.success
        case .warning: return Tag.warning
        case .danger: return Tag.danger
        case .info: return Tag.info
        }
    }

    var background: Color {
        switch self {
        case .neutral: return Tag.bgSubtle
        case .accent: return Tag.accentSoft
        case .success: return Tag.successSoft
        case .warning: return Tag.warningSoft
        case .danger: return Tag.dangerSoft
        case .info: return Tag.infoSoft
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
                    Text(title).font(.system(size: 13.5, weight: .semibold)).foregroundStyle(Tag.ink)
                }
                Text(message)
                    .font(.system(size: 13.5))
                    .foregroundStyle(Tag.textDim)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 14)
        .background(RoundedRectangle(cornerRadius: Tag.Radius.callout, style: .continuous).fill(tone.background))
        .overlay(
            RoundedRectangle(cornerRadius: Tag.Radius.callout, style: .continuous)
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
                    .font(Tag.Typeface.pageTitle)
                    .tracking(-0.6)
                    .foregroundStyle(Tag.ink)
                    .accessibilityAddTraits(.isHeader)
                if let subtitle {
                    Text(subtitle)
                        .font(Tag.Typeface.bodySmall)
                        .foregroundStyle(Tag.textDim)
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
    func tagPage() -> some View {
        self
            .padding(.horizontal, Tag.Space.gutter)
            .padding(.bottom, 24)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
    }
}
