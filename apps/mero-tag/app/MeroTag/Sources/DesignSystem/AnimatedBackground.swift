import SwiftUI

/// Full-screen animated backdrop: a deep navy base with two slow-drifting glow
/// blobs and a faint moving gradient sheen. Continuous, GPU-cheap, looping.
struct AnimatedBackground: View {
    @State private var drift = false

    var body: some View {
        ZStack {
            LinearGradient(colors: [Theme.bg0, Theme.bg1],
                           startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()

            // Drifting glow blobs.
            Circle()
                .fill(Theme.glowA)
                .frame(width: 420, height: 420)
                .offset(x: drift ? -120 : -160, y: drift ? -220 : -280)
                .blur(radius: 30)

            Circle()
                .fill(Theme.glowB)
                .frame(width: 460, height: 460)
                .offset(x: drift ? 150 : 120, y: drift ? 280 : 340)
                .blur(radius: 40)

            // Subtle animated sheen.
            LinearGradient(colors: [.white.opacity(0.04), .clear],
                           startPoint: drift ? .topLeading : .bottomTrailing,
                           endPoint: drift ? .bottomTrailing : .topLeading)
                .ignoresSafeArea()
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 9).repeatForever(autoreverses: true)) {
                drift = true
            }
        }
    }
}
