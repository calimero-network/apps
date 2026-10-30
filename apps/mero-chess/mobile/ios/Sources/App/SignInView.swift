import MeroKitUI
import SwiftUI

/// Signed out: what the app is, then sign-in to a Calimero 1.0 cluster.
///
/// - Calimero Cloud: the cluster's node URL (from the console, or baked in as
///   `CalimeroClusterURL`), then the device's passkey. "Create an account" registers a new
///   passkey under a name.
/// - Development: a `merod local` node URL with mock attestation allowed; the SDK makes and keeps
///   a software passkey for that node.
struct SignInView: View {
    @ObservedObject var session: MeroAppSession
    @ObservedObject var client: MeroClient
    let invited: Bool
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
                VStack(alignment: .leading, spacing: 24) {
                    AppMark(size: 64).padding(.top, 48)
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Mero Chess").font(Theme.heading(34)).foregroundStyle(Theme.ink)
                        Text(
                            "Two-player chess where the rules run in the contract, on your Calimero cluster, not on a game server."
                        )
                        .font(Theme.body(16)).foregroundStyle(Theme.ink2)
                    }
                    VStack(alignment: .leading, spacing: 14) {
                        Point(icon: "server.rack", text: "No game server")
                        Point(icon: "checkmark.shield", text: "Rules run in the contract")
                        Point(icon: "person.badge.key", text: "Sign in with a passkey")
                    }
                    .card()

                    if invited {
                        HStack(spacing: 12) {
                            Image(systemName: "envelope.open").foregroundStyle(Theme.ink)
                            Text("You've been invited to a table. Sign in to join it.")
                                .font(Theme.body(14)).foregroundStyle(Theme.ink)
                        }
                        .padding(14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.limeSoft))
                    }

                    form
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 32)
            }
        }
    }

    @ViewBuilder private var form: some View {
        VStack(alignment: .leading, spacing: 12) {
            if mode == .development {
                label("Development node URL")
                field("http://localhost:2501", text: $devNodeURL, url: true)
                label("Your name")
                field("e.g. Ada", text: $name, url: false)
                Text("For a `merod local` cluster: mock attestation is allowed and a passkey is kept on this device for that node.")
                    .font(Theme.body(13)).foregroundStyle(Theme.muted)
            } else {
                label("Cluster")
                field("https://node.your-cluster.calimero.network", text: $clusterURL, url: true)
                if mode == .create {
                    label("Your name")
                    field("e.g. Ada Lovelace", text: $name, url: false)
                }
            }

            if let message = client.errorMessage, !busy {
                ErrorBanner(message: message) { client.errorMessage = nil }
            }

            Button(action: submit) {
                HStack(spacing: 10) {
                    if busy { ProgressView().tint(Theme.ink) }
                    Text(busy ? "Signing in…" : primaryTitle)
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(busy || !canSubmit)
            .accessibilityIdentifier("signin.primary")

            HStack {
                switch mode {
                case .signIn: Button("Create an account") { mode = .create }
                case .create: Button("I have an account") { mode = .signIn }
                case .development: Button("Use Calimero Cloud") { mode = .signIn }
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

    private func label(_ text: String) -> some View {
        Text(text).font(Theme.body(12, .semibold)).foregroundStyle(Theme.muted)
    }

    private func field(_ placeholder: String, text: Binding<String>, url: Bool) -> some View {
        TextField(placeholder, text: text)
            .keyboardType(url ? .URL : .default)
            .textInputAutocapitalization(url ? .never : .words)
            .autocorrectionDisabled(url)
            .font(Theme.body(15))
            .padding(.horizontal, 14)
            .frame(minHeight: 46)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.surface))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.line, lineWidth: 1))
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
        Haptics.tap()
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

    private struct Point: View {
        let icon: String
        let text: String

        var body: some View {
            HStack(spacing: 12) {
                Image(systemName: icon).font(.system(size: 17, weight: .medium)).foregroundStyle(Theme.ink)
                    .frame(width: 24)
                Text(text).font(Theme.body(15, .medium)).foregroundStyle(Theme.ink)
            }
        }
    }
}
