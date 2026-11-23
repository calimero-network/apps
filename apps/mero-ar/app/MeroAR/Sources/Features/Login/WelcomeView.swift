import MeroKitUI
import SwiftUI

/// Sign-in. Calimero Cloud first, on Mero AR's own sign-in page; under it,
/// "Development cluster" swaps in a node URL for a local `merod local` cluster
/// (mock attestation, a soft passkey).
struct WelcomeView: View {
    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var client: MeroClient

    @State private var manual = false
    @State private var nodeURL = ""
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
                            if let error = app.signInError {
                                Callout(tone: .danger, title: "Couldn't sign in", message: error)
                                    .accessibilityIdentifier("loginError")
                                    .transition(.opacity)
                            }
                            if manual {
                                devForm.transition(.move(edge: .bottom).combined(with: .opacity))
                            } else {
                                cloudForm.transition(.opacity)
                            }
                            Button {
                                Haptics.tap()
                                withAnimation(.spring(response: 0.45, dampingFraction: 0.85)) {
                                    manual.toggle()
                                    app.signInError = nil
                                }
                            } label: {
                                Text(manual ? "Use Calimero Cloud instead" : "Development cluster (merod local)")
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
            if nodeURL.isEmpty { nodeURL = app.devNodeURL }
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
                        ? "Connect to a local development cluster. Its attestation is a mock, so use it only for development."
                        : "Scan a room. Build in it together, in shared 3D space, on your own Calimero cluster."
                )
                .font(.system(size: 17))
                .foregroundStyle(Theme.textDim)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            }
            .opacity(appeared ? 1 : 0)
        }
    }

    /// Calimero Cloud: Mero AR's own sign-in page in the system sheet, where
    /// the person signs in or creates an account with their passkey.
    private var cloudForm: some View {
        VStack(spacing: 12) {
            Button(action: signIn) {
                ButtonLabel(title: "Sign in with Calimero", icon: "person.badge.key.fill", isLoading: client.isLoading)
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(client.isLoading)
            .accessibilityIdentifier("cloudSignInButton")
            Label("Sign in with your passkey, or create a new one", systemImage: "info.circle")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textFaint)
        }
    }

    private func signIn() {
        guard !client.isLoading else { return }
        Haptics.tap()
        Task { await app.signInWithCalimero() }
    }

    private var devForm: some View {
        GlassCard {
            VStack(spacing: 14) {
                TextInput(
                    placeholder: "http://localhost:2501", text: $nodeURL, icon: "server.rack",
                    identifier: "nodeURLField", keyboard: .url
                )
                .submitLabel(.go)
                .onSubmit(connect)
                Button(action: connect) {
                    ButtonLabel(title: "Connect", icon: "bolt.horizontal.fill", isLoading: client.isLoading)
                }
                .buttonStyle(PrimaryButtonStyle(height: 52))
                .disabled(!canConnect)
                .accessibilityIdentifier("nodeConnectButton")
                Label(
                    "Run `merod local` (in Docker on a Mac). On a phone, use your Mac's LAN address.",
                    systemImage: "exclamationmark.shield")
                    .font(.system(size: 12.5))
                    .foregroundStyle(Theme.textFaint)
                    .multilineTextAlignment(.center)
            }
        }
    }

    private var canConnect: Bool {
        !client.isLoading && !nodeURL.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private func connect() {
        guard canConnect else { return }
        Haptics.tap()
        Task { await app.signInToDevelopmentCluster(nodeURL: nodeURL) }
    }

    private var footer: some View {
        HStack(spacing: 6) {
            Image(systemName: "lock.fill").font(.system(size: 11))
            Text("Every node is attested before the app talks to it. Rooms stay on your cluster.")
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
