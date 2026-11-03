import MeroKit
import MeroKitUI
import SwiftUI

/// Signed out: what the app is, and a passkey on the cluster. A developer can point the app at
/// another node (a `merod local` cluster with mock attestation).
struct SignInView: View {
    @ObservedObject var session: MeroAppSession
    @ObservedObject var client: MeroClient
    let invited: Bool
    @State private var showCreate = false
    @State private var showNode = false

    var body: some View {
        ZStack {
            Theme.ground.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    AppMark(size: 64).padding(.top, 48)
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Mero Blocks").font(Theme.heading(34)).foregroundStyle(Theme.ink)
                        Text(
                            "Build together in real time. The world is a Calimero app instance: every block you place is shared state, on your attested cluster, with no game server."
                        )
                        .font(Theme.body(16)).foregroundStyle(Theme.ink2)
                    }
                    VStack(alignment: .leading, spacing: 14) {
                        Point(icon: "server.rack", text: "No game server")
                        Point(icon: "person.2", text: "Play with friends from a link")
                        Point(icon: "person.badge.key", text: "Your Calimero account, with a passkey")
                    }
                    .card()

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
                            showNode = true
                        } label: {
                            Label("Choose your cluster", systemImage: "server.rack")
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .accessibilityIdentifier("chooseNodeButton")
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
                            Button("Change") { showNode = true }
                                .font(Theme.body(13, .semibold))
                                .accessibilityIdentifier("changeNodeButton")
                        }
                    }
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 32)
            }
        }
        .sheet(isPresented: $showCreate) {
            CreateAccountSheet { name in
                showCreate = false
                Task { await session.signUp(name: name) }
            }
            .presentationDetents([.medium])
        }
        .sheet(isPresented: $showNode) {
            NodeSheet(current: client.nodeURL ?? "", allowMock: client.allowMock) { choice in
                if let failure = await use(choice) { return failure }
                showNode = false
                return nil
            }
            .presentationDetents([.medium, .large])
        }
    }

    private var nodeLine: String {
        guard let url = client.nodeURL else { return "Choose the cluster your worlds run on to sign in." }
        let host = URL(string: url)?.host ?? url
        return client.allowMock ? "Development node at \(host) (mock attestation)." : "Calimero Cloud, node \(host)."
    }

    /// Connect to the chosen cluster. Answers why it failed, or nil.
    private func use(_ choice: ClusterChoice) async -> String? {
        switch choice {
        case .development(let url):
            session.connect(nodeURL: url, allowMock: true)
            return nil
        case .cloud(let text) where ClusterChoice.isURL(text):
            session.connect(nodeURL: text, allowMock: false)
            return nil
        case .cloud(let name):
            let ok = await client.connect(cluster: name)
            session.rebuild()
            return ok ? nil : (client.errorMessage ?? "No cluster is called “\(name)”.")
        }
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
                Image(systemName: icon).font(.system(size: 17, weight: .medium)).foregroundStyle(Theme.ink)
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

/// Where to sign in: a Calimero Cloud cluster (by name, or one of its nodes'
/// URLs), or a development node (`merod local`, mock attestation).
enum ClusterChoice: Equatable {
    case cloud(String)
    case development(String)

    /// A URL is a node; anything else is a cluster name for the node directory.
    static func isURL(_ text: String) -> Bool {
        guard let url = URL(string: text), let scheme = url.scheme?.lowercased() else { return false }
        return (scheme == "https" || scheme == "http") && url.host != nil
    }
}

private struct NodeSheet: View {
    let submit: (ClusterChoice) async -> String?
    @State private var development: Bool
    @State private var cloud: String
    @State private var local: String
    @State private var busy = false
    @State private var error: String?
    @SwiftUI.Environment(\.dismiss) private var dismiss

    init(current: String, allowMock: Bool, submit: @escaping (ClusterChoice) async -> String?) {
        self.submit = submit
        _development = State(initialValue: allowMock)
        _cloud = State(initialValue: allowMock ? "" : current)
        _local = State(initialValue: allowMock && !current.isEmpty ? current : "http://127.0.0.1:2501")
    }

    private var value: String { (development ? local : cloud).trimmingCharacters(in: .whitespacesAndNewlines) }
    private var canUse: Bool { development ? ClusterChoice.isURL(value) : !value.isEmpty }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Picker("Where", selection: $development) {
                    Text("Calimero Cloud").tag(false)
                    Text("Development node").tag(true)
                }
                .pickerStyle(.segmented)
                Text(
                    development
                        ? "A node you run with `merod local`. Its attestation is a mock, so use this only for development."
                        : "Your cluster's name from Calimero Cloud, or the address of one of its nodes. The app checks each node's attestation before it sends anything."
                )
                .font(Theme.body(15))
                .foregroundStyle(Theme.muted)
                TextField(development ? "http://127.0.0.1:2501" : "eu-shared-1", text: development ? $local : $cloud)
                    .font(.system(size: 15, design: .monospaced))
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .card(padding: 14)
                    .accessibilityIdentifier("clusterField")
                if let error {
                    Text(error).font(Theme.body(13)).foregroundStyle(Theme.danger)
                }
                Button {
                    Haptics.tap()
                    busy = true
                    error = nil
                    Task {
                        error = await submit(development ? .development(value) : .cloud(value))
                        busy = false
                    }
                } label: {
                    if busy { ProgressView().tint(Theme.ink) } else { Text("Use") }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!canUse || busy)
                Spacer()
            }
            .padding(16)
            .background(Theme.ground)
            .navigationTitle("Your cluster")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) { Button("Cancel") { dismiss() } }
            }
        }
    }
}
