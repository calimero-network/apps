import MeroKitUI
import SwiftUI

/// Signed out: what the app is, then sign-in to a Calimero 1.0 cluster.
///
/// - Calimero Cloud: the cluster's node URL (from the console, or baked in
///   as `CalimeroClusterURL`), then the device's passkey. "Create an account"
///   registers a new passkey under a name.
/// - Development: a `merod local` node URL with mock attestation allowed; the
///   SDK makes and keeps a software passkey for that node.
struct SignInView: View {
    @ObservedObject var session: MeroAppSession
    @ObservedObject var client: MeroClient
    @AppStorage("signin.clusterURL") private var clusterURL = AppConfig.clusterURL ?? ""
    @AppStorage("signin.devNodeURL") private var devNodeURL = AppConfig.devNodeURL
    @AppStorage("signin.name") private var name = ""
    @State private var mode: Mode = .signIn
    @State private var busy = false

    enum Mode { case signIn, create, development }

    var body: some View {
        ZStack {
            Theme.ground.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    VStack(alignment: .leading, spacing: 14) {
                        AppMark(size: 64)
                        Text("Mero Calendar").font(Theme.heading(34)).foregroundStyle(Theme.ink)
                        Text("Shared team calendars and truly private events.")
                            .font(Theme.body(17)).foregroundStyle(Theme.muted)
                    }
                    .padding(.top, 48)

                    VStack(spacing: 0) {
                        FeatureRow(
                            symbol: "person.3", title: "Teams share calendars",
                            text: "Everyone in a team sees the same calendars, kept on your Calimero cluster.")
                        Divider().overlay(Theme.line)
                        FeatureRow(
                            symbol: "lock.fill", title: "Private events stay private",
                            text: "A private event never leaves this device.")
                        Divider().overlay(Theme.line)
                        FeatureRow(
                            symbol: "person.badge.key", title: "Sign in with a passkey",
                            text: "No password: your device's passkey opens your account.")
                    }
                    .card(padding: 4)

                    form
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 24)
            }
        }
    }

    @ViewBuilder private var form: some View {
        VStack(alignment: .leading, spacing: 12) {
            if mode == .development {
                Theme.label("Development node URL")
                urlField("http://localhost:2501", text: $devNodeURL)
                Theme.label("Your name")
                TextField("e.g. Ada", text: $name).textInputAutocapitalization(.words).fieldStyle()
                Text("For a `merod local` cluster: mock attestation is allowed and a passkey is kept on this device for that node.")
                    .font(Theme.body(13)).foregroundStyle(Theme.muted)
            } else {
                Theme.label("Cluster")
                urlField("https://node.your-cluster.calimero.network", text: $clusterURL)
                if mode == .create {
                    Theme.label("Your name")
                    TextField("e.g. Ada Lovelace", text: $name).textInputAutocapitalization(.words).fieldStyle()
                }
            }

            if let error = client.errorMessage, !busy {
                Text(error).font(Theme.body(13)).foregroundStyle(Theme.danger)
            }

            Button(action: submit) {
                if busy { ProgressView().tint(Theme.ink) } else { Text(primaryTitle) }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(busy || !canSubmit)
            .accessibilityIdentifier("signin.primary")

            HStack {
                switch mode {
                case .signIn:
                    Button("Create an account") { mode = .create }
                case .create:
                    Button("I have an account") { mode = .signIn }
                case .development:
                    Button("Use Calimero Cloud") { mode = .signIn }
                }
                Spacer()
                if mode != .development {
                    Button("Development node") { mode = .development }
                        .accessibilityIdentifier("signin.development")
                }
            }
            .font(Theme.body(14, .semibold))
            .foregroundStyle(Theme.ink)
            .disabled(busy)
        }
    }

    private func urlField(_ placeholder: String, text: Binding<String>) -> some View {
        TextField(placeholder, text: text)
            .keyboardType(.URL)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .fieldStyle()
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
        Theme.haptic()
        busy = true
        Task {
            switch mode {
            case .signIn:
                session.connect(nodeURL: clusterURL, allowMock: false)
                await session.signIn()
            case .create:
                session.connect(nodeURL: clusterURL, allowMock: false)
                await session.signUp(name: trimmedName)
            case .development:
                session.connect(nodeURL: devNodeURL, allowMock: true)
                _ = await client.signInOrSignUp(name: trimmedName.isEmpty ? nil : trimmedName)
                session.rebuild()
            }
            busy = false
        }
    }
}

private struct FeatureRow: View {
    let symbol: String
    let title: String
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: symbol)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Theme.ink)
                .frame(width: 36, height: 36)
                .background(Theme.lime.opacity(0.35), in: RoundedRectangle(cornerRadius: 9))
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(Theme.body(15, .semibold)).foregroundStyle(Theme.ink)
                Text(text).font(Theme.body(14)).foregroundStyle(Theme.muted)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
    }
}
