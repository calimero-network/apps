import SwiftUI

#if canImport(UIKit)
import UIKit
#endif

// MARK: - Haptics

enum Haptics {
    static func tap() {
        #if canImport(UIKit) && os(iOS)
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        #endif
    }

    static func soft() {
        #if canImport(UIKit) && os(iOS)
        UIImpactFeedbackGenerator(style: .soft).impactOccurred()
        #endif
    }

    static func success() {
        #if canImport(UIKit) && os(iOS)
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        #endif
    }

    static func error() {
        #if canImport(UIKit) && os(iOS)
        UINotificationFeedbackGenerator().notificationOccurred(.error)
        #endif
    }
}

// MARK: - Glass

/// A glass surface: material blur, a faint white wash and a hairline that is
/// brighter at the top, so the edge catches light like a pane.
struct Glass<S: InsettableShape>: ViewModifier {
    var shape: S
    var strong = false

    func body(content: Content) -> some View {
        content
            .background(shape.fill(.ultraThinMaterial))
            .background(shape.fill(strong ? Theme.glassFillStrong : Theme.glassFill))
            .overlay(
                shape.strokeBorder(
                    LinearGradient(
                        colors: [Theme.glassHighlight, Theme.glassStroke.opacity(0.4)],
                        startPoint: .top, endPoint: .bottom),
                    lineWidth: 1)
            )
            .clipShape(shape)
    }
}

extension View {
    func glass(cornerRadius: CGFloat = Theme.Radius.card, strong: Bool = false) -> some View {
        modifier(Glass(shape: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous), strong: strong))
    }

    func glassCapsule(strong: Bool = false) -> some View {
        modifier(Glass(shape: Capsule(), strong: strong))
    }
}

/// A glass card with padding.
struct GlassCard<Content: View>: View {
    var padding: CGFloat = 20
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .glass()
    }
}

// MARK: - Buttons

/// The one primary action: an aurora capsule with white text and a glow.
struct PrimaryButtonStyle: ButtonStyle {
    var height: CGFloat = 56
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: height)
            .background(Capsule().fill(Theme.aurora))
            .overlay(Capsule().strokeBorder(Color.white.opacity(0.28), lineWidth: 1))
            .shadow(color: Theme.violet.opacity(isEnabled ? 0.45 : 0), radius: 18, y: 8)
            .opacity(isEnabled ? 1 : 0.45)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(response: 0.3, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

/// A glass capsule button.
struct GlassButtonStyle: ButtonStyle {
    var height: CGFloat = 50
    var fullWidth = true
    var destructive = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(destructive ? Theme.danger : Theme.text)
            .padding(.horizontal, fullWidth ? 0 : 20)
            .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: height)
            .glassCapsule(strong: configuration.isPressed)
            .opacity(isEnabled ? 1 : 0.45)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(response: 0.3, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

/// A borderless text button ("Manually enter node URL").
struct LinkButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(Theme.textDim)
            .padding(.vertical, 8)
            .opacity(configuration.isPressed ? 0.55 : 1)
    }
}

/// Round glass icon button.
struct CircleButtonStyle: ButtonStyle {
    var size: CGFloat = 44
    var active = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(active ? .white : Theme.text)
            .frame(width: size, height: size)
            .background(Circle().fill(active ? AnyShapeStyle(Theme.aurora) : AnyShapeStyle(Color.clear)))
            .modifier(Glass(shape: Circle(), strong: configuration.isPressed))
            .scaleEffect(configuration.isPressed ? 0.92 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

/// Title + icon + spinner.
struct ButtonLabel: View {
    let title: String
    var icon: String?
    var isLoading = false

    var body: some View {
        HStack(spacing: 10) {
            if isLoading {
                ProgressView().tint(.white)
            } else if let icon {
                Image(systemName: icon).font(.system(size: 16, weight: .semibold))
            }
            Text(title)
        }
    }
}

// MARK: - Content pieces

/// A rounded glass tile holding a symbol.
struct IconTile: View {
    let systemName: String
    var size: CGFloat = 40
    var gradient = false

    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: size * 0.44, weight: .semibold))
            .foregroundStyle(gradient ? AnyShapeStyle(.white) : AnyShapeStyle(Theme.accent))
            .frame(width: size, height: size)
            .background(
                RoundedRectangle(cornerRadius: size * 0.32, style: .continuous)
                    .fill(gradient ? AnyShapeStyle(Theme.aurora) : AnyShapeStyle(Theme.glassFillStrong))
            )
            .overlay(
                RoundedRectangle(cornerRadius: size * 0.32, style: .continuous)
                    .strokeBorder(Theme.glassStroke, lineWidth: 1)
            )
            .accessibilityHidden(true)
    }
}

/// Small uppercase section label.
struct Eyebrow: View {
    let text: String
    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 12, weight: .semibold))
            .tracking(1.2)
            .foregroundStyle(Theme.textFaint)
    }
}

