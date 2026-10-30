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
            NodeSheet(current: client.nodeURL ?? "", allowMock: client.allowMock) { url, allowMock in
                showNode = false
                session.connect(nodeURL: url, allowMock: allowMock)
            }
            .presentationDetents([.medium, .large])
        }
    }

    private var nodeLine: String {
        guard let url = client.nodeURL else { return "Choose the cluster your worlds run on to sign in." }
        let host = URL(string: url)?.host ?? url
        return client.allowMock ? "Development cluster at \(host) (mock attestation)." : "Signing in to \(host)."
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

/// The node to talk to: one of the cluster's nodes from Calimero Cloud's
/// console, or a development cluster (`merod local`) with mock attestation.
private struct NodeSheet: View {
    let submit: (_ url: String, _ allowMock: Bool) -> Void
    @State private var url: String
    @State private var allowMock: Bool
    @SwiftUI.Environment(\.dismiss) private var dismiss

    init(current: String, allowMock: Bool, submit: @escaping (_ url: String, _ allowMock: Bool) -> Void) {
        self.submit = submit
        _url = State(initialValue: current)
        _allowMock = State(initialValue: allowMock)
    }

    private var trimmed: String { url.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("Paste the address of a node in your cluster. The app checks the node's attestation before it sends anything.")
                    .font(Theme.body(15))
                    .foregroundStyle(Theme.muted)
                TextField("https://node.example.calimero.network", text: $url)
                    .font(Theme.body(15))
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .card(padding: 14)
                Toggle(isOn: $allowMock) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Development cluster").font(Theme.body(15, .medium)).foregroundStyle(Theme.ink)
                        Text("Trust mock attestation, as `merod local` serves. Never for a real cluster.")
                            .font(Theme.body(13))
                            .foregroundStyle(Theme.muted)
                    }
                }
                .tint(Theme.ink)
                .card(padding: 14)
                Button("Use this node") {
                    Haptics.tap()
                    submit(trimmed, allowMock)
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(URL(string: trimmed)?.scheme == nil)
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
