import Foundation

/// The web app's media framing on ephemeral presence, byte for byte: a port of
/// `app/src/lib/ephemeralFrames.ts` (header v2). A phone and a browser in the
/// same room read each other's slices because both sides write exactly this.
///
/// Header, little-endian:
///
///     off size field
///     0   2    magic "MS"
///     2   1    version (2)
///     3   1    track          0 = video, 1 = audio
///     4   1    flags          bit0 = keyframe
///     5   4    msgSeq         u32, per sender, one per frame
///     9   1    fragIndex
///     10  1    fragCount
///     11  2    width
///     13  2    height
///     15  8    timestampUs    media clock
///     23  8    createdAtMs    sender wall clock
///     31  8    startedAtMs    when this sender's broadcast began (slot ranking)
///     39  1    codecLen
///     40  …    codec (ASCII), then the payload
///
/// `Tests/StreamCoreTests/Fixtures/frame-vectors.json` holds slices produced
/// by the web's own `encodeFragments`; the tests check this encoder writes
/// them exactly.
public enum LiveFrames {
    /// `MAX_STATE_BYTES` in core 1.0's presence: one slice. (0.x relays took
    /// 16 KiB; ``encodeFragments(_:sliceBytes:)`` still writes that size for
    /// the web's vectors.)
    public static let maxSliceBytes = 4_096
    public static let version: UInt8 = 2
    public static let headerFixedBytes = 40
    public static let maxFragments = 255
    static let magic0: UInt8 = 0x4D
    static let magic1: UInt8 = 0x53
    static let flagKeyframe: UInt8 = 0x01

    /// Payload bytes one fragment carries for `codec`.
    public static func maxPayloadBytes(codec: String) -> Int {
        maxSliceBytes - headerFixedBytes - codec.utf8.count
    }

    /// Split one frame into presence-sized slices. A zero-byte frame is still one slice.
    public static func encodeFragments(_ frame: LiveFrame, sliceBytes: Int = maxSliceBytes) throws -> [[UInt8]] {
        guard frame.codec.allSatisfy({ $0.isASCII }) else { throw LiveFrameError.nonASCIICodec(frame.codec) }
        let codec = Array(frame.codec.utf8)
        let capacity = sliceBytes - headerFixedBytes - codec.count
        guard capacity > 0, codec.count <= 255 else { throw LiveFrameError.codecTooLong(codec.count) }
        let count = max(1, (frame.bytes.count + capacity - 1) / capacity)
        guard count <= maxFragments else { throw LiveFrameError.tooManyFragments(count) }

        var out: [[UInt8]] = []
        out.reserveCapacity(count)
        for index in 0..<count {
            let start = index * capacity
            let end = min(frame.bytes.count, start + capacity)
            var buf = [UInt8]()
            buf.reserveCapacity(headerFixedBytes + codec.count + max(0, end - start))
            buf.append(magic0)
            buf.append(magic1)
            buf.append(version)
            buf.append(UInt8(truncatingIfNeeded: frame.track))
            buf.append(frame.isKeyframe ? flagKeyframe : 0)
            buf.appendLE(UInt32(truncatingIfNeeded: frame.msgSeq))
            buf.append(UInt8(index))
            buf.append(UInt8(count))
            buf.appendLE(UInt16(truncatingIfNeeded: frame.width))
            buf.appendLE(UInt16(truncatingIfNeeded: frame.height))
            buf.appendLE(frame.timestampUs)
            buf.appendLE(frame.createdAtMs)
            buf.appendLE(frame.startedAtMs)
            buf.append(UInt8(codec.count))
            buf.append(contentsOf: codec)
            if start < end { buf.append(contentsOf: frame.bytes[start..<end]) }
            out.append(buf)
        }
        return out
    }