enum Tone {
    case neutral, accent, success, warning, danger, info

    var color: Color {
        switch self {
        case .neutral: return Theme.textDim
        case .accent: return Theme.accent
        case .success: return Theme.success
        case .warning: return Theme.warning
        case .danger: return Theme.danger
        case .info: return Theme.info
        }
    }

    var icon: String {
        switch self {
        case .neutral, .info: return "info.circle.fill"
        case .accent: return "sparkles"
        case .success: return "checkmark.circle.fill"
        case .warning: return "exclamationmark.triangle.fill"
        case .danger: return "exclamationmark.octagon.fill"
        }
    }
}

/// A small status pill.
struct Pill: View {
    let text: String
    var tone: Tone = .neutral
    var dot = false

    var body: some View {
        HStack(spacing: 6) {
            if dot { Circle().fill(tone.color).frame(width: 7, height: 7) }
            Text(text).font(.system(size: 12, weight: .semibold)).monospacedDigit()
        }
        .foregroundStyle(tone.color)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Capsule().fill(tone.color.opacity(0.14)))
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.25), lineWidth: 1))
    }
}

/// A tinted glass notice with an icon, title and message.
struct Callout: View {
    let tone: Tone
    var title: String?
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: tone.icon)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(tone.color)
            VStack(alignment: .leading, spacing: 3) {
                if let title {
                    Text(title).font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.text)
                }
                Text(message)
                    .font(.system(size: 13.5))
                    .foregroundStyle(Theme.textDim)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(tone.color.opacity(0.10)))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(tone.color.opacity(0.28), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

/// Icon, title, message and an optional action, centred.
struct EmptyState<Action: View>: View {
    let icon: String
    let title: String
    let message: String
    @ViewBuilder var action: Action

    var body: some View {
        VStack(spacing: 14) {
            IconTile(systemName: icon, size: 64, gradient: true)
                .shadow(color: Theme.violet.opacity(0.4), radius: 20, y: 8)
            Text(title)
                .font(Theme.title(22))
                .foregroundStyle(Theme.text)
                .multilineTextAlignment(.center)
            Text(message)
                .font(.system(size: 15))
                .foregroundStyle(Theme.textDim)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            action
        }
        .padding(28)
        .frame(maxWidth: .infinity)
        .glass()
    }
}

extension EmptyState where Action == EmptyView {
    init(icon: String, title: String, message: String) {
        self.init(icon: icon, title: title, message: message) { EmptyView() }
    }
}

// MARK: - Inputs

/// A glass text field with a leading symbol.
struct TextInput: View {
    let placeholder: String
    @Binding var text: String
    var icon: String?
    var secure = false
    var identifier: String?
    var keyboard: KeyboardKind = .plain

    enum KeyboardKind { case plain, url }

    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 12) {
            if let icon {
                Image(systemName: icon)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(focused ? Theme.accent : Theme.textFaint)
                    .frame(width: 20)
            }
            Group {
                if secure {
                    SecureField("", text: $text, prompt: prompt)
                } else {
                    TextField("", text: $text, prompt: prompt)
                }
            }
            .font(.system(size: 16))
            .foregroundStyle(Theme.text)
            .tint(Theme.accent)
            .focused($focused)
            .autocorrectionDisabled()
            #if os(iOS)
            .textInputAutocapitalization(.never)
            .keyboardType(keyboard == .url ? .URL : .default)
            #endif
            .accessibilityIdentifier(identifier ?? placeholder)
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 54)
        .background(RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous).fill(Theme.glassFill))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                .strokeBorder(focused ? Theme.accent.opacity(0.7) : Theme.glassStroke, lineWidth: focused ? 1.5 : 1)
        )
        .animation(.easeOut(duration: 0.15), value: focused)
    }

    private var prompt: Text { Text(placeholder).foregroundStyle(Theme.textFaint) }
}

