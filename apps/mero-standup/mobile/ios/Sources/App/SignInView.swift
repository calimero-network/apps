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
    @ObservedObject var client: MeroClient
    @AppStorage("signin.clusterURL") private var clusterURL = AppConfig.clusterURL ?? ""
    @AppStorage("signin.devNodeURL") private var devNodeURL = AppConfig.devNodeURL
    @AppStorage("signin.name") private var name = ""
    @State private var mode: Mode = .signIn
    @State private var signingIn = false

    enum Mode { case signIn, create, development }

    private let points = [
        "Lives on your team's own Calimero cluster. Nobody else can read it.",
        "Yesterday's plan becomes today's draft, so posting takes seconds.",
        "Decisions are never edited, only superseded, so the why survives.",
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                Spacer(minLength: 40)
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(Palette.lime)
                    .frame(width: 64, height: 64)
                    .overlay(Image(systemName: "sun.max").font(.system(size: 30, weight: .semibold)).foregroundStyle(Palette.ink))
                VStack(alignment: .leading, spacing: 10) {
                    Text("Mero Standup").font(.largeTitle.weight(.bold)).foregroundStyle(Palette.ink)
                    Text(
                        "Async standups and a decision log for your team. Post what you did, what is next and what is in your way; record what you decided and why."
                    )
                    .font(.body).foregroundStyle(Palette.ink2)
                }
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(points, id: \.self) { point in
                        Label {
                            Text(point).font(.subheadline).foregroundStyle(Palette.ink)
                        } icon: {
                            Image(systemName: "checkmark.circle").foregroundStyle(Palette.ink)
                        }
                    }
                }
                if session.pendingInvitation != nil {
                    Card {
                        Label("You're invited to a team. Sign in to join it.", systemImage: "envelope.open")
                            .font(.subheadline.weight(.medium)).foregroundStyle(Palette.ink)
                    }
                }
                form
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
        .screenBackground()
    }

    @ViewBuilder private var form: some View {
        VStack(alignment: .leading, spacing: 12) {
            if mode == .development {
                SectionLabel(title: "Development node URL")
                field("http://localhost:2501", text: $devNodeURL, url: true)
                SectionLabel(title: "Your name")
                field("e.g. Ada", text: $name, url: false)
                Text("For a `merod local` cluster: mock attestation is allowed and a passkey is kept on this device for that node.")
                    .font(.footnote).foregroundStyle(Palette.ink2)
            } else {
                SectionLabel(title: "Cluster")
                field("https://node.your-cluster.calimero.network", text: $clusterURL, url: true)
                if mode == .create {
                    SectionLabel(title: "Your name")
                    field("e.g. Ada Lovelace", text: $name, url: false)
                }
            }

            Button(action: submit) {
                if busy {
                    HStack(spacing: 8) {
                        ProgressView().tint(Palette.ink)
                        Text("Connecting…")
                    }
                } else {
                    Text(primaryTitle)
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(busy || !canSubmit)
            .accessibilityIdentifier("signin.primary")

            if let message = client.errorMessage, !busy {
                ErrorLine(message: message)
            }

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
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Palette.ink)
            .disabled(busy)
        }
    }

    private func field(_ placeholder: String, text: Binding<String>, url: Bool) -> some View {
        TextField(placeholder, text: text)
            .keyboardType(url ? .URL : .default)
            .textInputAutocapitalization(url ? .never : .words)
            .autocorrectionDisabled(url)
            .padding(12)
            .background(Palette.sunken, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var busy: Bool { signingIn || session.isRestoring }

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
        signingIn = true
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
            signingIn = false
        }
    }
}
