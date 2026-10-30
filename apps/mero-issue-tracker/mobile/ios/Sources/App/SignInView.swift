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
    @EnvironmentObject private var session: MeroAppSession
    @AppStorage("signin.clusterURL") private var clusterURL = AppConfig.clusterURL ?? ""
    @AppStorage("signin.devNodeURL") private var devNodeURL = AppConfig.devNodeURL
    @AppStorage("signin.name") private var name = ""
    @State private var mode: Mode = .signIn
    @State private var busy = false

    enum Mode { case signIn, create, development }

    var body: some View {
        SignInForm(
            session: session, client: session.client, clusterURL: $clusterURL, devNodeURL: $devNodeURL, name: $name,
            mode: $mode, busy: $busy)
    }
}

private struct SignInForm: View {
    let session: MeroAppSession
    @ObservedObject var client: MeroClient
    @Binding var clusterURL: String
    @Binding var devNodeURL: String
    @Binding var name: String
    @Binding var mode: SignInView.Mode
    @Binding var busy: Bool

    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                VStack(spacing: 18) {
                    Image(systemName: "checklist")
                        .font(.system(size: 34, weight: .semibold))
                        .foregroundStyle(Theme.ink)
                        .frame(width: 76, height: 76)
                        .background(Theme.lime, in: RoundedRectangle(cornerRadius: 22))
                    Text("Mero Issue Tracker").font(Theme.heading(28)).foregroundStyle(Theme.ink)
                    Text("A private, real-time issue board for a small engineering team. Create, triage and discuss issues together.")
                        .font(.system(size: 16)).foregroundStyle(Theme.text2).multilineTextAlignment(.center)
                }
                .padding(.top, 56)
                .padding(.horizontal, 8)

                form
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.ground.ignoresSafeArea())
    }

    @ViewBuilder private var form: some View {
        VStack(alignment: .leading, spacing: 12) {
            if mode == .development {
                label("Development node URL")
                urlField("http://localhost:2501", text: $devNodeURL)
                label("Your name")
                field(TextField("e.g. Ada", text: $name).textInputAutocapitalization(.words))
                Text("For a `merod local` cluster: mock attestation is allowed and a passkey is kept on this device for that node.")
                    .font(.system(size: 13)).foregroundStyle(Theme.text3)
            } else {
                label("Cluster")
                urlField("https://node.your-cluster.calimero.network", text: $clusterURL)
                if mode == .create {
                    label("Your name")
                    field(TextField("e.g. Ada Lovelace", text: $name).textInputAutocapitalization(.words))
                }
            }

            if let error = client.errorMessage, !busy {
                Text(error).font(.system(size: 14)).foregroundStyle(Theme.danger)
            }

            Button(action: submit) {
                HStack(spacing: 8) {
                    if busy { ProgressView().tint(Theme.ink) }
                    Text(busy ? "Waiting for your passkey…" : primaryTitle)
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
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(Theme.ink)
            .disabled(busy)

            Text("Your board lives on your team's Calimero cluster. Your device's passkey opens your account; no password.")
                .font(.system(size: 13)).foregroundStyle(Theme.text3)
                .padding(.top, 4)
        }
    }

    private func label(_ text: String) -> some View {
        Text(text).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.text2)
    }

    private func field(_ content: some View) -> some View {
        content
            .font(.system(size: 16))
            .padding(.horizontal, 14)
            .frame(minHeight: 48)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.radius))
            .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.line, lineWidth: 1))
    }

    private func urlField(_ placeholder: String, text: Binding<String>) -> some View {
        field(
            TextField(placeholder, text: text)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled())
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
