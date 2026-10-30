import ForumCore
import MeroKitUI
import SwiftUI

/// The front door: what Mero Forum is, then sign-in to a Calimero 1.0 cluster.
///
/// - Calimero Cloud: the cluster's node URL (from the console, or baked in as
///   `CalimeroClusterURL`), then the device's passkey. "Create an account"
///   registers a new passkey under a name.
/// - Development: a `merod local` node URL with mock attestation allowed; the
///   SDK makes and keeps a software passkey for that node.
struct SignInView: View {
    @EnvironmentObject private var session: MeroAppSession
    var invitedTo: String?
    @AppStorage("signin.clusterURL") private var clusterURL = AppConfig.clusterURL ?? ""
    @AppStorage("signin.devNodeURL") private var devNodeURL = AppConfig.devNodeURL
    @AppStorage("signin.name") private var name = ""
    @State private var mode: Mode = .signIn
    @State private var busy = false

    enum Mode { case signIn, create, development }

    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                VStack(spacing: 20) {
                    Image(systemName: "bubble.left.and.bubble.right.fill")
                        .font(.system(size: 34, weight: .semibold))
                        .foregroundStyle(Palette.ink)
                        .frame(width: 84, height: 84)
                        .background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(Palette.lime))
                    VStack(spacing: 10) {
                        Text("Mero Forum").font(Typeface.display(34)).foregroundStyle(Palette.ink)
                        Text("Discussions for your community, on your own Calimero cluster. Sign in with a passkey.")
                            .font(.system(size: 17))
                            .foregroundStyle(Palette.muted)
                            .multilineTextAlignment(.center)
                    }
                    if let invitedTo {
                        HStack(spacing: 10) {
                            Image(systemName: "envelope.open")
                            Text("You're invited to join “\(invitedTo)”. Sign in to accept.")
                                .font(.system(size: 15, weight: .medium))
                        }
                        .foregroundStyle(Palette.ink)
                        .padding(14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Palette.limeSoft))
                    }
                }
                .padding(.top, 56)
                form
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Palette.ground.ignoresSafeArea())
    }

    @ViewBuilder private var form: some View {
        VStack(alignment: .leading, spacing: 12) {
            if mode == .development {
                fieldLabel("Development node URL")
                urlField("http://localhost:2501", text: $devNodeURL)
                fieldLabel("Your name")
                textField("e.g. Ada", text: $name)
                Text("For a `merod local` cluster: mock attestation is allowed and a passkey is kept on this device for that node.")
                    .font(.system(size: 13)).foregroundStyle(Palette.muted)
            } else {
                fieldLabel("Cluster")
                urlField("https://node.your-cluster.calimero.network", text: $clusterURL)
                if mode == .create {
                    fieldLabel("Your name")
                    textField("e.g. Ada Lovelace", text: $name)
                }
            }

            if let error = session.client.errorMessage, !busy {
                Text(error).font(.system(size: 14)).foregroundStyle(Palette.danger)
            }

            Button(action: submit) {
                if busy {
                    ProgressView().tint(Palette.ink)
                } else {
                    Label(primaryTitle, systemImage: mode == .development ? "network" : "person.badge.key")
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
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(Palette.ink)
            .disabled(busy)
        }
    }

    private func fieldLabel(_ text: String) -> some View {
        Text(text).font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.muted)
    }

    private func textField(_ placeholder: String, text: Binding<String>) -> some View {
        TextField(placeholder, text: text)
            .textInputAutocapitalization(.words)
            .font(.system(size: 16))
            .padding(.horizontal, 14)
            .frame(minHeight: 48)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.surface))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Palette.hairline, lineWidth: 1))
    }

    private func urlField(_ placeholder: String, text: Binding<String>) -> some View {
        textField(placeholder, text: text)
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
                _ = await session.client.signInOrSignUp(name: trimmedName.isEmpty ? nil : trimmedName)
                session.rebuild()
            }
            busy = false
        }
    }
}

/// Join a space or forum from a link: ask, join, then say where it landed.
struct InvitationSheet: View {
    @EnvironmentObject private var session: MeroAppSession
    @ObservedObject var model: InvitationModel
    let open: (InvitationDestination) -> Void

    var body: some View {
        VStack(spacing: 18) {
            switch model.stage {
            case .idle:
                EmptyView()
            case .confirm(let title, let isForum):
                header(symbol: "envelope.open", tone: Palette.limeSoft, title: "Join “\(title)”?")
                Text(
                    isForum
                        ? "Joining takes you straight into that forum."
                        : "Joining gives you access to the space and every forum in it."
                )
                .font(.system(size: 16)).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
                Spacer(minLength: 0)
                Button("Join") { accept() }.buttonStyle(PrimaryButtonStyle())
                Button("Not now") { model.reset() }.buttonStyle(SecondaryButtonStyle())
            case .joining(let title):
                ProgressView().tint(Palette.ink).controlSize(.large).padding(.top, 12)
                Text("Joining “\(title)”…").font(Typeface.display(22)).foregroundStyle(Palette.ink)
                Text("This takes a moment while your cluster admits you.")
                    .font(.system(size: 15)).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
                Spacer(minLength: 0)
            case .joined(let destination):
                header(symbol: "checkmark", tone: Palette.lime, title: "You're in “\(destination.forum?.forumName ?? destination.spaceName)”")
                Text(destination.forum == nil ? "Its forums are on the next screen." : "The forum opens next.")
                    .font(.system(size: 16)).foregroundStyle(Palette.muted)
                Spacer(minLength: 0)
                Button("Open") {
                    open(destination)
                    model.reset()
                }
                .buttonStyle(PrimaryButtonStyle())
            case .failed(let message):
                header(symbol: "exclamationmark.triangle", tone: Palette.dangerSoft, title: "Couldn't join")
                Text(message).font(.system(size: 16)).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
                Spacer(minLength: 0)
                if model.invitation != nil {
                    Button("Try again") { accept() }.buttonStyle(PrimaryButtonStyle())
                }
                Button("Close") { model.reset() }.buttonStyle(SecondaryButtonStyle())
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Palette.surface)
    }

    private func header(symbol: String, tone: Color, title: String) -> some View {
        VStack(spacing: 14) {
            Image(systemName: symbol)
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(Palette.ink)
                .frame(width: 60, height: 60)
                .background(Circle().fill(tone))
            Text(title).font(Typeface.display(22)).foregroundStyle(Palette.ink).multilineTextAlignment(.center)
        }
        .padding(.top, 8)
    }

    private func accept() {
        Haptics.tap()
        Task {
            await model.accept(backend: { session.backend }, didJoin: { await session.didJoinNamespace() })
            if case .joined = model.stage { Haptics.success() } else { Haptics.failure() }
        }
    }
}
