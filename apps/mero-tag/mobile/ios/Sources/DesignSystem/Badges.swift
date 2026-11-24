import SwiftUI

/// 22pt pill, 12/500 (vote `.badge`). Optional 6pt dot.
struct Badge: View {
    let text: String
    var tone: Tone = .neutral
    var systemImage: String?
    var dot = false

    var body: some View {
        HStack(spacing: 5) {
            if dot {
                Circle().fill(tone.foreground).frame(width: 6, height: 6)
            }
            if let systemImage {
                Image(systemName: systemImage).font(.system(size: 10, weight: .semibold))
            }
            Text(text).font(Tag.Typeface.badge).monospacedDigit()
        }
        .foregroundStyle(tone.foreground)
        .padding(.horizontal, 8)
        .frame(height: 22)
        .background(Capsule().fill(tone.background))
        .accessibilityElement(children: .combine)
    }
}

/// A status pill with a dot; `live` gets a pulsing mint dot.
struct StatusPill: View {
    enum State { case live, waiting, off }

    let text: String
    var state: State = .live

    var body: some View {
        HStack(spacing: 6) {
            ZStack {
                if state == .live { PulseRing(color: Tag.live, size: 12) }
                Circle().fill(dotColor).frame(width: 8, height: 8)
            }
            .frame(width: 12, height: 12)
            Text(text).font(Tag.Typeface.badge).foregroundStyle(Tag.textDim)
        }
        .padding(.horizontal, 10)
        .frame(height: 26)
        .background(Capsule().fill(state == .live ? Tag.liveSoft : Tag.bgSubtle))
        .accessibilityElement(children: .combine)
    }

    private var dotColor: Color {
        switch state {
        case .live: return Tag.live
        case .waiting: return Tag.warning
        case .off: return Tag.textFaint
        }
    }
}

/// Round initials avatar with a deterministic tone (forum avatar tones).
struct Avatar: View {
    let name: String
    var seed: String?
    var size: CGFloat = 28
    var isMe = false

    /// Gradient pairs per person: start, end.
    private static let tones: [(UInt32, UInt32)] = [
        (0x5B4BFF, 0x9B5CFF), (0x0EA5E9, 0x22D3EE), (0xF43F5E, 0xFB923C),
        (0x10B981, 0x84CC16), (0xF59E0B, 0xEF4444), (0x8B5CF6, 0xEC4899),
    ]

    var body: some View {
        let tone = isMe ? Self.tones[0] : Self.tones[Self.index(for: seed ?? name)]
        Text(Self.initials(name))
            .font(.system(size: size * 0.38, weight: .bold, design: .rounded))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(
                Circle().fill(
                    LinearGradient(
                        colors: [Color(hex: tone.0), Color(hex: tone.1)], startPoint: .topLeading,
                        endPoint: .bottomTrailing)))
            .accessibilityHidden(true)
    }

    static func initials(_ name: String) -> String {
        let words = name.split(whereSeparator: { $0 == " " || $0 == "-" || $0 == "_" })
        let letters = words.prefix(2).compactMap(\.first)
        let result = letters.isEmpty ? String(name.prefix(1)) : String(letters)
        return result.uppercased()
    }

    /// Stable across launches (unlike `hashValue`).
    static func index(for seed: String) -> Int {
        var hash: UInt32 = 2_166_136_261
        for byte in seed.utf8 { hash = (hash ^ UInt32(byte)) &* 16_777_619 }
        return Int(hash % UInt32(tones.count))
    }
}

/// The Mero Tag mark: a gradient squircle with a white location glyph.
struct BrandMark: View {
    var size: CGFloat = 28

    var body: some View {
        Image(systemName: "location.north.fill")
            .font(.system(size: size * 0.44, weight: .bold))
            .rotationEffect(.degrees(45))
            .foregroundStyle(Tag.onAccent)
            .frame(width: size, height: size)
            .background(
                RoundedRectangle(cornerRadius: size * 0.3, style: .continuous).fill(Tag.accentGradient))
            .overlay(
                RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                    .strokeBorder(Tag.accentEdge, lineWidth: 1))
            .accessibilityHidden(true)
    }
}

/// Brand mark + app name, for the leading slot of the top bar.
struct BrandTitle: View {
    var body: some View {
        HStack(spacing: 8) {
            BrandMark(size: 26)
            Text("Mero Tag").font(Tag.Typeface.brand).tracking(-0.2).foregroundStyle(Tag.ink)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Mero Tag")
    }
}

/// A ring that expands and fades, forever — the "live" signal.
struct PulseRing: View {
    var color: Color = Tag.live
    var size: CGFloat = 12
    @State private var on = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Circle()
            .stroke(color.opacity(on ? 0 : 0.6), lineWidth: 2)
            .frame(width: size, height: size)
            .scaleEffect(on ? 2.2 : 0.8)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeOut(duration: 1.6).repeatForever(autoreverses: false)) { on = true }
            }
            .accessibilityHidden(true)
    }
}
