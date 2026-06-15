import SwiftUI

/// Animated Mero AR logo: a slowly rotating wireframe cube with a glowing core —
/// the "shared 3D space" motif. Built from two offset squares joined by edges to
/// fake isometric depth, gently rotating and breathing.
struct BrandMark: View {
    var size: CGFloat = 120
    @State private var spin = false
    @State private var breathe = false

    var body: some View {
        ZStack {
            // Soft glow behind the cube.
            Circle()
                .fill(Theme.glowA)
                .frame(width: size * 1.8, height: size * 1.8)
                .blur(radius: 24)
                .opacity(breathe ? 0.9 : 0.5)

            CubeShape(depth: size * 0.32)
                .stroke(Theme.brand, style: StrokeStyle(lineWidth: 3, lineJoin: .round))
                .frame(width: size, height: size)
                .rotation3DEffect(.degrees(spin ? 360 : 0), axis: (x: 0.25, y: 1, z: 0.1))
                .shadow(color: Theme.accent.opacity(0.6), radius: 16)

            // Glowing core.
            Circle()
                .fill(Theme.brand)
                .frame(width: size * 0.2, height: size * 0.2)
                .scaleEffect(breathe ? 1.25 : 0.85)
                .blur(radius: 1)
        }
        .frame(width: size * 2, height: size * 2)
        .onAppear {
            withAnimation(.linear(duration: 14).repeatForever(autoreverses: false)) { spin = true }
            withAnimation(.easeInOut(duration: 1.8).repeatForever(autoreverses: true)) { breathe = true }
        }
    }
}

/// A 2-D isometric wireframe cube: front square, back square offset by `depth`,
/// and the four connecting edges.
private struct CubeShape: Shape {
    var depth: CGFloat

    func path(in rect: CGRect) -> Path {
        let d = depth
        let frontInset = d / 2
        // Front face (slightly down-right), back face (up-left).
        let f = CGRect(x: rect.minX + frontInset, y: rect.minY + frontInset,
                       width: rect.width - d, height: rect.height - d)
        let off = CGSize(width: -frontInset, height: -frontInset)
        let b = f.offsetBy(dx: off.width, dy: off.height)

        var p = Path()
        // Back square.
        p.addRect(b)
        // Front square.
        p.addRect(f)
        // Connecting edges.
        let corners: [(CGPoint, CGPoint)] = [
            (CGPoint(x: f.minX, y: f.minY), CGPoint(x: b.minX, y: b.minY)),
            (CGPoint(x: f.maxX, y: f.minY), CGPoint(x: b.maxX, y: b.minY)),
            (CGPoint(x: f.minX, y: f.maxY), CGPoint(x: b.minX, y: b.maxY)),
            (CGPoint(x: f.maxX, y: f.maxY), CGPoint(x: b.maxX, y: b.maxY)),
        ]
        for (a, c) in corners { p.move(to: a); p.addLine(to: c) }
        return p
    }
}
