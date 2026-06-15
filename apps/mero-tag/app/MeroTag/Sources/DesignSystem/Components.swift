import SwiftUI

#if canImport(UIKit)
import UIKit
#endif

/// Springy press feedback for any button.
struct ScaleButtonStyle: ButtonStyle {
    var scale: CGFloat = 0.96
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? scale : 1)
            .animation(.spring(response: 0.3, dampingFraction: 0.6), value: configuration.isPressed)
    }
}

/// Light haptic helper.
enum Haptics {
    static func tap() {
        #if canImport(UIKit)
        UIImpactFeedbackGenerator(style: .soft).impactOccurred()
        #endif
    }
}

/// The primary CTA: gradient fill, press-scale, animated loading state, glow.
struct PrimaryButton: View {
    let title: String
    var icon: String? = nil
    var isLoading: Bool = false
    var disabled: Bool = false
    let action: () -> Void

    var body: some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            ZStack {
                if isLoading {
                    ProgressView().tint(.white)
                } else {
                    HStack(spacing: 8) {
                        if let icon { Image(systemName: icon) }
                        Text(title).fontWeight(.semibold)
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 54)
            .background(Theme.brand, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .foregroundStyle(.white)
            .shadow(color: Theme.accent2.opacity(0.45), radius: 18, y: 8)
        }
        .buttonStyle(ScaleButtonStyle())
        .disabled(disabled || isLoading)
        .opacity(disabled ? 0.45 : 1)
        .animation(.easeInOut(duration: 0.2), value: disabled)
        .animation(.easeInOut(duration: 0.2), value: isLoading)
    }
}

/// Glass text field with an icon and an animated focus ring.
struct MeroField: View {
    let icon: String
    let placeholder: String
    @Binding var text: String
    var secure: Bool = false
    var keyboard: UIKeyboardTypeCompat = .default

    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(focused ? Theme.accent : .white.opacity(0.5))
                .frame(width: 22)
                .animation(.easeInOut(duration: 0.2), value: focused)

            Group {
                if secure {
                    SecureField("", text: $text, prompt: prompt)
                } else {
                    TextField("", text: $text, prompt: prompt)
                }
            }
            .focused($focused)
            .foregroundStyle(.white)
            .tint(Theme.accent)
            .autocorrectionDisabled()
            #if os(iOS)
            .textInputAutocapitalization(.never)
            .keyboardType(keyboard.uiKeyboardType)
            #endif
        }
        .padding(.horizontal, 16)
        .frame(height: 54)
        .background(Theme.field, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(focused ? Theme.accent : Theme.stroke, lineWidth: focused ? 1.8 : 1)
        )
        .animation(.easeInOut(duration: 0.2), value: focused)
    }

    private var prompt: Text {
        Text(placeholder).foregroundColor(.white.opacity(0.4))
    }
}

/// Tiny shim so call sites stay clean on non-iOS compiles.
enum UIKeyboardTypeCompat {
    case `default`, url, emailAddress, numbersAndPunctuation
    #if os(iOS)
    var uiKeyboardType: UIKeyboardType {
        switch self {
        case .default: return .default
        case .url: return .URL
        case .emailAddress: return .emailAddress
        case .numbersAndPunctuation: return .numbersAndPunctuation
        }
    }
    #endif
}

/// Frosted card container.
struct GlassCard<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        content
            .padding(20)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .stroke(Theme.stroke, lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.3), radius: 30, y: 16)
    }
}
