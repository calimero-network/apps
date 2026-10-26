import SwiftUI
import UIKit

/// The web app's design tokens (`packages/glass/src/glass.css`, `app/src/index.css`),
/// light and dark, so the phone draws Mero Chat exactly as the web does.
enum Theme {
    /// `--glass-tint`: the app's yellow.
    static let tint = Color(hex: 0xFFC93C)

    static let ground = Color(light: 0xF6F7FB, dark: 0x0B0E18)
    static let surface = Color(light: 0xFFFFFF, dark: 0x1C2134, lightAlpha: 0.66, darkAlpha: 0.62)
    static let surfaceSolid = Color(light: 0xFFFFFF, dark: 0x161B2B)
    static let sunken = Color(light: 0x0E1222, dark: 0xFFFFFF, lightAlpha: 0.045, darkAlpha: 0.06)
    static let ink = Color(light: 0x0E1222, dark: 0xECEEF5)
    static let ink2 = Color(light: 0x3C4256, dark: 0xC7CCD9)
    static let muted = Color(light: 0x6F7589, dark: 0x9097AB)
    static let line = Color(light: 0x0E1222, dark: 0xFFFFFF, lightAlpha: 0.08, darkAlpha: 0.08)
    static let lineStrong = Color(light: 0x0E1222, dark: 0xFFFFFF, lightAlpha: 0.14, darkAlpha: 0.14)
    static let onInk = Color(light: 0xFFFFFF, dark: 0x0B0E18)
    static let accent = Color(light: 0x3451D1, dark: 0x9AAFFF)
    static let accentSolid = Color(light: 0x3E63F5, dark: 0x4A6CFF)
    static let waitBg = Color(light: 0xFEF0B8, dark: 0x3A300F)
    static let waitInk = Color(light: 0x6B4E00, dark: 0xF5DC8A)
    static let badBg = Color(light: 0xFFE4EA, dark: 0x3D0F1E)
    static let badInk = Color(light: 0xA2194B, dark: 0xF78BB0)
    static let chatCard = Color(light: 0xFFFFFF, dark: 0x1C2236)
    static let violet = Color(light: 0x7C3AED, dark: 0xB69CFF)
    static let scrim = Color(light: 0x0E1222, dark: 0x03050C, lightAlpha: 0.32, darkAlpha: 0.6)
    static let online = Color(hex: 0x22C55E)

    /// `color-mix(in srgb, ink X%, transparent)`.
    static func ink(_ percent: Double) -> Color { ink.opacity(percent / 100) }
    /// `color-mix(in srgb, accent X%, transparent)`.
    static func accent(_ percent: Double) -> Color { accent.opacity(percent / 100) }

    // MARK: Type

    /// Figtree, the web app's face, at a weight on its variable axis.
    static func font(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .custom("Figtree", size: size).weight(weight)
    }

    /// The uppercase section labels ("CHANNELS", "YOUR NAME").
    static func label(_ text: String, size: CGFloat = 11, opacity: Double = 30) -> some View {
        Text(text.uppercased())
            .font(font(size, .bold))
            .tracking(size * 0.07)
            .foregroundStyle(ink(opacity))
    }
}

// MARK: - Colors

extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(
            .sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255, opacity: alpha)
    }

    /// One color per appearance, following the app's chosen theme.
    init(light: UInt32, dark: UInt32, lightAlpha: Double = 1, darkAlpha: Double = 1) {
        self.init(
            uiColor: UIColor { traits in
                let isDark = traits.userInterfaceStyle == .dark
                let hex = isDark ? dark : light
                return UIColor(
                    red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                    blue: CGFloat(hex & 0xFF) / 255, alpha: isDark ? darkAlpha : lightAlpha)
            })
    }

    /// `#rrggbb` (the avatar palette).
    init(hexString: String) {
        self.init(hex: UInt32(hexString.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0)
    }
}

// MARK: - Theme choice

/// Light (the default) or dark, kept under the web app's key.
enum ThemeChoice: String {
    case light
    case dark

    static let storageKey = "mero-chat:theme"

    var scheme: ColorScheme { self == .dark ? .dark : .light }
    var toggled: ThemeChoice { self == .dark ? .light : .dark }
}

// MARK: - Ground

/// The page background: the ground and its four soft color fields.
struct GroundBackground: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let dark = scheme == .dark
        ZStack {
            Theme.ground
            // `radial-gradient(W H at x y, color, transparent 60%)`, W and H the ellipse radii.
            field(Theme.tint.opacity(dark ? 0.22 : 0.26), x: -0.05, y: -0.10, radius: 800)
            field(Color(hex: 0xEC4899, alpha: dark ? 0.12 : 0.14), x: 1.05, y: 0, radius: 720)
            field(Theme.tint.opacity(dark ? 0.16 : 0.20), x: 0.85, y: 1.05, radius: 830)
            field(Color(hex: 0x8B5CF6, alpha: dark ? 0.10 : 0.12), x: -0.05, y: 1.0, radius: 700)
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }

    private func field(_ color: Color, x: CGFloat, y: CGFloat, radius: CGFloat) -> some View {
        RadialGradient(
            colors: [color, color.opacity(0)], center: UnitPoint(x: x, y: y), startRadius: 0,
            endRadius: radius * 0.6)
    }
}

