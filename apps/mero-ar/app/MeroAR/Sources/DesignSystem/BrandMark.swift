import SwiftUI

/// The Mero AR mark: a translucent cube in an aurora tile.
struct BrandMark: View {
    var size: CGFloat = 32

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.3, style: .continuous).fill(Theme.aurora)
            RoundedRectangle(cornerRadius: size * 0.3, style: .continuous)
                .strokeBorder(Color.white.opacity(0.35), lineWidth: 1)
            Image(systemName: "cube.transparent")
                .font(.system(size: size * 0.52, weight: .semibold))
                .foregroundStyle(.white)
        }
        .frame(width: size, height: size)
        .shadow(color: Theme.violet.opacity(0.45), radius: size * 0.3, y: size * 0.12)
        .accessibilityHidden(true)
    }
}

/// Mark plus wordmark.
struct BrandLockup: View {
    var size: CGFloat = 28

    var body: some View {
        HStack(spacing: 10) {
            BrandMark(size: size)
            Text("Mero AR")
                .font(.system(size: size * 0.66, weight: .heavy))
                .tracking(-0.4)
                .foregroundStyle(Theme.text)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Mero AR")
    }
}