/// A labelled input.
struct Field<Content: View>: View {
    let label: String
    var hint: String?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.textDim)
            content
            if let hint {
                Text(hint).font(.system(size: 12.5)).foregroundStyle(Theme.textFaint)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

// MARK: - People

/// Gradient initials avatar; `me` adds a ring.
struct Avatar: View {
    let id: String
    let name: String
    var size: CGFloat = 36
    var me = false
    var online = false

    private var initials: String {
        let parts = name.split(separator: " ").prefix(2).map { String($0.prefix(1)) }.joined()
        return (parts.isEmpty ? String(name.prefix(1)) : parts).uppercased()
    }

    var body: some View {
        Text(initials.isEmpty ? "?" : initials)
            .font(.system(size: size * 0.38, weight: .bold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(Circle().fill(AvatarTone.gradient(for: id.isEmpty ? name : id)))
            .overlay(Circle().strokeBorder(me ? Color.white.opacity(0.85) : Color.white.opacity(0.2), lineWidth: me ? 2 : 1))
            .overlay(alignment: .bottomTrailing) {
                if online {
                    Circle().fill(Theme.success)
                        .frame(width: size * 0.3, height: size * 0.3)
                        .overlay(Circle().strokeBorder(Theme.bg, lineWidth: 2))
                }
            }
            .accessibilityLabel(name)
    }
}

/// Up to four overlapping avatars and a "+n".
struct AvatarStack: View {
    let people: [(id: String, name: String)]
    var size: CGFloat = 28

    var body: some View {
        HStack(spacing: -size * 0.32) {
            ForEach(Array(people.prefix(4).enumerated()), id: \.offset) { _, person in
                Avatar(id: person.id, name: person.name, size: size)
                    .overlay(Circle().strokeBorder(Theme.bg.opacity(0.8), lineWidth: 2))
            }
            if people.count > 4 {
                Text("+\(people.count - 4)")
                    .font(.system(size: size * 0.36, weight: .bold))
                    .foregroundStyle(Theme.text)
                    .frame(width: size, height: size)
                    .modifier(Glass(shape: Circle(), strong: true))
            }
        }
    }
}

// MARK: - Technical details

/// A monospaced, middle-truncated id with a copy button.
struct IdField: View {
    let label: String
    let value: String
    @State private var copied = false

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.system(size: 11.5, weight: .medium)).foregroundStyle(Theme.textFaint)
                Text(value)
                    .font(.system(size: 12.5, design: .monospaced))
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer(minLength: 8)
            Button {
                #if canImport(UIKit) && os(iOS)
                UIPasteboard.general.string = value
                #endif
                Haptics.soft()
                copied = true
            } label: {
                Image(systemName: copied ? "checkmark" : "doc.on.doc")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(copied ? Theme.success : Theme.textDim)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Copy \(label)")
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.black.opacity(0.25)))
    }
}

/// "Technical details": ids live behind this, never up front.
struct TechnicalDetails: View {
    let rows: [(label: String, value: String)]
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) { open.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .bold))
                        .rotationEffect(.degrees(open ? 90 : 0))
                    Text("Technical details").font(.system(size: 13, weight: .semibold))
                }
                .foregroundStyle(Theme.textFaint)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("technicalDetails")
            if open {
                ForEach(rows, id: \.label) { IdField(label: $0.label, value: $0.value) }
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }
}

// MARK: - Over the camera

/// A glass chip for overlays on the camera.
struct ARChip<Content: View>: View {
    var padding = EdgeInsets(top: 9, leading: 14, bottom: 9, trailing: 14)
    @ViewBuilder var content: Content

    var body: some View {
        content
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(Theme.text)
            .padding(padding)
            .glassCapsule()
    }
}

// MARK: - Background

/// Deep space with two slow aurora glows and a faint perspective grid.
struct SpatialBackground: View {
    var animated = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drift = false

    var body: some View {
        GeometryReader { geo in
            ZStack {
                Theme.bg
                Circle()
                    .fill(Theme.violet.opacity(0.45))
                    .frame(width: geo.size.width * 1.1)
                    .blur(radius: 90)
                    .offset(x: drift ? -geo.size.width * 0.25 : -geo.size.width * 0.4, y: -geo.size.height * 0.38)
                Circle()
                    .fill(Theme.cyan.opacity(0.28))
                    .frame(width: geo.size.width * 0.9)
                    .blur(radius: 100)
                    .offset(x: drift ? geo.size.width * 0.4 : geo.size.width * 0.25, y: geo.size.height * 0.05)
                PerspectiveGrid()
                    .stroke(Color.white.opacity(0.05), lineWidth: 1)
                    .frame(height: geo.size.height * 0.45)
                    .frame(maxHeight: .infinity, alignment: .bottom)
                    .mask(LinearGradient(colors: [.clear, .white], startPoint: .top, endPoint: .bottom))
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .ignoresSafeArea()
        .onAppear {
            guard animated, !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 9).repeatForever(autoreverses: true)) { drift = true }
        }
        .accessibilityHidden(true)
    }
}

/// The old name, kept so every screen reads the same.
typealias ScreenBackground = SpatialBackground

/// A floor grid in one-point perspective.
struct PerspectiveGrid: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let vanish = CGPoint(x: rect.midX, y: rect.minY - rect.height * 0.6)
        for i in -10...10 {
            let x = rect.midX + CGFloat(i) * rect.width / 6
            path.move(to: CGPoint(x: x, y: rect.maxY))
            path.addLine(to: CGPoint(x: vanish.x + (x - vanish.x) * 0.38, y: rect.minY))
        }
        for j in 0..<9 {
            let t = pow(CGFloat(j) / 8, 1.8)
            let y = rect.minY + t * rect.height
            path.move(to: CGPoint(x: rect.minX, y: y))
            path.addLine(to: CGPoint(x: rect.maxX, y: y))
        }
        return path
    }
}
