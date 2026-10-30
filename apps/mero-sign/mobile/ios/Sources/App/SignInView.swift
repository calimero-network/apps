import MeroKitUI
import SignCore
import SwiftUI

/// The front door: what Mero Sign is, and a passkey on the cluster. A
/// developer can point the app at another node (a `merod local` cluster with
/// mock attestation).
struct SignInView: View {
    @EnvironmentObject private var session: MeroAppSession
    var invitedTo: String?
    @State private var busy = false
    @State private var creating = false
    @State private var choosingNode = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 20) {
                Image(systemName: "signature")
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(Palette.ink)
                    .frame(width: 84, height: 84)
                    .background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(Palette.lime))
                VStack(spacing: 10) {
                    Text("Mero Sign").font(Typeface.display(34)).foregroundStyle(Palette.ink)
                    Text("Review and sign agreements with the people who sign them. Documents live on your workspace's attested Calimero cluster.")
                        .font(.system(size: 17))
                        .foregroundStyle(Palette.muted)
                        .multilineTextAlignment(.center)
                }
                if let invitedTo {
                    HStack(spacing: 10) {
                        Image(systemName: "envelope.open")
                        Text("You're invited to sign “\(invitedTo)”. Sign in to accept.")
                            .font(.system(size: 15, weight: .medium))
                    }
                    .foregroundStyle(Palette.ink)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Palette.limeSoft))
                }
            }
            .padding(.horizontal, 28)
            Spacer()
            VStack(spacing: 12) {
                if let error = session.client.errorMessage {
                    Text(error).font(.system(size: 14)).foregroundStyle(Palette.danger).multilineTextAlignment(.center)
                        .accessibilityIdentifier("signInError")
                }
                if session.client.nodeURL == nil {
                    Button {
                        choosingNode = true
                    } label: {
                        Label("Choose your cluster", systemImage: "server.rack")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .accessibilityIdentifier("chooseNodeButton")
                } else {
                    Button {
                        Haptics.tap()
                        run { await signIn() }
                    } label: {
                        if busy {
                            ProgressView().tint(Palette.ink)
                        } else {
                            Label("Sign in with a passkey", systemImage: "person.badge.key")
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(busy)
                    .accessibilityIdentifier("signInButton")
                    Button("Create an account") { creating = true }
                        .buttonStyle(SecondaryButtonStyle())
                        .disabled(busy)
                }
                HStack(spacing: 6) {
                    Text(nodeLine).font(.system(size: 13)).foregroundStyle(Palette.muted).lineLimit(2)
                    if session.client.nodeURL != nil {
                        Button("Change") { choosingNode = true }
                            .font(.system(size: 13, weight: .semibold))
                            .accessibilityIdentifier("changeNodeButton")
                    }
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Palette.ground.ignoresSafeArea())
        .sheet(isPresented: $creating) {
            NameSheet { name in
                creating = false
                run { await session.signUp(name: name) }
            }
            .presentationDetents([.medium])
        }
        .sheet(isPresented: $choosingNode) {
            NodeSheet(current: session.client.nodeURL ?? "", allowMock: session.client.allowMock) { url, allowMock in
                choosingNode = false
                session.connect(nodeURL: url, allowMock: allowMock)
            }
            .presentationDetents([.medium, .large])
        }
    }

    private var nodeLine: String {
        guard let url = session.client.nodeURL else { return "Choose the cluster your workspace runs on to sign in." }
        let host = URL(string: url)?.host ?? url
        return session.client.allowMock ? "Development cluster at \(host)." : "Signing in to \(host)."
    }

    private func run(_ work: @escaping () async -> Void) {
        busy = true
        Task {
            await work()
            busy = false
        }
    }

    /// A platform passkey on a real cluster. On a development cluster the app
    /// keeps a soft passkey for the node, and the first sign-in creates its account.
    private func signIn() async {
        if session.client.allowMock {
            await session.client.signInOrSignUp()
            session.rebuild()
        } else {
            await session.signIn()
        }
    }
}

/// A name for a new account, then a new passkey.
private struct NameSheet: View {
    @Environment(\.dismiss) private var dismiss
    let submit: (String) -> Void
    @State private var name = ""
    @FocusState private var focused: Bool

    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(spacing: 0) {
            SheetBar(
                title: "Create an account", action: "Create", canAct: !trimmed.isEmpty, busy: false,
                cancel: { dismiss() }, act: { submit(trimmed) })
            VStack(alignment: .leading, spacing: 12) {
                Text("Your name is what the people you sign with see. A new passkey on this phone signs you in from now on.")
                    .font(.system(size: 15)).foregroundStyle(Palette.muted)
                TextField("Your name", text: $name)
                    .font(.system(size: 16))
                    .textContentType(.name)
                    .focused($focused)
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.sunken))
                Spacer()
            }
            .padding(16)
        }
        .background(Palette.surface)
        .onAppear { focused = true }
    }
}