    /// Parse one slice, or nil when it is not ours (presence is shared with
    /// whatever else publishes in the context, so a foreign slice is a no-op).
    public static func decodeFragment(_ slice: [UInt8]) -> FrameFragment? {
        guard slice.count >= headerFixedBytes, slice[0] == magic0, slice[1] == magic1, slice[2] == version else {
            return nil
        }
        let codecLen = Int(slice[39])
        let payloadStart = headerFixedBytes + codecLen
        guard slice.count >= payloadStart else { return nil }
        let fragCount = Int(slice[10])
        let fragIndex = Int(slice[9])
        guard fragCount > 0, fragIndex < fragCount else { return nil }
        let codec = String(decoding: slice[headerFixedBytes..<payloadStart], as: UTF8.self)
        return FrameFragment(
            msgSeq: slice.readLE(UInt32.self, at: 5),
            track: Int(slice[3]),
            isKeyframe: slice[4] & flagKeyframe != 0,
            width: Int(slice.readLE(UInt16.self, at: 11)),
            height: Int(slice.readLE(UInt16.self, at: 13)),
            timestampUs: slice.readLE(UInt64.self, at: 15),
            createdAtMs: slice.readLE(UInt64.self, at: 23),
            startedAtMs: slice.readLE(UInt64.self, at: 31),
            codec: codec,
            fragIndex: fragIndex,
            fragCount: fragCount,
            payload: Array(slice[payloadStart...]))
    }

    /// The next per-sender frame counter, wrapping at the header's u32.
    public static func nextMsgSeq(_ current: UInt32) -> UInt32 { current &+ 1 }
}

public enum LiveFrameError: Error, Equatable {
    case nonASCIICodec(String)
    case codecTooLong(Int)
    case tooManyFragments(Int)
}

/// One encoded frame (a video access unit, or an audio packet).
public struct LiveFrame: Equatable, Sendable {
    public var msgSeq: UInt32
    /// 0 = video, 1 = audio.
    public var track: Int
    public var isKeyframe: Bool
    public var width: Int
    public var height: Int
    public var timestampUs: UInt64
    /// Sender wall clock, unix ms.
    public var createdAtMs: UInt64
    /// When this sender began its current broadcast, unix ms.
    public var startedAtMs: UInt64
    public var codec: String
    public var bytes: [UInt8]

    public init(
        msgSeq: UInt32, track: Int, isKeyframe: Bool, width: Int, height: Int, timestampUs: UInt64,
        createdAtMs: UInt64, startedAtMs: UInt64, codec: String, bytes: [UInt8]
    ) {
        self.msgSeq = msgSeq
        self.track = track
        self.isKeyframe = isKeyframe
        self.width = width
        self.height = height
        self.timestampUs = timestampUs
        self.createdAtMs = createdAtMs
        self.startedAtMs = startedAtMs
        self.codec = codec
        self.bytes = bytes
    }
}

/// A parsed slice: the frame header plus this fragment's bytes.
public struct FrameFragment: Equatable, Sendable {
    public var msgSeq: UInt32
    public var track: Int
    public var isKeyframe: Bool
    public var width: Int
    public var height: Int
    public var timestampUs: UInt64
    public var createdAtMs: UInt64
    public var startedAtMs: UInt64
    public var codec: String
    public var fragIndex: Int
    public var fragCount: Int
    public var payload: [UInt8]

    func frame(bytes: [UInt8]) -> LiveFrame {
        LiveFrame(
            msgSeq: msgSeq, track: track, isKeyframe: isKeyframe, width: width, height: height,
            timestampUs: timestampUs, createdAtMs: createdAtMs, startedAtMs: startedAtMs, codec: codec, bytes: bytes)
    }
}

/// Reassembles fragments into frames, per sender (the web's `FrameReassembler`):
/// out-of-order fragments still complete, a frame missing a fragment is never
/// emitted, a replay (msgSeq at or below the last emitted) is ignored.
///
/// Keyed by whatever the caller passes: the call keys it by author AND track,
/// because a phone numbers its audio packets separately from its video frames.
public final class FrameReassembler {
    /// Partially received frames held per sender before the oldest is dropped.
    public static let maxPendingFrames = 4

