import SwiftUI

/// The Mero AR mark: an ink wireframe cube on a lime tile — the Calimero brand
/// square (lime, radius 8, hairline edge) carrying the "shared 3D space" motif.
struct BrandMark: View {
    var size: CGFloat = 28

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
            .fill(Theme.accent)
            .overlay(
                RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                    .stroke(Theme.limeEdge, lineWidth: 1)
            )
            .overlay(
                CubeShape(depth: size * 0.16)
                    .stroke(
                        Theme.ink,
                        style: StrokeStyle(lineWidth: max(1.5, size * 0.055), lineCap: .round, lineJoin: .round)
                    )
                    .frame(width: size * 0.54, height: size * 0.54)
            )
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// The app name next to its mark, as the top bar renders it.
struct BrandLockup: View {
    var body: some View {
        HStack(spacing: 10) {
            BrandMark(size: 28)
            Text("Mero AR")
                .font(.system(size: 17, weight: .bold))
                .tracking(-0.2)
                .foregroundStyle(Theme.ink)
        }
        .accessibilityElement(children: .combine)
    }
}

/// A 2-D isometric wireframe cube: front square, back square offset by `depth`,
/// and the four connecting edges.
private struct CubeShape: Shape {
    var depth: CGFloat

    func path(in rect: CGRect) -> Path {
        let front = CGRect(
            x: rect.minX + depth, y: rect.minY + depth,
            width: rect.width - depth, height: rect.height - depth)
        let back = front.offsetBy(dx: -depth, dy: -depth)

        var p = Path()
        p.addRect(back)
        p.addRect(front)
        let edges: [(CGPoint, CGPoint)] = [
            (CGPoint(x: front.minX, y: front.minY), CGPoint(x: back.minX, y: back.minY)),
            (CGPoint(x: front.maxX, y: front.minY), CGPoint(x: back.maxX, y: back.minY)),
            (CGPoint(x: front.minX, y: front.maxY), CGPoint(x: back.minX, y: back.maxY)),
            (CGPoint(x: front.maxX, y: front.maxY), CGPoint(x: back.maxX, y: back.maxY)),
        ]
        for (a, b) in edges {
            p.move(to: a)
            p.addLine(to: b)
        }
        return p
    }
}
