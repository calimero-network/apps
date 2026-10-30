import DesignCore
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
                VStack(alignment: .leading, spacing: 0) {
                    AppMark(size: 64).padding(.top, 48)
                    Text("Mero Design")
                        .font(Theme.heading(34))
                        .foregroundStyle(Theme.ink)
                        .padding(.top, 24)
                    Text("Your team's boards, on your phone. View designs, present screens and leave comments.")
                        .font(Theme.body(17))
                        .foregroundStyle(Theme.muted)
                        .padding(.top, 10)
                    VStack(alignment: .leading, spacing: 14) {
                        Feature(icon: "hand.draw", text: "Pan and pinch around any board")
                        Feature(icon: "play.rectangle", text: "Present screens full screen")
                        Feature(icon: "bubble.left", text: "Read and add comments")
                    }
                    .padding(.top, 28)
                    form.padding(.top, 32)
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 16)
            }
        }
    }

    @ViewBuilder private var form: some View {
        VStack(alignment: .leading, spacing: 12) {
            if mode == .development {
                FieldLabel("Development node URL")
                urlField("http://localhost:2501", text: $devNodeURL)
                FieldLabel("Your name")
                TextField("e.g. Ada", text: $name).textInputAutocapitalization(.words).signInField()
                Text("For a `merod local` cluster: mock attestation is allowed and a passkey is kept on this device for that node.")
                    .font(Theme.body(13)).foregroundStyle(Theme.muted)
            } else {
                FieldLabel("Cluster")
                urlField("https://node.your-cluster.calimero.network", text: $clusterURL)
                if mode == .create {
                    FieldLabel("Your name")
                    TextField("e.g. Ada Lovelace", text: $name).textInputAutocapitalization(.words).signInField()
                }
            }

            if let error = client.errorMessage, !busy {
                Text(error)
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.danger)
                    .accessibilityIdentifier("signInError")
            }

            Button(action: submit) {
                HStack(spacing: 10) {
                    if busy { ProgressView().tint(Theme.ink) }
                    Text(primaryTitle)
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(busy || !canSubmit)
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
            .font(Theme.body(14, .semibold))
            .foregroundStyle(Theme.ink)
            .disabled(busy)

            Text("Your boards live on your team's Calimero cluster. This phone holds no node; it signs in with a passkey.")
                .font(Theme.body(12))
                .foregroundStyle(Theme.faint)
                .padding(.top, 2)
        }
    }

    private func urlField(_ placeholder: String, text: Binding<String>) -> some View {
        TextField(placeholder, text: text)
            .keyboardType(.URL)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .signInField()
    }

    private var primaryTitle: String {
        switch mode {
        case .signIn: return busy ? "Waiting for your passkey…" : "Sign in with passkey"
        case .create: return busy ? "Creating your account…" : "Create account"
        case .development: return busy ? "Connecting…" : "Connect"
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
}

private struct FieldLabel: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text.uppercased())
            .font(Theme.body(12, .semibold))
            .foregroundStyle(Theme.muted)
            .tracking(0.4)
    }
}

private extension View {
    func signInField() -> some View {
        self.font(Theme.body(16))
            .padding(.horizontal, 14)
            .frame(minHeight: 48)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Theme.lineStrong, lineWidth: Theme.hairline))
    }
}

private struct Feature: View {
    let icon: String
    let text: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(Theme.ink)
                .frame(width: 36, height: 36)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Theme.line, lineWidth: Theme.hairline))
            Text(text).font(Theme.body(15)).foregroundStyle(Theme.ink2)
        }
    }
}
