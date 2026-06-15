import SwiftUI

/// The glass login card used inside WelcomeView (Mero AR).
struct LoginCard: View {
    @EnvironmentObject private var app: AppState

    @State private var nodeUrl = "http://localhost:2450"
    @State private var username = "admin"
    @State private var password = "calimero1234"
    @State private var contextId = ""
    @State private var shake = false

    var body: some View {
        GlassCard {
            VStack(spacing: 14) {
                MeroField(icon: "network", placeholder: "Node URL", text: $nodeUrl, keyboard: .url)
                MeroField(icon: "person.fill", placeholder: "Username", text: $username)
                MeroField(icon: "lock.fill", placeholder: "Password", text: $password, secure: true)
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
                    Task { await app.login(nodeUrl: nodeUrl, username: username,
                                           password: password, contextId: contextId) }
                }
                .padding(.top, 2)
            }
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
