import SwiftUI

/// The glass login card used inside WelcomeView (Mero AR).
///
/// Credentials go to the SDK's `/auth/token` login.
///
/// There is no setup-code field. core#3276/#3277 (0.11.0-rc.17) deleted the
/// first-login bootstrap secret — the admin account is created at `merod init`
/// — so a field for it asks the user for a value merod no longer prints, which
/// is worse than not asking.
struct LoginCard: View {
    @EnvironmentObject private var app: AppState

    @State private var nodeUrl = ""
    @State private var username = ""
    @State private var password = ""
    @State private var contextId = ""
    @State private var shake = false

    var body: some View {
        GlassCard {
            VStack(spacing: 14) {
                MeroField(icon: "network", placeholder: "Node URL", text: $nodeUrl, keyboard: .url)
                MeroField(icon: "person.fill", placeholder: "Username", text: $username)
                MeroField(icon: "lock.fill", placeholder: "Password", text: $password, secure: true)

                // One field for both: a room id typed by hand, or an invite
                // someone sent. Which one it is decides itself — an invitation
                // decodes, a room id does not — so there is no mode to pick and
                // nothing to get wrong. The icon follows suit as confirmation
                // that the paste was understood.
                MeroField(
                    icon: RoomInvite.looksLikeInvite(contextId) ? "envelope.open" : "cube",
                    placeholder: "Paste an invite, or a Room ID",
                    text: $contextId
                )

                if RoomInvite.looksLikeInvite(contextId) {
                    Text("Invite recognised — you'll join the room on entry.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

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
                                        password: password, contextId: contextId)
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
