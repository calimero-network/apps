import SwiftUI
import TagCore

/// Sign-in on Calimero Cloud through Mero Tag's sign-in page: it opens in
/// the system sign-in sheet, the person signs in, or creates an account, with
/// their passkey there, and the page hands the session back to the app.
/// Under it, "Development cluster" connects to a `merod local` node by URL,
/// trusting its mock attestation, with a software passkey the SDK keeps for
/// that node.
struct SignInView: View {
    @EnvironmentObject private var app: AppState
    @State private var mode: Mode = .signIn
    @State private var devURL = ""
    @State private var name = ""
    @FocusState private var focus: Field?

    fileprivate enum Field { case name, dev }
    fileprivate enum Mode { case signIn, development }

    private var compact: Bool { mode != .signIn }

    var body: some View {
        ZStack {
            HeroBackground()
            ScrollView {
                VStack(spacing: 0) {
                    RadarMark()
                        .frame(height: compact ? 150 : 230)
                        .padding(.top, compact ? 12 : 40)

                    VStack(spacing: 12) {
                        Text(title)
                            .font(Tag.Typeface.display)
                            .tracking(-1)
                            .multilineTextAlignment(.center)
                            .foregroundStyle(Tag.ink)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("appTitle")
                        Text(subtitle)
                            .font(Tag.Typeface.body)
                            .foregroundStyle(Tag.textDim)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.top, 8)

                    if mode == .signIn {
                        FeatureChips().padding(.top, 22)
                    }

                    VStack(spacing: 14) {
                        notices
                        Group {
                            switch mode {
                            case .signIn: cloudForm
                            case .development: devForm
                            }
                        }
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                        footerLinks
                    }
                    .padding(.top, 28)
                    .animation(.easeOut(duration: 0.2), value: app.client.errorMessage)

                    Spacer(minLength: 24)
                }
                .frame(maxWidth: 460)
                .padding(.horizontal, 24)
                .frame(maxWidth: .infinity)
            }
            .scrollBounceBehavior(.basedOnSize)
            .scrollDismissesKeyboard(.interactively)
        }
        .onAppear {
            if devURL.isEmpty { devURL = app.lastDevNodeURL }
        }
    }

    private var title: String {
        switch mode {
        case .signIn: return "Find your people.\nPrivately."
        case .development: return "Development cluster"
        }
    }

    private var subtitle: String {
        switch mode {
        case .signIn:
            return "Live location with the people you choose. It lives on your own Calimero cluster, "
                + "never with a tracking company."
        case .development:
            return "Connect to a merod local cluster on your Mac. Its attestation is a mock, so use this only "
                + "for development."
        }
    }

    @ViewBuilder private var notices: some View {
        if let notice = app.sessionNotice, app.client.errorMessage == nil {
            Callout(tone: .warning, title: "Signed out", message: notice)
                .accessibilityIdentifier("sessionNotice")
        }
        if let error = app.client.errorMessage {
            Callout(tone: .danger, title: mode == .signIn ? "Couldn't sign in" : "Couldn't connect", message: error)
                .accessibilityIdentifier("signInError")
        }
    }

