import PixartCore
import MeroKit
import MeroKitUI
import SwiftUI

/// Sign in to the team's Calimero cluster with a passkey, or create an
/// account. A developer can point the app at another node instead, such as a
/// `merod local` cluster with mock attestation.
struct SignInView: View {
    @ObservedObject var session: MeroAppSession
    @ObservedObject var client: MeroClient
    @State private var showCreate = false
    @State private var showNode = false

    var body: some View {
        ZStack {
            Theme.ground.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 0) {
                Spacer()
                AppMark(size: 64)
                Text("Mero PixArt")
                    .font(Theme.heading(34))
                    .foregroundStyle(Theme.ink)
                    .padding(.top, 24)
                Text("Your team's artwork, on your phone. Look closely, check layers and share the image.")
                    .font(Theme.body(17))
                    .foregroundStyle(Theme.muted)
                    .padding(.top, 10)
                VStack(alignment: .leading, spacing: 14) {
                    Feature(icon: "photo.on.rectangle.angled", text: "Every project in your teams, at a glance")
                    Feature(icon: "square.3.layers.3d", text: "Pinch into the artwork and peek at its layers")
                    Feature(icon: "square.and.arrow.up", text: "Export the image as PNG")
                }
                .padding(.top, 28)
                Spacer()
                if let error = client.errorMessage {
                    Text(error)
                        .font(Theme.body(14))
                        .foregroundStyle(Theme.danger)
                        .padding(.bottom, 12)
                        .accessibilityIdentifier("signInError")
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
                        .padding(.top, 10)
                }
                HStack(spacing: 6) {
                    Text(nodeLine)
                        .font(Theme.body(12))
                        .foregroundStyle(Theme.faint)
                        .lineLimit(2)
                    Spacer(minLength: 0)
                    if client.nodeURL != nil {
                        Button("Change") { showNode = true }
                            .font(Theme.body(12, .medium))
                            .accessibilityIdentifier("changeNodeButton")
                    }
                }
                .padding(.top, 14)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 16)
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
        guard let url = client.nodeURL else {
            return "Your work lives on your team's Calimero cluster. Choose it to sign in."
        }
        let host = URL(string: url)?.host ?? url
        return client.allowMock
            ? "Development cluster at \(host) (mock attestation)."
            : "Signing in to \(host), an attested Calimero cluster."
    }

    /// A platform passkey on a real cluster. On a development cluster the app
    /// keeps a soft passkey for the node, and the first sign-in creates its account.
    private func signIn() async {
        if client.allowMock {
            await client.signInOrSignUp()
            session.rebuild()
        } else {
            await session.signIn()
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
                Text("Your name is what your studio sees. A new passkey on this phone signs you in from now on.")
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
                Text("Paste the address of a node in your team's cluster. The app checks the node's attestation before it sends anything.")
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