/// The node to talk to: one of the cluster's nodes from Calimero Cloud's
/// console, or a development cluster (`merod local`) with mock attestation.
private struct NodeSheet: View {
    @Environment(\.dismiss) private var dismiss
    let submit: (_ url: String, _ allowMock: Bool) -> Void
    @State private var url: String
    @State private var allowMock: Bool

    init(current: String, allowMock: Bool, submit: @escaping (_ url: String, _ allowMock: Bool) -> Void) {
        self.submit = submit
        _url = State(initialValue: current)
        _allowMock = State(initialValue: allowMock)
    }

    private var trimmed: String { url.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(spacing: 0) {
            SheetBar(
                title: "Your cluster", action: "Use", canAct: URL(string: trimmed)?.scheme != nil, busy: false,
                cancel: { dismiss() }, act: { submit(trimmed, allowMock) })
            VStack(alignment: .leading, spacing: 12) {
                Text("Paste the address of a node in your workspace's cluster. The app checks the node's attestation before it sends anything.")
                    .font(.system(size: 15)).foregroundStyle(Palette.muted)
                TextField("https://node.example.calimero.network", text: $url)
                    .font(.system(size: 15, design: .monospaced))
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.sunken))
                Toggle(isOn: $allowMock) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Development cluster").font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.ink)
                        Text("Trust mock attestation, as `merod local` serves. Never for a real cluster.")
                            .font(.system(size: 13)).foregroundStyle(Palette.muted)
                    }
                }
                .tint(Palette.ink)
                Spacer()
            }
            .padding(16)
        }
        .background(Palette.surface)
    }
}

/// Join from a link: ask, join, open the agreement, then say where it landed.
struct InvitationSheet: View {
    @EnvironmentObject private var session: MeroAppSession
    @ObservedObject var model: InvitationModel
    let open: (InvitationDestination) -> Void

    var body: some View {
        VStack(spacing: 18) {
            switch model.stage {
            case .idle:
                EmptyView()
            case .confirm(let title):
                header(symbol: "envelope.open", tone: Palette.limeSoft, title: "Open “\(title)”?")
                Text("You'll join its workspace and be registered as a signer of this agreement.")
                    .font(.system(size: 16)).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
                Spacer(minLength: 0)
                Button("Join and open") { accept() }.buttonStyle(PrimaryButtonStyle())
                Button("Not now") { model.reset() }.buttonStyle(SecondaryButtonStyle())
            case .joining(let title, let step):
                ProgressView().tint(Palette.ink).controlSize(.large).padding(.top, 12)
                Text("Joining “\(title)”").font(Typeface.display(22)).foregroundStyle(Palette.ink)
                    .multilineTextAlignment(.center)
                Text(step).font(.system(size: 15, weight: .medium)).foregroundStyle(Palette.inkSoft)
                Text("This can take a moment.")
                    .font(.system(size: 14)).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
                Spacer(minLength: 0)
            case .joined(let destination):
                header(
                    symbol: "checkmark", tone: Palette.lime,
                    title: "You're in “\(destination.agreement?.name ?? destination.workspaceName)”")
                Text(
                    destination.agreement == nil
                        ? "Its agreements appear in your inbox as they sync."
                        : "Its documents are ready to review."
                )
                .font(.system(size: 16)).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
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
            await model.accept(
                directory: {
                    guard let backend = session.backend else { return nil }
                    let signAdmin = BackendSignAdmin(backend: backend, client: (backend as? CalimeroAppBackend)?.client)
                    return AgreementDirectory(
                        backend: backend,
                        store: PrivateStore(
                            backend: backend, admin: signAdmin, applicationId: session.applicationId,
                            cache: DefaultsPrivateContextCache()))
                },
                didJoin: { await session.didJoinNamespace() })
            if case .joined = model.stage { Haptics.success() } else { Haptics.failure() }
        }
    }
}

/// Paste an invitation link someone sent you.
struct PasteInvitationSheet: View {
    @Environment(\.dismiss) private var dismiss
    let open: (String) -> Void
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            SheetBar(
                title: "Open an invitation", action: "Open",
                canAct: !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, busy: false,
                cancel: { dismiss() },
                act: {
                    let raw = text
                    dismiss()
                    open(raw)
                })
            VStack(alignment: .leading, spacing: 12) {
                Text("Paste the link you were sent to sign an agreement.")
                    .font(.system(size: 15)).foregroundStyle(Palette.muted)
                TextField("https://links.calimero.network/…", text: $text, axis: .vertical)
                    .font(.system(size: 15, design: .monospaced))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focused)
                    .lineLimit(3...6)
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.sunken))
                if UIPasteboard.general.hasStrings {
                    Button {
                        text = UIPasteboard.general.string ?? ""
                    } label: {
                        Label("Paste from clipboard", systemImage: "doc.on.clipboard")
                    }
                    .buttonStyle(SecondaryButtonStyle(compact: true))
                }
                Spacer()
            }
            .padding(16)
        }
        .background(Palette.surface)
        .onAppear { focused = true }
    }
}
