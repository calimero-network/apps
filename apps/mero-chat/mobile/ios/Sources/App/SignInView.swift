import MeroKitUI
import SwiftUI

/// The landing page at phone width: a nav bar with the Mero Chat mark, the
/// hero, a glimpse of a channel, what the app does, and sign-in pinned at the
/// bottom: a Calimero 1.0 cluster's node URL and the device's passkey (or a
/// new account), or a development node (`merod local`) with mock attestation
/// and a software passkey kept for it.
struct SignInView: View {
    @ObservedObject var session: SessionModel
    @ObservedObject var client: MeroClient
    @AppStorage("signin.clusterURL") private var clusterURL = AppConfig.clusterURL ?? ""
    @AppStorage("signin.devNodeURL") private var devNodeURL = AppConfig.devNodeURL
    @State private var name = ""
    @State private var mode: Mode = .signIn

    enum Mode { case signIn, create, development }

    var body: some View {
        ZStack {
            GroundBackground()
            VStack(spacing: 0) {
                navBar
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        hero
                        preview.padding(.top, 28)
                        features.padding(.top, 28)
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 24)
                    .padding(.bottom, 24)
                }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { footer }
    }

    private var navBar: some View {
        HStack(spacing: 10) {
            AppMark(size: 30)
            Text("Mero Chat")
                .font(Theme.font(18, .bold))
                .tracking(-0.3)
                .foregroundStyle(Theme.ink)
                .accessibilityIdentifier("signInTitle")
            Spacer()
            Button {
                mode = .signIn
                submit()
            } label: {
                Text("Sign in")
                    .font(Theme.font(15, .semibold))
                    .foregroundStyle(Theme.accent)
                    .padding(.horizontal, 12)
                    .frame(height: 34)
                    .background(Capsule().fill(Color(light: 0xE3E9FF, dark: 0x1C2650)))
            }
            .buttonStyle(.plain)
            .disabled(client.isLoading || clusterURL.trimmingCharacters(in: .whitespaces).isEmpty)
            .accessibilityIdentifier("signInHeaderButton")
        }
        .padding(.horizontal, 20)
        .frame(height: 56)
        .background(Theme.surface)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Image(systemName: "lock.fill").font(.system(size: 10, weight: .semibold))
                Text("Powered by Calimero").font(Theme.font(12, .semibold))
            }
            .foregroundStyle(Theme.accent)
            .padding(.horizontal, 11)
            .padding(.vertical, 6)
            .background(Capsule().fill(Color(light: 0xE3E9FF, dark: 0x1C2650)))

