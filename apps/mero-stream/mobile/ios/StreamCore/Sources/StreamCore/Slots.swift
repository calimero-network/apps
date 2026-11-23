import Foundation

/// Broadcaster slots, as the web app runs them (`app/src/lib/slots.ts`): at
/// most two people send video at once; every peer ranks the active
/// broadcasters by when they started (floored by when this peer first saw
/// them) and yields its own camera if it falls outside the cap. Nobody
/// coordinates: everyone computes the same answer from the same headers.
public enum Slots {
    public static let maxBroadcasters = 2
    /// How far before we first saw a sender its claimed start may be believed.
    public static let claimBackdateGraceMs: UInt64 = 5_000
    /// From this many broadcasters on, delivery degrades (measured on the web).
    public static let degradedFromBroadcasters = 2
    public static let degradedDeliveryPercent = 60

    public static func effectiveStart(_ claim: Claim) -> UInt64 {
        let floor = claim.firstSeenAt > claimBackdateGraceMs ? claim.firstSeenAt - claimBackdateGraceMs : 0
        return max(claim.startedAtMs, floor)
    }

    static func ordered(_ a: Claim, _ b: Claim) -> Bool {
        let sa = effectiveStart(a)
        let sb = effectiveStart(b)
        if sa != sb { return sa < sb }
        return a.id < b.id
    }

    public static func evaluate(
        others: [Claim], me: String?, myStartedAtMs: UInt64?, nowMs: UInt64, timeoutMs: UInt64,
        max: Int = maxBroadcasters
    ) -> SlotView {
        var claims = me.map { me in others.filter { $0.id != me } } ?? others
        if let me, let started = myStartedAtMs {
            claims.append(Claim(id: me, startedAtMs: started, firstSeenAt: started, lastSeenAt: nowMs))
        }
        let cutoff = nowMs > timeoutMs ? nowMs - timeoutMs : 0
        let ranked = claims.filter { $0.lastSeenAt >= cutoff }.sorted(by: ordered)
        let holders = Array(ranked.prefix(max))
        let myRank = (me != nil && myStartedAtMs != nil) ? ranked.firstIndex { $0.id == me } : nil
        let broadcasting = myRank != nil
        return SlotView(
            ranked: ranked, holders: holders, occupied: holders.count, free: Swift.max(0, max - holders.count),
            full: holders.count >= max, myRank: myRank, mayClaim: !broadcasting && holders.count < max,
            mustYield: broadcasting && (myRank ?? 0) >= max)
    }
}

public struct Claim: Equatable, Sendable {
    public let id: String
    public let startedAtMs: UInt64
    public let firstSeenAt: UInt64
    public let lastSeenAt: UInt64

    public init(id: String, startedAtMs: UInt64, firstSeenAt: UInt64, lastSeenAt: UInt64) {
        self.id = id
        self.startedAtMs = startedAtMs
        self.firstSeenAt = firstSeenAt
        self.lastSeenAt = lastSeenAt
    }
}

public struct SlotView: Equatable, Sendable {
    public let ranked: [Claim]
    public let holders: [Claim]
    public let occupied: Int
    public let free: Int
    public let full: Bool
    public let myRank: Int?
    public let mayClaim: Bool
    public let mustYield: Bool

    public static let empty = Slots.evaluate(others: [], me: nil, myStartedAtMs: nil, nowMs: 0, timeoutMs: 0)
}

/// The shared encoding budget (`app/src/lib/capacity.ts` `adaptiveEncoding`):
/// frame rate and bitrate are divided among the live broadcasters, with floors.
public struct Encoding: Equatable, Sendable {
    public var fps: Int
    public var bitrate: Int

    public init(fps: Int, bitrate: Int) {
        self.fps = fps
        self.bitrate = bitrate
    }

    public static let minFps = 10
    public static let minBitrate = 400_000

    public static func adaptive(_ base: Encoding, broadcasters: Int) -> Encoding {
        let live = max(1, broadcasters)
        let baseFps = max(1, base.fps)
        let fps = max(min(minFps, baseFps), Int((Double(baseFps) / Double(live)).rounded()))
        let bitrate = max(min(minBitrate, max(0, base.bitrate)), Int((Double(max(0, base.bitrate)) / Double(live)).rounded()))
        return Encoding(fps: fps, bitrate: bitrate)
    }
}
