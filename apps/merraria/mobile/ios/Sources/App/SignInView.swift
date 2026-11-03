import MeroKit
import MeroKitUI
import SwiftUI

/// Signed out: what the game is, and a passkey on the cluster. A developer can point the app at
/// another node (a `merod local` cluster with mock attestation). Laid out for landscape: the pitch
/// on the left, signing in on the right.
struct SignInView: View {
    @ObservedObject var session: MeroAppSession
    @ObservedObject var client: MeroClient
    let invited: Bool
    @State private var showCreate = false
    @State private var showNode: ClusterSheet.Mode?

    var body: some View {
        ZStack {
            Theme.ground.ignoresSafeArea()
            ScrollView {
                HStack(alignment: .top, spacing: 32) {
                    VStack(alignment: .leading, spacing: 16) {
                        AppMark(size: 60)
                        Text("Merraria").font(Theme.heading(34)).foregroundStyle(Theme.ink)
                        Text(
                            "Mine and build together in a 2D world with no game server. Every dig is shared state on your attested Calimero cluster."
                        )
                        .font(Theme.body(16)).foregroundStyle(Theme.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                        VStack(alignment: .leading, spacing: 12) {
                            Point(icon: "server.rack", text: "No game server")
                            Point(icon: "person.2", text: "Play with friends by invitation")
                            Point(icon: "person.badge.key", text: "Your Calimero account, with a passkey")
                        }
                        .padding(.top, 4)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    VStack(alignment: .leading, spacing: 16) {
                        if invited {
                            HStack(spacing: 12) {
                                Image(systemName: "envelope.open").foregroundStyle(Theme.ink)
                                Text("You've been invited to a world. Sign in to join it.")
                                    .font(Theme.body(14)).foregroundStyle(Theme.ink)
                            }
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.limeSoft))
                        }
                        if let message = client.errorMessage {
                            ErrorBanner(message: message) {}
                        }
                        if client.nodeURL == nil {
                            Button {
                                showNode = .cloud
                            } label: {
                                Label("Sign in with Calimero Cloud", systemImage: "cloud")
                            }
                            .buttonStyle(PrimaryButtonStyle())
                            .accessibilityIdentifier("chooseNodeButton")
                            Button {
                                showNode = .development
                            } label: {
                                Label("Development node", systemImage: "hammer")
                            }
                            .buttonStyle(SecondaryButtonStyle())
                            .accessibilityIdentifier("developmentNodeButton")
                        } else {
                            Button {
                                Haptics.tap()
                                Task { await signIn() }
                            } label: {
                                HStack(spacing: 10) {
                                    if client.isLoading {
                                        ProgressView().tint(Theme.ink)
                                    } else {
                                        Image(systemName: "person.badge.key")
                                    }
                                    Text(client.isLoading ? "Waiting for your passkey…" : "Sign in with a passkey")
                                }
                            }
                            .buttonStyle(PrimaryButtonStyle())
                            .disabled(client.isLoading)
                            .accessibilityIdentifier("signInButton")
                            Button("Create an account") { showCreate = true }
                                .buttonStyle(SecondaryButtonStyle())
                                .disabled(client.isLoading)
                        }
                        HStack(spacing: 6) {
                            Text(nodeLine).font(Theme.body(13)).foregroundStyle(Theme.muted).lineLimit(2)
                            Spacer(minLength: 0)
                            if client.nodeURL != nil {
                                Button("Change") { showNode = client.allowMock ? .development : .cloud }
                                    .font(Theme.body(13, .semibold))
                                    .accessibilityIdentifier("changeNodeButton")
                            }
                        }
                    }
                    .card(padding: 20)
                    .frame(maxWidth: 380)
                }
                .padding(.horizontal, 32)
                .padding(.vertical, 28)
            }
        }
        .sheet(isPresented: $showCreate) {
            CreateAccountSheet { name in
                showCreate = false
                Task { await session.signUp(name: name) }
            }
            .presentationDetents([.medium, .large])
        }
        .sheet(item: $showNode) { mode in
            ClusterSheet(mode: mode, current: client.nodeURL ?? "") { entry in
                showNode = nil
                Task { await connect(entry, mode: mode) }
            }
            .presentationDetents([.large])
        }
    }