            (Text("Team chat on ").foregroundColor(Theme.ink)
                + Text("your own cluster.").foregroundColor(Theme.accent))
                .font(Theme.font(34, .heavy))
                .tracking(-0.8)
                .lineSpacing(2)
                .padding(.top, 14)
                .fixedSize(horizontal: false, vertical: true)
            Text("Channels, threads and direct messages, with no central server holding your conversations.")
                .font(Theme.font(16))
                .lineSpacing(5)
                .foregroundStyle(Theme.ink2)
                .padding(.top, 12)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// A glimpse of a channel, drawn with the app's own styles.
    private var preview: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Image(systemName: "number").font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.muted)
                Text("launch-planning").font(Theme.font(14, .semibold)).foregroundStyle(Theme.ink)
                Spacer()
                HStack(spacing: -6) {
                    previewAvatar("AM", 0x3E63F5)
                    previewAvatar("TB", 0xD6336C)
                    previewAvatar("LK", 0x12B886)
                }
            }
            .padding(.horizontal, 14)
            .frame(height: 44)
            .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }

            VStack(alignment: .leading, spacing: 12) {
                previewMessage("Ada Mensah", "AM", 0x3E63F5, "Release notes are final. Shipping Thursday?")
                previewMessage("Theo Brandt", "TB", 0xD6336C, "RC1 is building now. I'll share the link here.")
            }
            .padding(14)
        }
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Theme.chatCard)
                .shadow(color: Color(hex: 0x141A3C, alpha: 0.10), radius: 18, y: 10)
        )
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Theme.line, lineWidth: 1))
        .accessibilityHidden(true)
    }

    private func previewAvatar(_ initials: String, _ color: UInt32) -> some View {
        Text(initials)
            .font(Theme.font(9, .bold))
            .foregroundStyle(.white)
            .frame(width: 22, height: 22)
            .background(Circle().fill(Color(hex: color)))
            .overlay(Circle().stroke(Theme.chatCard, lineWidth: 2))
    }

    private func previewMessage(_ name: String, _ initials: String, _ color: UInt32, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text(initials)
                .font(Theme.font(11, .bold))
                .foregroundStyle(.white)
                .frame(width: 30, height: 30)
                .background(Circle().fill(Color(hex: color)))
            VStack(alignment: .leading, spacing: 3) {
                Text(name).font(Theme.font(13, .semibold)).foregroundStyle(Theme.ink)
                Text(text).font(Theme.font(14)).foregroundStyle(Theme.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var features: some View {
        VStack(alignment: .leading, spacing: 16) {
            feature("bubble.left.and.bubble.right.fill", "Channels, threads and DMs",
                    "Everything your team expects from a chat app.")
            feature("externaldrive.fill.badge.checkmark", "Messages stay on your cluster",
                    "Attested nodes your organization runs hold your conversations.")
            feature("laptopcomputer.and.iphone", "iOS, web and desktop",
                    "Pick up the same workspace on any device.")
        }
    }

    private func feature(_ icon: String, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.accent)
                .frame(width: 36, height: 36)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color(light: 0xE3E9FF, dark: 0x1C2650)))
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(Theme.font(15, .semibold)).foregroundStyle(Theme.ink)
                Text(detail).font(Theme.font(13)).foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let error = client.errorMessage {
                Banner(kind: .error, text: error)
                    .accessibilityIdentifier("signInError")
            }
            switch mode {
            case .signIn, .create:
                urlField("Cluster URL (from cloud.calimero.network)", text: $clusterURL)
                    .accessibilityIdentifier("signInClusterURL")
                if mode == .create {
                    TextField("Your name", text: $name)
                        .textFieldStyle(ChatFieldStyle())
                        .textInputAutocapitalization(.words)
                }
            case .development:
                urlField("http://localhost:2501", text: $devNodeURL)
                    .accessibilityIdentifier("signInDevNodeURL")
                TextField("Your name", text: $name)
                    .textFieldStyle(ChatFieldStyle())
                    .textInputAutocapitalization(.words)
            }
            Button(action: submit) {
                HStack(spacing: 8) {
                    if client.isLoading { ProgressView().tint(Theme.onInk) }
                    Text(primaryTitle)
                }
                .frame(minHeight: 50)
            }
            .buttonStyle(InkButtonStyle(fullWidth: true))
            .disabled(client.isLoading || !canSubmit)
            .accessibilityIdentifier("signInButton")
            HStack {
                switch mode {
                case .signIn: Button("Create an account") { mode = .create }
                case .create: Button("I have an account") { mode = .signIn }
                case .development: Button("Use Calimero Cloud") { mode = .signIn }
                }
                Spacer()
                if mode != .development {
                    Button("Development node") { mode = .development }
                        .accessibilityIdentifier("signInDevelopment")
                }
            }
            .font(Theme.font(13, .semibold))
            .foregroundStyle(Theme.accent)
            .disabled(client.isLoading)
            HStack(spacing: 6) {
                Image(systemName: "person.badge.key.fill").font(.system(size: 11))
                Text(
                    mode == .development
                        ? "Mock attestation is allowed for this node; a passkey is kept on this device for it."
                        : "Sign in with this device's passkey. The node's attestation is verified first.")
            }
            .font(Theme.font(12))
            .foregroundStyle(Theme.muted)
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 8)
        .background(Theme.surfaceSolid.opacity(0.92).ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { Rectangle().fill(Theme.line).frame(height: 1) }
    }

    private func urlField(_ placeholder: String, text: Binding<String>) -> some View {
        TextField(placeholder, text: text)
            .textFieldStyle(ChatFieldStyle())
            .keyboardType(.URL)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
    }

    private var primaryTitle: String {
        switch mode {
        case .signIn: return "Sign in with passkey"
        case .create: return "Create account"
        case .development: return "Connect"
        }
    }

    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var canSubmit: Bool {
        switch mode {
        case .signIn: return !clusterURL.trimmingCharacters(in: .whitespaces).isEmpty
        case .create: return !clusterURL.trimmingCharacters(in: .whitespaces).isEmpty && !trimmedName.isEmpty
        case .development: return !devNodeURL.trimmingCharacters(in: .whitespaces).isEmpty
        }
    }

    private func submit() {
        guard canSubmit else { return }
        Task {
            switch mode {
            case .signIn:
                session.connect(nodeURL: clusterURL, allowMock: false)
                await session.signIn()
            case .create:
                session.connect(nodeURL: clusterURL, allowMock: false)
                await session.signUp(name: trimmedName)
                if session.displayName.isEmpty { session.displayName = trimmedName }
            case .development:
                session.connect(nodeURL: devNodeURL, allowMock: true)
                await session.signInOrSignUp(name: trimmedName.isEmpty ? nil : trimmedName)
                if session.displayName.isEmpty, !trimmedName.isEmpty { session.displayName = trimmedName }
            }
        }
    }
}
