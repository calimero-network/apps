import Foundation

/// H.264 byte-stream helpers. The web encodes with WebCodecs
/// `avc: { format: "annexb" }`, so every access unit on the wire is Annex-B
/// (start codes) and every keyframe carries its SPS and PPS inline; a decoder
/// needs nothing but the frames. VideoToolbox speaks AVCC (length prefixes),
/// so the iOS encoder and decoder convert here.
public enum AnnexB {
    public static let startCode: [UInt8] = [0, 0, 0, 1]

    public enum NALType: UInt8 {
        case slice = 1
        case idr = 5
        case sei = 6
        case sps = 7
        case pps = 8
        case aud = 9
    }

    public static func type(of nal: [UInt8]) -> UInt8 { nal.first.map { $0 & 0x1F } ?? 0 }

    /// The NAL units of an Annex-B stream, without their start codes.
    public static func units(_ stream: [UInt8]) -> [[UInt8]] {
        var starts: [(at: Int, length: Int)] = []
        var i = 0
        while i + 2 < stream.count {
            if stream[i] == 0, stream[i + 1] == 0 {
                if stream[i + 2] == 1 {
                    starts.append((i, 3))
                    i += 3
                    continue
                }
                if i + 3 < stream.count, stream[i + 2] == 0, stream[i + 3] == 1 {
                    starts.append((i, 4))
                    i += 4
                    continue
                }
            }
            i += 1
        }
        var out: [[UInt8]] = []
        for (index, start) in starts.enumerated() {
            let begin = start.at + start.length
            let end = index + 1 < starts.count ? starts[index + 1].at : stream.count
            if begin < end { out.append(Array(stream[begin..<end])) }
        }
        return out
    }

    /// Annex-B from NAL units.
    public static func stream(_ units: [[UInt8]]) -> [UInt8] {
        var out: [UInt8] = []
        for unit in units {
            out += startCode
            out += unit
        }
        return out
    }

    /// NAL units from an AVCC buffer (big-endian length prefixes).
    public static func unitsFromAVCC(_ data: [UInt8], lengthSize: Int = 4) -> [[UInt8]] {
        var out: [[UInt8]] = []
        var i = 0
        while i + lengthSize <= data.count {
            var length = 0
            for k in 0..<lengthSize { length = (length << 8) | Int(data[i + k]) }
            i += lengthSize
            guard length > 0, i + length <= data.count else { break }
            out.append(Array(data[i..<(i + length)]))
            i += length
        }
        return out
    }

    /// An AVCC buffer (4-byte big-endian length prefixes) from NAL units.
    public static func avcc(_ units: [[UInt8]]) -> [UInt8] {
        var out: [UInt8] = []
        for unit in units {
            let n = UInt32(unit.count)
            out += [UInt8(n >> 24 & 0xFF), UInt8(n >> 16 & 0xFF), UInt8(n >> 8 & 0xFF), UInt8(n & 0xFF)]
            out += unit
        }
        return out
    }

    /// Whether the access unit holds an IDR slice.
    public static func isKeyframe(_ stream: [UInt8]) -> Bool {
        units(stream).contains { type(of: $0) == NALType.idr.rawValue }
    }

    /// The SPS and PPS an access unit carries, if it carries both.
    public static func parameterSets(_ stream: [UInt8]) -> (sps: [UInt8], pps: [UInt8])? {
        let all = units(stream)
        guard let sps = all.first(where: { type(of: $0) == NALType.sps.rawValue }),
            let pps = all.first(where: { type(of: $0) == NALType.pps.rawValue })
        else { return nil }
        return (sps, pps)
    }

    /// The WebCodecs codec string an SPS describes: `avc1.PPCCLL` (profile,
    /// constraint flags, level), e.g. `avc1.42001f` for Baseline 3.1. The web
    /// sends `avc1.42001f`; a phone sends what its encoder actually produced,
    /// and the browser's decoder is configured from that string.
    public static func codecString(sps: [UInt8]) -> String? {
        guard sps.count >= 4, type(of: sps) == NALType.sps.rawValue else { return nil }
        return String(format: "avc1.%02x%02x%02x", sps[1], sps[2], sps[3])
    }
}
