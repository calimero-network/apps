import SwiftUI

/// The glass login card used inside WelcomeView (Mero AR).
///
/// Credentials go to the SDK's `/auth/token` login; the optional setup code is
/// the node's bootstrap secret, which core rc.14+ requires on the very first
/// login of a fresh node and ignores afterwards.
struct LoginCard: View {
    @EnvironmentObject private var app: AppState

    @State private var nodeUrl = ""
    @State private var username = ""
    @State private var password = ""
    @State private var setupCode = ""
    @State private var contextId = ""
    @State private var showSetupCode = false
    @State private var shake = false

    var body: some View {
        GlassCard {
            VStack(spacing: 14) {
                MeroField(icon: "network", placeholder: "Node URL", text: $nodeUrl, keyboard: .url)
                MeroField(icon: "person.fill", placeholder: "Username", text: $username)
                MeroField(icon: "lock.fill", placeholder: "Password", text: $password, secure: true)

                if showSetupCode {
                    MeroField(icon: "key.fill", placeholder: "Setup code (first login only)",
                              text: $setupCode, secure: true)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                } else {
                    Button("Node needs a setup code?") {
                        withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) { showSetupCode = true }
                    }
                    .font(.caption)
                    .foregroundStyle(Theme.accent3)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                MeroField(icon: "cube", placeholder: "Room (Context ID)", text: $contextId)

                if let error = app.loginError {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .transition(.opacity)
                }

                PrimaryButton(title: "Enter Room", icon: "arrow.right",
                              isLoading: app.isLoggingIn,
                              disabled: contextId.isEmpty) {
                    Task {
                        await app.login(nodeUrl: nodeUrl, username: username,
                                        password: password, setupCode: setupCode,
                                        contextId: contextId)
                    }
                }
                .padding(.top, 2)
            }
        }
        .onAppear {
            // Prefill from the last session so re-entering a room is one tap.
            if nodeUrl.isEmpty { nodeUrl = app.lastNodeURL }
            if contextId.isEmpty { contextId = app.lastRoomId }
            if username.isEmpty { username = app.username.isEmpty ? "admin" : app.username }
        }
        .offset(x: shake ? -8 : 0)
        .animation(.default, value: app.loginError)
        .onChange(of: app.loginError) { _, newValue in
            guard newValue != nil else { return }
            withAnimation(.spring(response: 0.2, dampingFraction: 0.25)) { shake = true }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { shake = false }
        }
    }
}
