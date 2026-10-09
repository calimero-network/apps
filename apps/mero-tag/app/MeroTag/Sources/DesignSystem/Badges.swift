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
            Text(text).font(Cal.Typeface.badge).monospacedDigit()
        }
        .foregroundStyle(tone.foreground)
        .padding(.horizontal, 8)
        .frame(height: 22)
        .background(Capsule().fill(tone.background))
        .accessibilityElement(children: .combine)
    }
}

/// 26pt status pill with a dot; `live` gets the lime dot with an ink-green halo.
struct StatusPill: View {
    enum State { case live, waiting, off }

    let text: String
    var state: State = .live

    var body: some View {
        HStack(spacing: 6) {
            ZStack {
                if state == .live {
                    Circle().fill(Cal.accentInk.opacity(0.18)).frame(width: 12, height: 12)
                }
                Circle().fill(dotColor).frame(width: 8, height: 8)
            }
            .frame(width: 12, height: 12)
            Text(text).font(Cal.Typeface.badge).foregroundStyle(Cal.textDim)
        }
        .padding(.horizontal, 10)
        .frame(height: 26)
        .background(Capsule().fill(Cal.bgSubtle))
        .accessibilityElement(children: .combine)
    }

    private var dotColor: Color {
        switch state {
        case .live: return Cal.lime
        case .waiting: return Cal.warning
        case .off: return Cal.textFaint
        }
    }
}

/// Round initials avatar with a deterministic tone (forum avatar tones).
struct Avatar: View {
    let name: String
    var seed: String?
    var size: CGFloat = 28
    var isMe = false

    private static let tones: [(UInt32, UInt32)] = [
        (0xF0FFD6, 0x4A7300), (0xE6EEFB, 0x1D4F9F), (0xFBE9E4, 0x9A3412),
        (0xEFE8FB, 0x5B3AA8), (0xFDF3DC, 0x8A5300), (0xE2F4F1, 0x116A5C),
    ]

    var body: some View {
        let tone = isMe ? Self.tones[0] : Self.tones[Self.index(for: seed ?? name)]
        Text(Self.initials(name))
            .font(.system(size: size * 0.4, weight: .bold))
            .foregroundStyle(Color(hex: tone.1))
            .frame(width: size, height: size)
            .background(Circle().fill(Color(hex: tone.0)))
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

/// The Mero Tag mark: a lime rounded square with an ink location glyph.
struct BrandMark: View {
    var size: CGFloat = 28

    var body: some View {
        Image(systemName: "location.fill")
            .font(.system(size: size * 0.46, weight: .semibold))
            .foregroundStyle(Cal.onLime)
            .frame(width: size, height: size)
            .background(
                RoundedRectangle(cornerRadius: size * 0.28, style: .continuous).fill(Cal.lime))
            .overlay(
                RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                    .strokeBorder(Cal.limeEdge, lineWidth: 1))
            .accessibilityHidden(true)
    }
}

/// Brand mark + app name, for the leading slot of the top bar.
struct BrandTitle: View {
    var body: some View {
        HStack(spacing: 8) {
            BrandMark(size: 26)
            Text("Mero Tag").font(Cal.Typeface.brand).tracking(-0.2).foregroundStyle(Cal.ink)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Mero Tag")
    }
}
