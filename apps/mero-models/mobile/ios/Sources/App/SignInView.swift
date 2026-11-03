import ModelsCore
import MeroKit
import MeroKitUI
import SwiftUI

/// Sign in to the studio's Calimero cluster. Two ways in, one screen:
///
/// - **Calimero Cloud**: the cluster's name (`eu-shared-1`, its nodes read
///   from the node directory) or one of its nodes' addresses, then a passkey
///   on this phone, or a new account.
/// - **Development node**: a `merod local` node by URL, trusting its mock
///   attestation. The app keeps a soft passkey for that node and creates the
///   account on the first sign-in.
struct SignInView: View {
    @ObservedObject var session: MeroAppSession
    @ObservedObject var client: MeroClient
    @AppStorage("models.signIn.cluster") private var cluster = ""
    @AppStorage("models.signIn.devNode") private var devNode = "http://127.0.0.1:2501"
    @AppStorage("models.signIn.development") private var development = false
    @State private var devName = ""
    @State private var showCreate = false
    @State private var working = false
    @State private var fieldError: String?
    @FocusState private var focused: Bool

    var body: some View {
        ZStack {
            Theme.ground.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    AppMark(size: 64)
                        .padding(.top, 48)
                    Text("Mero Models")
                        .font(Theme.heading(34))
                        .foregroundStyle(Theme.ink)
                        .padding(.top, 24)
                    Text("Your studio's 3D scenes, on your phone. Look around every model and see who is working on what.")
                        .font(Theme.body(17))
                        .foregroundStyle(Theme.muted)
                        .padding(.top, 10)
                    VStack(alignment: .leading, spacing: 14) {
                        Feature(icon: "rotate.3d", text: "Orbit, zoom and pan any scene")
                        Feature(icon: "lock", text: "See who has what checked out")
                        Feature(icon: "square.and.arrow.up", text: "Share a scene with a link")
                    }
                    .padding(.top, 28)

                    Picker("Where", selection: $development) {
                        Text("Calimero Cloud").tag(false)
                        Text("Development node").tag(true)
                    }
                    .pickerStyle(.segmented)
                    .padding(.top, 32)
                    .accessibilityIdentifier("signInMode")

                    if development { developmentForm } else { cloudForm }

                    if let error = fieldError ?? client.errorMessage {
                        Text(error)
                            .font(Theme.body(14))
                            .foregroundStyle(Theme.danger)
                            .padding(.top, 12)
                            .accessibilityIdentifier("signInError")
                    }
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 24)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .onAppear {
            if cluster.isEmpty, let url = client.nodeURL, !client.allowMock { cluster = url }
        }
        .onChange(of: development) { _ in fieldError = nil }
        .sheet(isPresented: $showCreate) {
            CreateAccountSheet { name in
                showCreate = false
                Task { await run { if await connectCloud() { await session.signUp(name: name) } } }
            }
            .presentationDetents([.medium])
        }
    }

    private var busy: Bool { working || client.isLoading }

    // MARK: Calimero Cloud

    @ViewBuilder private var cloudForm: some View {
        VStack(alignment: .leading, spacing: 12) {
            FieldLabel("Cluster")
            TextField("eu-shared-1 or https://node.example.com", text: $cluster)
                .font(Theme.body(15))
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($focused)
                .submitLabel(.go)
                .onSubmit { Task { await signIn() } }
                .card(padding: 14)
                .accessibilityIdentifier("clusterField")
            Text("The name or a node address from Calimero Cloud's console. The app checks the node's attestation before it sends anything.")
                .font(Theme.body(12))
                .foregroundStyle(Theme.faint)
            Button {
                Haptics.tap()
                Task { await signIn() }
            } label: {
                HStack(spacing: 10) {
                    if busy { ProgressView().tint(Theme.ink) } else { Image(systemName: "person.badge.key") }
                    Text(busy ? "Waiting for your passkey…" : "Sign in with a passkey")
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(busy || ClusterTarget.parse(cluster) == nil)
            .padding(.top, 6)
            .accessibilityIdentifier("signInButton")
            Button("Create an account") {
                fieldError = nil
                showCreate = true
            }
            .buttonStyle(SecondaryButtonStyle())
            .disabled(busy || ClusterTarget.parse(cluster) == nil)
            .accessibilityIdentifier("createAccountButton")
        }
        .padding(.top, 20)
    }

    // MARK: Development node

    @ViewBuilder private var developmentForm: some View {
        VStack(alignment: .leading, spacing: 12) {
            FieldLabel("Node URL")
            TextField("http://127.0.0.1:2501", text: $devNode)
                .font(Theme.body(15))
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .card(padding: 14)
                .accessibilityIdentifier("devNodeField")
            FieldLabel("Your name")
            TextField("For a new account on this node", text: $devName)
                .font(Theme.body(15))
                .textContentType(.name)
                .card(padding: 14)
            Text("For `merod local`: the node's mock attestation is trusted here only. Never use this for a real cluster.")
                .font(Theme.body(12))
                .foregroundStyle(Theme.faint)
            Button {
                Haptics.tap()
                Task { await signInDevelopment() }
            } label: {
                HStack(spacing: 10) {
                    if busy { ProgressView().tint(Theme.ink) } else { Image(systemName: "server.rack") }
                    Text(busy ? "Signing in…" : "Sign in to this node")
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(busy || devURL == nil)
            .padding(.top, 6)
            .accessibilityIdentifier("devSignInButton")
        }
        .padding(.top, 20)
    }

    private var devURL: String? {
        if case .url(let url)? = ClusterTarget.parse(devNode) { return url }
        return nil
    }

    // MARK: Actions

    private func run(_ body: () async -> Void) async {
        working = true
        fieldError = nil
        await body()
        working = false
    }

    /// Point the client at what the field names: a node by URL, or a cluster's
    /// nodes from the directory. `false` (with the reason shown) when it can't.
    private func connectCloud() async -> Bool {
        switch ClusterTarget.parse(cluster) {
        case .url(let url)?:
            session.connect(nodeURL: url, allowMock: false)
            return true
        case .name(let name)?:
            let ok = await client.connect(cluster: name)
            session.rebuild()
            return ok
        case nil:
            fieldError = "Enter the cluster's name or a node address."
            return false
        }
    }

    private func signIn() async {
        focused = false
        await run { if await connectCloud() { await session.signIn() } }
    }

    private func signInDevelopment() async {
        guard let url = devURL else { return }
        await run {
            session.connect(nodeURL: url, allowMock: true)
            let name = devName.trimmingCharacters(in: .whitespacesAndNewlines)
            await client.signInOrSignUp(name: name.isEmpty ? "Developer" : name)
            session.rebuild()
        }
    }
}

private struct FieldLabel: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text).font(Theme.body(13, .medium)).foregroundStyle(Theme.muted)
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