    private struct Pending {
        var fragments: [[UInt8]?]
        var received: Int
        let header: FrameFragment
    }

    private var pending: [String: [UInt32: Pending]] = [:]
    private var lastEmitted: [String: UInt32] = [:]

    public init() {}

    public func push(_ key: String, _ fragment: FrameFragment) -> LiveFrame? {
        if let emitted = lastEmitted[key], fragment.msgSeq <= emitted { return nil }

        if fragment.fragCount == 1 {
            lastEmitted[key] = fragment.msgSeq
            dropUpTo(key, fragment.msgSeq)
            return fragment.frame(bytes: fragment.payload)
        }

        var byKey = pending[key] ?? [:]
        if byKey[fragment.msgSeq] == nil {
            byKey[fragment.msgSeq] = Pending(
                fragments: Array(repeating: nil, count: fragment.fragCount), received: 0, header: fragment)
            while byKey.count > Self.maxPendingFrames, let oldest = byKey.keys.min() {
                byKey.removeValue(forKey: oldest)
            }
        }
        guard var slot = byKey[fragment.msgSeq] else {
            pending[key] = byKey
            return nil
        }
        if slot.fragments.count != fragment.fragCount {
            byKey.removeValue(forKey: fragment.msgSeq)
            pending[key] = byKey
            return nil
        }
        if slot.fragments[fragment.fragIndex] != nil {
            pending[key] = byKey
            return nil
        }
        slot.fragments[fragment.fragIndex] = fragment.payload
        slot.received += 1
        if slot.received < slot.fragments.count {
            byKey[fragment.msgSeq] = slot
            pending[key] = byKey
            return nil
        }
        byKey.removeValue(forKey: fragment.msgSeq)
        pending[key] = byKey
        lastEmitted[key] = fragment.msgSeq
        dropUpTo(key, fragment.msgSeq)
        return slot.header.frame(bytes: slot.fragments.flatMap { $0 ?? [] })
    }

    /// Drop everything held for a sender that has gone away.
    public func forget(_ key: String) {
        pending.removeValue(forKey: key)
        lastEmitted.removeValue(forKey: key)
    }

    /// Partial frames held for a key (diagnostics and tests).
    public func pendingCount(_ key: String) -> Int { pending[key]?.count ?? 0 }

    private func dropUpTo(_ key: String, _ msgSeq: UInt32) {
        guard var byKey = pending[key] else { return }
        for seq in byKey.keys where seq <= msgSeq { byKey.removeValue(forKey: seq) }
        pending[key] = byKey
    }
}

// MARK: - Little-endian helpers

extension Array where Element == UInt8 {
    mutating func appendLE<T: FixedWidthInteger>(_ value: T) {
        var v = value.littleEndian
        Swift.withUnsafeBytes(of: &v) { append(contentsOf: $0) }
    }

    func readLE<T: FixedWidthInteger>(_ type: T.Type, at offset: Int) -> T {
        var value: T = 0
        for i in 0..<MemoryLayout<T>.size {
            value |= T(self[offset + i]) << (8 * i)
        }
        return value
    }
}

extension Array where Element == UInt8 {
    /// Lowercase hex.
    public var hex: String { map { String(format: "%02x", $0) }.joined() }

    /// Bytes from hex, or nil.
    public init?(hex: String) {
        guard hex.count % 2 == 0 else { return nil }
        var out = [UInt8]()
        out.reserveCapacity(hex.count / 2)
        var index = hex.startIndex
        while index < hex.endIndex {
            let next = hex.index(index, offsetBy: 2)
            guard let byte = UInt8(hex[index..<next], radix: 16) else { return nil }
            out.append(byte)
            index = next
        }
        self = out
    }
}