    private var cloudForm: some View {
        Card(padding: 18) {
            VStack(spacing: 14) {
                LoadingButton(
                    title: "Sign in with passkey", systemImage: "person.badge.key.fill",
                    isLoading: app.client.isLoading, action: submit
                )
                .accessibilityIdentifier("passkeySignInButton")
                Label(
                    "Opens Mero Tag's sign-in page on Calimero Cloud. New here? Create your account there.",
                    systemImage: "lock.shield"
                )
                .font(.system(size: 12.5))
                .foregroundStyle(Tag.textFaint)
                .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var devForm: some View {
        Card(padding: 18) {
            VStack(spacing: 14) {
                TagTextField(
                    label: "Node URL", placeholder: AppState.defaultDevNodeURL, text: $devURL,
                    monospaced: true, keyboardKind: .url, submitLabel: .next
                ) { focus = .name }
                .focused($focus, equals: .dev)
                .accessibilityIdentifier("nodeURLField")
                TagTextField(
                    label: "Your name", placeholder: "dev", text: $name, submitLabel: .go, onSubmit: submit
                )
                .focused($focus, equals: .name)
                .accessibilityIdentifier("devNameField")
                LoadingButton(
                    title: "Connect", systemImage: "server.rack", isLoading: app.client.isLoading, action: submit
                )
                .disabled(devURL.isEmpty)
                .accessibilityIdentifier("devConnectButton")
                Label("Trusts the node's mock attestation", systemImage: "exclamationmark.shield")
                    .font(.system(size: 12))
                    .foregroundStyle(Tag.textFaint)
            }
        }
    }

    private var footerLinks: some View {
        VStack(spacing: 2) {
            switch mode {
            case .signIn:
                link("Development cluster", id: "showDevelopment") { switchTo(.development, focus: .dev) }
            case .development:
                link("Use Calimero Cloud instead", id: "showSignIn") { switchTo(.signIn, focus: nil) }
            }
        }
    }

    private func link(_ title: String, id: String, action: @escaping () -> Void) -> some View {
        Button {
            Platform.tap()
            action()
        } label: {
            Text(title)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Tag.accentInk)
                .padding(.vertical, 8)
                .padding(.horizontal, 16)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(id)
    }

    private func switchTo(_ next: Mode, focus field: Field?) {
        app.client.errorMessage = nil
        withAnimation(.spring(response: 0.4, dampingFraction: 0.85)) { mode = next }
        focus = field
    }

    private func submit() {
        focus = nil
        switch mode {
        case .signIn:
            Task { await app.signInWithCalimero() }
        case .development:
            guard !devURL.isEmpty else { return }
            Task { await app.signInToDevCluster(url: devURL, name: name) }
        }
    }
}

/// Three short promises under the headline.
private struct FeatureChips: View {
    var body: some View {
        VStack(spacing: 10) {
            chip("eye.slash.fill", "No tracking company in the middle")
            chip("person.2.fill", "Only the people in your space")
            chip("hand.raised.fill", "Stop sharing any time")
        }
        .accessibilityElement(children: .combine)
    }

    private func chip(_ icon: String, _ text: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Tag.accentInk)
                .frame(width: 26, height: 26)
                .background(Circle().fill(Tag.accentSoft))
            Text(text).font(.system(size: 14.5, weight: .medium)).foregroundStyle(Tag.textDim)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .background(Capsule().fill(.ultraThinMaterial))
        .overlay(Capsule().strokeBorder(Tag.border.opacity(0.7), lineWidth: 1))
    }
}

/// A soft mesh of brand light behind the sign-in screen.
struct HeroBackground: View {
    @State private var drift = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            Tag.bg
            Circle()
                .fill(Tag.accent.opacity(0.28))
                .frame(width: 420)
                .blur(radius: 110)
                .offset(x: drift ? -90 : -150, y: drift ? -300 : -250)
            Circle()
                .fill(Tag.accentViolet.opacity(0.24))
                .frame(width: 360)
                .blur(radius: 110)
                .offset(x: drift ? 140 : 90, y: drift ? -150 : -200)
            Circle()
                .fill(Tag.live.opacity(0.16))
                .frame(width: 320)
                .blur(radius: 120)
                .offset(x: drift ? -40 : 30, y: drift ? 320 : 360)
        }
        .ignoresSafeArea()
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 9).repeatForever(autoreverses: true)) { drift = true }
        }
        .accessibilityHidden(true)
    }
}

/// The brand mark inside expanding radar rings, with a few friends orbiting.
struct RadarMark: View {
    @State private var phase = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { geo in
            let size = min(geo.size.width, geo.size.height)
            ZStack {
                ForEach(0..<3) { i in
                    Circle()
                        .stroke(Tag.accent.opacity(0.35), lineWidth: 1.5)
                        .frame(width: size * 0.45, height: size * 0.45)
                        .scaleEffect(phase ? 2.1 : 0.9)
                        .opacity(phase ? 0 : 0.9)
                        .animation(
                            reduceMotion
                                ? nil
                                : .easeOut(duration: 3).repeatForever(autoreverses: false).delay(Double(i)),
                            value: phase)
                }
                Circle()
                    .fill(.ultraThinMaterial)
                    .frame(width: size * 0.62, height: size * 0.62)
                    .overlay(Circle().strokeBorder(Tag.border.opacity(0.6), lineWidth: 1))
                BrandMark(size: size * 0.3)
                    .shadow(color: Tag.accent.opacity(0.45), radius: 24, y: 10)
                orbit("AN", 0.0, size)
                orbit("LU", 0.36, size)
                orbit("MI", 0.7, size)
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .onAppear { phase = true }
        .accessibilityHidden(true)
    }

    private func orbit(_ initials: String, _ turn: Double, _ size: CGFloat) -> some View {
        let angle = Angle.degrees(turn * 360 - 90)
        let radius = size * 0.42
        return Avatar(name: initials, seed: initials, size: size * 0.16)
            .overlay(Circle().strokeBorder(.white, lineWidth: 2.5))
            .shadow(color: .black.opacity(0.15), radius: 6, y: 3)
            .offset(x: cos(angle.radians) * radius, y: sin(angle.radians) * radius)
    }
}
