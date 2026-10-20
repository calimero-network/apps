import MeroKitUI
import SwiftUI

/// Sign-in. Calimero Cloud first; under it, "Manually enter node URL" swaps in
/// a node URL, username and password for a node you run yourself.
struct WelcomeView: View {
    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var client: MeroClient

    @State private var manual = false
    @State private var nodeURL = ""
    @State private var username = ""
    @State private var password = ""
    @State private var appeared = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            SpatialBackground()
            FloatingCubes().opacity(manual ? 0.35 : 1)
            GeometryReader { geo in
                ScrollView {
                    VStack(spacing: 28) {
                        Spacer(minLength: manual ? 24 : max(48, geo.size.height * 0.16))
                        hero
                        VStack(spacing: 14) {
                            if let error = manual ? app.nodeError : client.errorMessage {
                                Callout(tone: .danger, title: "Couldn't sign in", message: error)
                                    .accessibilityIdentifier("loginError")
                                    .transition(.opacity)
                            }
                            if manual {
                                nodeForm.transition(.move(edge: .bottom).combined(with: .opacity))
                            } else {
                                cloudButton.transition(.opacity)
                            }
                            Button {
                                Haptics.tap()
                                withAnimation(.spring(response: 0.45, dampingFraction: 0.85)) {
                                    manual.toggle()
                                    app.nodeError = nil
                                }
                            } label: {
                                Text(manual ? "Use Calimero Cloud instead" : "Manually enter node URL")
                                    .underline(!manual, color: Theme.textFaint)
                            }
                            .buttonStyle(LinkButtonStyle())
                            .accessibilityIdentifier(manual ? "useCloud" : "manualNode")
                        }
                        .opacity(appeared ? 1 : 0)
                        .offset(y: appeared ? 0 : 24)
                        Spacer(minLength: 24)
                        footer
                    }
                    .padding(.horizontal, 24)
                    .frame(maxWidth: 480, minHeight: geo.size.height)
                    .frame(maxWidth: .infinity)
                }
                .scrollDismissesKeyboard(.interactively)
            }
            // Keep the layout still while the keyboard comes and goes, so a
            // button doesn't move out from under a finger mid-tap.
            .ignoresSafeArea(.keyboard)
        }
        .preferredColorScheme(.dark)
        .onAppear {
            if nodeURL.isEmpty { nodeURL = app.lastNodeURL }
            if username.isEmpty { username = app.lastNodeUser }
            withAnimation(reduceMotion ? nil : .spring(response: 0.8, dampingFraction: 0.85).delay(0.15)) {
                appeared = true
            }
        }
    }

    private var hero: some View {
        VStack(spacing: 20) {
            BrandMark(size: manual ? 64 : 88)
                .scaleEffect(appeared ? 1 : 0.7)
                .opacity(appeared ? 1 : 0)
            VStack(spacing: 10) {
                Text("Mero AR")
                    .font(Theme.display(manual ? 34 : 46))
                    .tracking(-1.2)
                    .foregroundStyle(Theme.text)
                    .accessibilityIdentifier("loginTitle")
                Text(
                    manual
                        ? "Connect to a node you run, like a local merod, with its admin username and password."
                        : "Scan a room. Build in it together, in shared 3D space. Peer to peer, on your own nodes."
                )
                .font(.system(size: 17))
                .foregroundStyle(Theme.textDim)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            }
            .opacity(appeared ? 1 : 0)
        }
    }

    private var cloudButton: some View {
        VStack(spacing: 12) {
            Button {
                Haptics.tap()
                Task { await app.signIn() }
            } label: {
                ButtonLabel(title: "Continue with Calimero Cloud", icon: "cloud.fill", isLoading: client.isLoading)
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(client.isLoading)
            .accessibilityIdentifier("cloudSignInButton")
            Label("Approve this device with your passkey", systemImage: "person.badge.key.fill")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textFaint)
        }
    }

    private var nodeForm: some View {
        GlassCard {
            VStack(spacing: 14) {
                TextInput(
                    placeholder: "http://localhost:2450", text: $nodeURL, icon: "server.rack",
                    identifier: "nodeURLField", keyboard: .url
                )
                TextInput(placeholder: "Username", text: $username, icon: "person.fill", identifier: "nodeUserField")
                TextInput(
                    placeholder: "Password", text: $password, icon: "key.fill", secure: true,
                    identifier: "nodePassField"
                )
                .submitLabel(.go)
                .onSubmit(connect)
                Button(action: connect) {
                    ButtonLabel(title: "Connect to node", icon: "bolt.horizontal.fill", isLoading: app.isConnectingNode)
                }
                .buttonStyle(PrimaryButtonStyle(height: 52))
                .disabled(!canConnect)
                .accessibilityIdentifier("nodeConnectButton")
                Text("In the Simulator, localhost is your Mac. On a phone, use your Mac's LAN address.")
                    .font(.system(size: 12.5))
                    .foregroundStyle(Theme.textFaint)
                    .multilineTextAlignment(.center)
            }
        }
    }

    private var canConnect: Bool {
        !app.isConnectingNode && !nodeURL.trimmingCharacters(in: .whitespaces).isEmpty && !username.isEmpty
            && !password.isEmpty
    }

    private func connect() {
        guard canConnect else { return }
        Haptics.tap()
        Task { await app.connectNode(nodeURL, username: username, password: password) }
    }

    private var footer: some View {
        HStack(spacing: 6) {
            Image(systemName: "lock.fill").font(.system(size: 11))
            Text("No central server. Rooms live on the nodes of the people in them.")
        }
        .font(.system(size: 12))
        .foregroundStyle(Theme.textFaint)
        .multilineTextAlignment(.center)
        .padding(.bottom, 12)
    }
}

/// Translucent cubes drifting behind the sign-in hero.
private struct FloatingCubes: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var float = false

    private let cubes: [(x: CGFloat, y: CGFloat, size: CGFloat, angle: Double)] = [
        (0.14, 0.16, 54, -18), (0.86, 0.12, 40, 24), (0.86, 0.64, 58, 12),
        (0.10, 0.52, 36, 32), (0.24, 0.80, 48, -8), (0.88, 0.78, 34, -26),
    ]

    var body: some View {
        GeometryReader { geo in
            ForEach(Array(cubes.enumerated()), id: \.offset) { index, cube in
                Image(systemName: "cube.transparent")
                    .font(.system(size: cube.size, weight: .ultraLight))
                    .foregroundStyle(Theme.aurora)
                    .opacity(0.55)
                    .rotationEffect(.degrees(cube.angle + (float ? 8 : -8)))
                    .position(
                        x: geo.size.width * cube.x,
                        y: geo.size.height * cube.y + (float ? -10 : 10) * (index.isMultiple(of: 2) ? 1 : -1))
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 5).repeatForever(autoreverses: true)) { float = true }
        }
    }
}
