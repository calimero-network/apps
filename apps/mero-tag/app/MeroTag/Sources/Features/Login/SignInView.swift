import SwiftUI

/// Sign-in. Calimero Cloud first: one button opens the wallet in the system
/// auth sheet and the person approves this device with their passkey. Under
/// it, "Manually enter node URL" signs in to a node they run (a local `merod`)
/// with its admin username and password — no Cloud account needed.
struct SignInView: View {
    @EnvironmentObject private var app: AppState
    @State private var manual = false
    @State private var nodeURL = ""
    @State private var username = ""
    @State private var password = ""
    @FocusState private var focus: Field?

    fileprivate enum Field { case url, user, pass }

    var body: some View {
        ZStack {
            HeroBackground()
            ScrollView {
                VStack(spacing: 0) {
                    RadarMark()
                        .frame(height: manual ? 150 : 230)
                        .padding(.top, manual ? 12 : 40)

                    VStack(spacing: 12) {
                        Text(manual ? "Connect a node" : "Find your people.\nPrivately.")
                            .font(Tag.Typeface.display)
                            .tracking(-1)
                            .multilineTextAlignment(.center)
                            .foregroundStyle(Tag.ink)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("appTitle")
                        Text(
                            manual
                                ? "Sign in to a Calimero node you run, like a local merod, with its admin login."
                                : "Live location with the people you choose. It travels through your own account, "
                                    + "never a tracking company."
                        )
                        .font(Tag.Typeface.body)
                        .foregroundStyle(Tag.textDim)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.top, 8)

                    if !manual {
                        FeatureChips().padding(.top, 22)
                    }

                    VStack(spacing: 14) {
                        notices
                        if manual {
                            nodeForm.transition(.move(edge: .bottom).combined(with: .opacity))
                        } else {
                            cloudButton.transition(.opacity)
                        }
                        Button {
                            Platform.tap()
                            withAnimation(.spring(response: 0.4, dampingFraction: 0.85)) { manual.toggle() }
                            if manual { focus = .url }
                        } label: {
                            Text(manual ? "Use Calimero Cloud instead" : "Manually enter node URL")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(Tag.accentInk)
                                .padding(.vertical, 10)
                                .padding(.horizontal, 16)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier(manual ? "useCloud" : "manualNode")
                    }
                    .padding(.top, 28)
                    .animation(.easeOut(duration: 0.2), value: app.client.errorMessage)
                    .animation(.easeOut(duration: 0.2), value: app.nodeError)

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
            if nodeURL.isEmpty { nodeURL = app.lastNodeURL }
            if username.isEmpty { username = app.lastNodeUser }
            // Demo recordings only (scripts/record-demo.sh): a password to show filled in.
            if password.isEmpty { password = ProcessInfo.processInfo.environment["MEROTAG_PREFILL_PASS"] ?? "" }
        }
    }

    @ViewBuilder private var notices: some View {
        if let notice = app.sessionNotice, app.client.errorMessage == nil {
            Callout(tone: .warning, title: "Signed out", message: notice)
                .accessibilityIdentifier("sessionNotice")
        }
        if let error = app.client.errorMessage, !manual {
            Callout(tone: .danger, title: "Couldn't sign in", message: error)
                .accessibilityIdentifier("signInError")
        }
        if let error = app.nodeError, manual {
            Callout(tone: .danger, title: "Couldn't connect", message: error)
                .accessibilityIdentifier("nodeError")
        }
    }

    private var cloudButton: some View {
        VStack(spacing: 10) {
            LoadingButton(
                title: "Continue with Calimero Cloud", systemImage: "cloud.fill", isLoading: app.client.isLoading
            ) {
                Task { await app.signIn() }
            }
            .accessibilityIdentifier("cloudSignInButton")
            Label("Approve this phone once with your passkey", systemImage: "person.badge.key")
                .font(.system(size: 12.5))
                .foregroundStyle(Tag.textFaint)
        }
    }

    private var nodeForm: some View {
        Card(padding: 18) {
            VStack(spacing: 14) {
                TagTextField(
                    label: "Node URL", placeholder: "http://localhost:4001", text: $nodeURL,
                    monospaced: true, keyboardKind: .url, submitLabel: .next
                ) { focus = .user }
                .focused($focus, equals: .url)
                .accessibilityIdentifier("nodeURLField")
                TagTextField(
                    label: "Username", placeholder: "dev", text: $username, keyboardKind: .identifier,
                    submitLabel: .next
                ) { focus = .pass }
                .focused($focus, equals: .user)
                .accessibilityIdentifier("nodeUserField")
                SecureEntry(label: "Password", text: $password, focus: $focus, onSubmit: connect)
                    .accessibilityIdentifier("nodePassField")
                LoadingButton(
                    title: "Connect to node", systemImage: "server.rack", isLoading: app.isConnectingNode,
                    action: connect
                )
                .disabled(nodeURL.isEmpty || username.isEmpty || password.isEmpty)
                .accessibilityIdentifier("nodeConnectButton")
                Text("In the Simulator, localhost is your Mac. On a phone, use your Mac's LAN address.")
                    .font(.system(size: 12))
                    .foregroundStyle(Tag.textFaint)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func connect() {
        guard !nodeURL.isEmpty, !username.isEmpty, !password.isEmpty else { return }
        focus = nil
        Task { await app.signInToNode(url: nodeURL, username: username, password: password) }
    }
}

/// A password field styled like ``TagTextField``.
private struct SecureEntry: View {
    let label: String
    @Binding var text: String
    var focus: FocusState<SignInView.Field?>.Binding
    var onSubmit: () -> Void = {}

    private var focused: Bool { focus.wrappedValue == .pass }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(Tag.Typeface.label).foregroundStyle(Tag.ink)
            SecureField("", text: $text, prompt: Text("Admin password").foregroundColor(Tag.textFaint))
                .font(.system(size: 15))
                .foregroundStyle(Tag.ink)
                .submitLabel(.go)
                .onSubmit(onSubmit)
                .focused(focus, equals: .pass)
                .padding(.horizontal, 14)
                .frame(minHeight: 50)
                .background(
                    RoundedRectangle(cornerRadius: Tag.Radius.control, style: .continuous).fill(Tag.surfaceSunken))
                .overlay(
                    RoundedRectangle(cornerRadius: Tag.Radius.control, style: .continuous)
                        .strokeBorder(focused ? Tag.accent : Tag.border, lineWidth: focused ? 1.5 : 1))
                .accessibilityLabel(label)
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
