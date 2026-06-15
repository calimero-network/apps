import SwiftUI

/// Animated Mero Tag logo: a glowing location pin with concentric radar pulses
/// rippling outward — the "you are here, live" motif.
struct BrandMark: View {
    var size: CGFloat = 120
    @State private var animate = false

    var body: some View {
        ZStack {
            // Radar pulses.
            ForEach(0..<3, id: \.self) { i in
                Circle()
                    .stroke(Theme.accent.opacity(0.6), lineWidth: 2)
                    .frame(width: size, height: size)
                    .scaleEffect(animate ? 2.1 : 0.5)
                    .opacity(animate ? 0 : 0.7)
                    .animation(
                        .easeOut(duration: 2.6)
                            .repeatForever(autoreverses: false)
                            .delay(Double(i) * 0.85),
                        value: animate)
            }

            // Pin disc.
            Circle()
                .fill(Theme.brand)
                .frame(width: size * 0.62, height: size * 0.62)
                .shadow(color: Theme.accent.opacity(0.6), radius: 20)

            Image(systemName: "location.fill")
                .font(.system(size: size * 0.28, weight: .bold))
                .foregroundStyle(.white)
                .scaleEffect(animate ? 1.0 : 0.9)
                .animation(.spring(response: 0.6, dampingFraction: 0.5).repeatForever(autoreverses: true),
                           value: animate)
        }
        .frame(width: size * 2.1, height: size * 2.1)
        .onAppear { animate = true }
    }
}
