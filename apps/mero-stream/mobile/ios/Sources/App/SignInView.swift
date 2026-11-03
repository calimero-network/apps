import MeroKitUI
import SwiftUI

/// Signed out: what the app is, and a passkey on the cluster. The cluster is a
/// Calimero Cloud cluster (by name or a node's URL) or a development node
/// (`merod local`, mock attestation).
struct SignInView: View {
    @EnvironmentObject private var session: MeroAppSession
    @ObservedObject var client: MeroClient
    @State private var signingIn = false
    @State private var creating = false
    @State private var choosingNode = false

    private let points: [(String, String)] = [
        ("person.2.wave.2", "Create a stream, invite people, and meet in its rooms."),
        ("antenna.radiowaves.left.and.right", "Video rides the room's presence, so nothing about a call is stored."),
        ("laptopcomputer.and.iphone", "A phone and a browser can be in the same room."),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                Spacer(minLength: 40)
                Image(systemName: "video.fill")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(Palette.ink)
                    .frame(width: 64, height: 64)
                    .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Palette.lime))
                VStack(alignment: .leading, spacing: 10) {
                    Text("Mero Stream").font(Typeface.display(34)).foregroundStyle(Palette.ink)
                    Text("Video rooms on your attested Calimero cluster. Up to two people share their camera at once; everyone else watches.")
                        .font(.body).foregroundStyle(Palette.inkSoft)
                }
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(points, id: \.1) { point in
                        Label {
                            Text(point.1).font(.subheadline).foregroundStyle(Palette.ink)
                        } icon: {
                            Image(systemName: point.0).foregroundStyle(Palette.ink)
                        }
                    }
                }
                if session.pendingInvitation != nil {
                    Card {
                        Label("You're invited to a stream. Sign in to join it.", systemImage: "envelope.open")
                            .font(.subheadline.weight(.medium)).foregroundStyle(Palette.ink)
                            .padding(14)
                    }
                }
                VStack(spacing: 12) {
                    if client.nodeURL == nil {
                        Button { choosingNode = true } label: { Label("Choose your cluster", systemImage: "server.rack") }
                            .buttonStyle(PrimaryButtonStyle())
                            .accessibilityIdentifier("chooseNodeButton")
                    } else {
                        Button {
                            Haptics.tap()
                            run { await signIn() }
                        } label: {
                            if busy {
                                HStack(spacing: 8) {
                                    ProgressView().tint(Palette.ink)
                                    Text("Waiting for your passkey…")
                                }
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
                    if let message = client.errorMessage, !busy {
                        Text(message).font(.footnote).foregroundStyle(Palette.danger)
                            .accessibilityIdentifier("signInError")
                    }
                    HStack(spacing: 6) {
                        Text(nodeLine).font(.footnote).foregroundStyle(Palette.muted).lineLimit(2)
                        Spacer(minLength: 0)
                        if client.nodeURL != nil {
                            Button("Change") { choosingNode = true }
                                .font(.footnote.weight(.semibold))
                                .accessibilityIdentifier("changeNodeButton")
                        }
                    }
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
        .screenBackground()
        .sheet(isPresented: $creating) {
            NameSheet(
                title: "Create an account", action: "Create", placeholder: "Your name", symbol: "person",
                hint: "Your name is what people in a call see. A new passkey on this phone signs you in from now on.",
                busy: false
            ) { name in
                creating = false
                run { await session.signUp(name: name) }
            }
        }
        .sheet(isPresented: $choosingNode) {
            NodeSheet(current: client.nodeURL ?? "", allowMock: client.allowMock) { choice in
                if let failure = await use(choice) { return failure }
                choosingNode = false
                return nil
            }
            .presentationDetents([.medium, .large])
        }
    }

    private var busy: Bool { signingIn || session.isRestoring }

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

    private var nodeLine: String {
        guard let url = client.nodeURL else { return "Choose the cluster your streams run on to sign in." }
        let host = URL(string: url)?.host ?? url
        return client.allowMock ? "Development node at \(host)." : "Calimero Cloud, node \(host)."
    }

    private func run(_ work: @escaping () async -> Void) {
        signingIn = true
        Task {
            await work()
            signingIn = false
        }
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
    @Environment(\.dismiss) private var dismiss
    let submit: (ClusterChoice) async -> String?
    @State private var development: Bool
    @State private var cloud: String
    @State private var local: String
    @State private var busy = false
    @State private var error: String?

    init(current: String, allowMock: Bool, submit: @escaping (ClusterChoice) async -> String?) {
        self.submit = submit
        _development = State(initialValue: allowMock)
        _cloud = State(initialValue: allowMock ? "" : current)
        _local = State(initialValue: allowMock && !current.isEmpty ? current : "http://127.0.0.1:2501")
    }

    private var value: String { (development ? local : cloud).trimmingCharacters(in: .whitespacesAndNewlines) }
    private var canUse: Bool { development ? ClusterChoice.isURL(value) : !value.isEmpty }

    var body: some View {
        VStack(spacing: 0) {
            SheetBar(
                title: "Your cluster", action: "Use", canAct: canUse, busy: busy,
                cancel: { dismiss() },
                act: {
                    busy = true
                    error = nil
                    Task {
                        error = await submit(development ? .development(value) : .cloud(value))
                        busy = false
                    }
                })
            VStack(alignment: .leading, spacing: 14) {
                Picker("Where", selection: $development) {
                    Text("Calimero Cloud").tag(false)
                    Text("Development node").tag(true)
                }
                .pickerStyle(.segmented)
                if development {
                    Text("A node you run with `merod local`. Its attestation is a mock, so use this only for development.")
                        .font(.system(size: 15)).foregroundStyle(Palette.muted)
                    field("http://127.0.0.1:2501", text: $local)
                } else {
                    Text("Your cluster's name from Calimero Cloud, or the address of one of its nodes. The app checks each node's attestation before it sends anything.")
                        .font(.system(size: 15)).foregroundStyle(Palette.muted)
                    field("eu-shared-1", text: $cloud)
                }
                if let error {
                    Text(error).font(.footnote).foregroundStyle(Palette.danger)
                }
                Spacer()
            }
            .padding(16)
        }
        .background(Palette.surface)
    }

    private func field(_ placeholder: String, text: Binding<String>) -> some View {
        TextField(placeholder, text: text)
            .font(.system(size: 15, design: .monospaced))
            .keyboardType(.URL)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .padding(.horizontal, 14)
            .frame(minHeight: 50)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.sunken))
            .accessibilityIdentifier("clusterField")
    }
}
