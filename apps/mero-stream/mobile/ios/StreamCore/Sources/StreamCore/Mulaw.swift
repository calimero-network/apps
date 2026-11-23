import Foundation

/// G.711 µ-law, the audio a phone sends on track 1 (codec string `ulaw`, the
/// WebCodecs registry name; 8 kHz mono, one byte per sample). Bit-exact with
/// CPython's `audioop.lin2ulaw` / `ulaw2lin` (CCITT reference): the tests hold
/// vectors taken from it.
///
/// Why this codec: the web app sends no audio at all, so there is nothing to
/// match on that side; this is the simplest thing both phones decode
/// identically, with no platform codec in the loop. 8 KB/s, 1.6 KB per 200 ms.
public enum Mulaw {
    public static let sampleRate = 8_000
    /// Samples per packet: 200 ms.
    public static let packetSamples = 1_600
    public static let codec = "ulaw"

    private static let segmentEnds: [Int32] = [0x3F, 0x7F, 0xFF, 0x1FF, 0x3FF, 0x7FF, 0xFFF, 0x1FFF]

    public static func encode(_ sample: Int16) -> UInt8 {
        // audioop works on the top 14 bits.
        var pcm = Int32(sample) >> 2
        let mask: Int32
        if pcm < 0 {
            pcm = -pcm
            mask = 0x7F
        } else {
            mask = 0xFF
        }
        if pcm > 8159 { pcm = 8159 }
        pcm += 0x84 >> 2
        guard let segment = segmentEnds.firstIndex(where: { pcm <= $0 }) else {
            return UInt8(0x7F ^ mask)
        }
        let value = (Int32(segment) << 4) | ((pcm >> (Int32(segment) + 1)) & 0xF)
        return UInt8(truncatingIfNeeded: value ^ mask)
    }

    public static func decode(_ byte: UInt8) -> Int16 {
        let u = Int32(~byte)
        var t = ((u & 0x0F) << 3) + 0x84
        t <<= (u & 0x70) >> 4
        return Int16((u & 0x80) != 0 ? 0x84 - t : t - 0x84)
    }

    public static func encode(_ samples: [Int16]) -> [UInt8] { samples.map(encode) }
    public static func decode(_ bytes: [UInt8]) -> [Int16] { bytes.map(decode) }
}