    /// A Cloud cluster by its name (its nodes come from the node directory) or a node's URL; a
    /// development node (`merod local`) by URL, with mock attestation allowed.
    private func connect(_ entry: String, mode: ClusterSheet.Mode) async {
        switch mode {
        case .development:
            session.connect(nodeURL: entry, allowMock: true)
        case .cloud where entry.contains("://"):
            session.connect(nodeURL: entry, allowMock: false)
        case .cloud:
            await client.connect(cluster: entry)
            session.rebuild()
        }
    }

    private var nodeLine: String {
        guard let url = client.nodeURL else { return "Sign in on the Calimero cluster your worlds run on." }
        let host = URL(string: url)?.host ?? url
        return client.allowMock ? "Development node at \(host) (mock attestation)." : "Signing in to \(host)."
    }

    /// A platform passkey on a real cluster. On a development cluster the app keeps a soft passkey
    /// for the node, and the first sign-in creates its account.
    private func signIn() async {
        if client.allowMock {
            await client.signInOrSignUp()
            session.rebuild()
        } else {
            await session.signIn()
        }
    }

    private struct Point: View {
        let icon: String
        let text: String

        var body: some View {
            HStack(spacing: 12) {
                Image(systemName: icon).font(.system(size: 16, weight: .medium)).foregroundStyle(Theme.ink)
                    .frame(width: 24)
                Text(text).font(Theme.body(15, .medium)).foregroundStyle(Theme.ink)
            }
        }
    }
}

/// A name for a new account, then a new passkey.
private struct CreateAccountSheet: View {
    let submit: (String) -> Void
    @State private var name = ""
    @SwiftUI.Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("Your name is what other players see. A new passkey on this phone signs you in from now on.")
                    .font(Theme.body(15))
                    .foregroundStyle(Theme.muted)
                TextField("Your name", text: $name)
                    .font(Theme.body(15))
                    .textContentType(.name)
                    .focused($focused)
                    .card(padding: 14)
                Button("Create the passkey") {
                    Haptics.tap()
                    submit(name.trimmingCharacters(in: .whitespacesAndNewlines))
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Spacer()
            }
            .padding(16)
            .background(Theme.ground)
            .navigationTitle("Create an account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) { Button("Cancel") { dismiss() } }
            }
            .onAppear { focused = true }
        }
    }
}

/// Where to sign in: a Calimero Cloud cluster, by name (`acme`) or a node's URL, or a development
/// node (`merod local`) whose mock attestation is trusted.
struct ClusterSheet: View {
    enum Mode: String, Identifiable {
        case cloud, development
        var id: String { rawValue }
    }

    let mode: Mode
    let submit: (String) -> Void
    @State private var entry: String
    @SwiftUI.Environment(\.dismiss) private var dismiss

    init(mode: Mode, current: String, submit: @escaping (String) -> Void) {
        self.mode = mode
        self.submit = submit
        _entry = State(initialValue: current)
    }

    private var trimmed: String { entry.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var valid: Bool {
        switch mode {
        case .cloud: return !trimmed.isEmpty && (!trimmed.contains("://") || URL(string: trimmed)?.host != nil)
        case .development: return URL(string: trimmed)?.scheme != nil
        }
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text(
                    mode == .cloud
                        ? "Enter your cluster's name from Calimero Cloud, or the address of one of its nodes. The app checks each node's attestation before it sends anything."
                        : "Enter the address `merod local` printed. The app trusts its mock attestation, so use this only for a cluster on your own machine."
                )
                .font(Theme.body(15))
                .foregroundStyle(Theme.muted)
                TextField(mode == .cloud ? "Cluster name or URL" : "http://localhost:2501", text: $entry)
                    .font(Theme.body(15))
                    .keyboardType(mode == .cloud ? .default : .URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .card(padding: 14)
                    .accessibilityIdentifier("clusterField")
                Button(mode == .cloud ? "Continue" : "Use this node") {
                    Haptics.tap()
                    submit(trimmed)
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!valid)
                Spacer()
            }
            .padding(16)
            .background(Theme.ground)
            .navigationTitle(mode == .cloud ? "Calimero Cloud" : "Development node")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) { Button("Cancel") { dismiss() } }
            }
        }
    }
}
