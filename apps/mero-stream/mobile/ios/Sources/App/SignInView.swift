import MeroKitUI
import SwiftUI

/// Signed out: what the app is, and a passkey on the cluster. A developer can
/// point the app at another node (a `merod local` cluster with mock attestation).
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
            NodeSheet(current: client.nodeURL ?? "", allowMock: client.allowMock) { url, allowMock in
                choosingNode = false
                session.connect(nodeURL: url, allowMock: allowMock)
            }
            .presentationDetents([.medium, .large])
        }
    }

    private var busy: Bool { signingIn || session.isRestoring }

    private var nodeLine: String {
        guard let url = client.nodeURL else { return "Choose the cluster your streams run on to sign in." }
        let host = URL(string: url)?.host ?? url
        return client.allowMock ? "Development cluster at \(host)." : "Signing in to \(host)."
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
                Text("Paste the address of a node in your cluster. The app checks the node's attestation before it sends anything.")
                    .font(.system(size: 15)).foregroundStyle(Palette.muted)
                TextField("https://node.example.calimero.network", text: $url)
                    .font(.system(size: 15, design: .monospaced))
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(.horizontal, 14)
                    .frame(minHeight: 50)
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
