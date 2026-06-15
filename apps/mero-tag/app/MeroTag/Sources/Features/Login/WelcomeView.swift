import SwiftUI

/// Animated start screen. Brand mark + tagline animate in on launch; "Get
/// Started" springs the login card up into place.
struct WelcomeView: View {
    @State private var appeared = false
    @State private var showLogin = false

    var body: some View {
        ZStack {
            AnimatedBackground()

            VStack(spacing: 0) {
                Spacer(minLength: 40)

                BrandMark(size: showLogin ? 70 : 120)
                    .scaleEffect(appeared ? 1 : 0.6)
                    .opacity(appeared ? 1 : 0)
                    .animation(.spring(response: 0.8, dampingFraction: 0.6), value: appeared)
                    .animation(.spring(response: 0.6, dampingFraction: 0.7), value: showLogin)

                VStack(spacing: 10) {
                    Text("Mero Tag")
                        .font(.system(size: 40, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                        .opacity(appeared ? 1 : 0)
                        .offset(y: appeared ? 0 : 16)
                        .animation(.spring(response: 0.7, dampingFraction: 0.7).delay(0.15), value: appeared)

                    Text("Live location, shared on your own\ndistributed network.")
                        .font(.callout)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.white.opacity(0.7))
                        .opacity(appeared ? 1 : 0)
                        .offset(y: appeared ? 0 : 16)
                        .animation(.spring(response: 0.7, dampingFraction: 0.7).delay(0.3), value: appeared)
                }
                .padding(.top, 8)

                Spacer()

                Group {
                    if showLogin {
                        LoginCard()
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    } else {
                        startCTA
                            .transition(.opacity)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 28)
            }
        }
        .onAppear { appeared = true }
    }

    private var startCTA: some View {
        VStack(spacing: 14) {
            PrimaryButton(title: "Get Started", icon: "arrow.right") {
                withAnimation(.spring(response: 0.6, dampingFraction: 0.8)) { showLogin = true }
            }
            Text("No accounts. Your node, your data.")
                .font(.caption)
                .foregroundStyle(.white.opacity(0.5))
        }
        .opacity(appeared ? 1 : 0)
        .offset(y: appeared ? 0 : 24)
        .animation(.spring(response: 0.7, dampingFraction: 0.7).delay(0.45), value: appeared)
    }
}