// MARK: - Surfaces

extension View {
    /// `--chat-card` with `--chat-card-shadow`: bubbles, the composer, the selected row.
    func chatCard(radius: CGFloat = 16) -> some View {
        background(
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .fill(Theme.chatCard)
                .shadow(color: Color.black.opacity(0.05), radius: 1, y: 1)
                .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).stroke(Theme.line, lineWidth: 1))
        )
    }

    /// A menu or dialog card: surface-solid with the pop shadow.
    func popCard(radius: CGFloat = 14) -> some View {
        background(
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .fill(Theme.surfaceSolid)
                .shadow(color: Color(hex: 0x141A3C, alpha: 0.30), radius: 20, y: 12)
                .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).stroke(Theme.line, lineWidth: 1))
        )
    }
}

/// The ink pill: the primary button everywhere in the web app.
struct InkButtonStyle: ButtonStyle {
    var fullWidth = true
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.font(14, .bold))
            .foregroundStyle(isEnabled ? Theme.onInk : Theme.muted)
            .padding(.horizontal, 18)
            .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: 40)
            .background(Capsule().fill(isEnabled ? Theme.ink : Theme.lineStrong))
            .opacity(configuration.isPressed ? 0.85 : 1)
    }
}

/// The secondary pill: surface-solid with a line ring.
struct SecondaryButtonStyle: ButtonStyle {
    var fullWidth = true

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.font(14, .semibold))
            .foregroundStyle(Theme.ink)
            .padding(.horizontal, 18)
            .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: 40)
            .background(Capsule().fill(Theme.surfaceSolid))
            .overlay(Capsule().stroke(Theme.lineStrong, lineWidth: 1))
            .opacity(configuration.isPressed ? 0.85 : 1)
    }
}

/// The web app's text field: 40 high, radius 12, a 1px border.
struct ChatFieldStyle: TextFieldStyle {
    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration
            .font(Theme.font(14))
            .foregroundStyle(Theme.ink)
            .padding(.horizontal, 12)
            .frame(minHeight: 40)
            .background(RoundedRectangle(cornerRadius: 12).fill(Theme.accent(4)))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.accent(22), lineWidth: 1))
    }
}

// MARK: - Avatar

/// `IdentityAvatar`: initials on the name's palette color, or a person glyph for a name that is really an id.
struct AvatarView: View {
    let name: String
    var size: CGFloat = 32

    var body: some View {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        let placeholder = ChatFormat.isPlaceholderName(trimmed)
        ZStack {
            Circle().fill(trimmed.isEmpty ? Theme.sunken : Color(hexString: ChatFormat.avatarColor(for: trimmed)))
            if placeholder {
                Image(systemName: "person.fill")
                    .resizable()
                    .scaledToFit()
                    .frame(width: size * 0.5, height: size * 0.5)
                    .foregroundStyle(trimmed.isEmpty ? Theme.ink2 : .white)
            } else {
                Text(ChatFormat.initials(trimmed))
                    .font(Theme.font(size * 0.36, .bold))
                    .foregroundStyle(.white)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// The app mark: the yellow rounded square with a chat bubble.
struct AppMark: View {
    var size: CGFloat = 30

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.3, style: .continuous)
            .fill(Theme.tint)
            .overlay(
                Image(systemName: "ellipsis.bubble.fill")
                    .font(.system(size: size * 0.42, weight: .bold))
                    .foregroundStyle(Color(hex: 0x0E1222))
            )
            .overlay(
                RoundedRectangle(cornerRadius: size * 0.3, style: .continuous).stroke(Theme.line, lineWidth: 1)
            )
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// A dismissable error or notice line, styled as the web app's banners.
struct Banner: View {
    enum Kind { case error, notice }

    let kind: Kind
    let text: String
    var onDismiss: (() -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: kind == .error ? "exclamationmark.triangle.fill" : "info.circle.fill")
                .font(.system(size: 13))
            Text(text)
                .font(Theme.font(13))
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
            if let onDismiss {
                Button(action: onDismiss) {
                    Image(systemName: "xmark").font(.system(size: 11, weight: .semibold))
                }
                .accessibilityLabel("Dismiss")
            }
        }
        .foregroundStyle(kind == .error ? Theme.badInk : Theme.accent)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 12).fill(kind == .error ? Theme.badBg : Theme.accent(10))
        )
        .accessibilityIdentifier(kind == .error ? "errorBanner" : "noticeBanner")
    }
}
