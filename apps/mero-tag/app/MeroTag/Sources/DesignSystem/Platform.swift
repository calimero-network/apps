import SwiftUI

#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// The few UIKit-only touches, kept in one place so every screen also
/// type-checks for macOS (handy for compiling the app without an iOS SDK).
enum Platform {
    static func copy(_ string: String) {
        #if canImport(UIKit)
        UIPasteboard.general.string = string
        #elseif canImport(AppKit)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(string, forType: .string)
        #endif
    }

    static func pastedString() -> String? {
        #if canImport(UIKit)
        return UIPasteboard.general.string
        #elseif canImport(AppKit)
        return NSPasteboard.general.string(forType: .string)
        #else
        return nil
        #endif
    }

    static func tap() {
        #if os(iOS)
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        #endif
    }

    static func success() {
        #if os(iOS)
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        #endif
    }

    static func openSettings() {
        #if os(iOS)
        if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        }
        #endif
    }
}

enum KeyboardKind { case plain, identifier }

extension View {
    /// Inline navigation title on iOS; a no-op elsewhere.
    func inlineNavigationTitle() -> some View {
        #if os(iOS)
        return self.navigationBarTitleDisplayMode(.inline)
        #else
        return self
        #endif
    }

    /// White top bar with a hairline, matching the web apps' sticky header.
    func calNavigationBar() -> some View {
        #if os(iOS)
        return self
            .toolbarBackground(Cal.surface, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
        #else
        return self
        #endif
    }

    /// No autocapitalisation/autocorrection for IDs; words for names.
    func keyboard(_ kind: KeyboardKind) -> some View {
        #if os(iOS)
        switch kind {
        case .identifier:
            return AnyView(self.textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.asciiCapable))
        case .plain:
            return AnyView(self.textInputAutocapitalization(.words))
        }
        #else
        return AnyView(self.autocorrectionDisabled(kind == .identifier))
        #endif
    }
}

extension ToolbarItemPlacement {
    static var calLeading: ToolbarItemPlacement {
        #if os(iOS)
        return .topBarLeading
        #else
        return .navigation
        #endif
    }

    static var calTrailing: ToolbarItemPlacement {
        #if os(iOS)
        return .topBarTrailing
        #else
        return .primaryAction
        #endif
    }
}
