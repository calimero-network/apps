import Foundation
import MeroKit

/// The fight's presence channel: this fighter's slices out, the opponent's in, as JSON text the
/// page reads and writes. The native side never looks inside a slice. (Kotlin `PresenceChannel`.)
public protocol PresenceChannel: Sendable {
    /// Publish this fighter's slice, replacing the last one.
    func publish(_ sliceJSON: String) async throws
    /// Take this fighter's slice down (leaving the arena).
    func retract() async
    /// Everyone's slices in the arena, as they arrive.
    func slices() -> AsyncThrowingStream<String, Error>
}

/// Presence on a Calimero 1.0 cluster: the arena app instance's presence
/// (`POST /apps/{app}/presence`, read off `/apps/{app}/presence/stream`). One entry per account and
/// device, newest `seq` wins, at most 4 KiB, gone 7 s after its last refresh. Nothing is stored.
public final class CalimeroPresenceChannel: PresenceChannel, @unchecked Sendable {
    let client: CalimeroClient
    let contextId: String
    private let lock = NSLock()
    private var seq = 0

    public init(client: CalimeroClient, contextId: String) {
        self.client = client
        self.contextId = contextId
    }

    private func nextSeq() -> Int {
        lock.lock()
        defer { lock.unlock() }
        seq += 1
        return seq
    }

    public func publish(_ sliceJSON: String) async throws {
        try await client.publishPresence(contextId, seq: nextSeq(), state: Data(sliceJSON.utf8))
    }

    public func retract() async {
        try? await client.publishPresence(contextId, seq: nextSeq(), state: nil)
    }

    public func slices() -> AsyncThrowingStream<String, Error> {
        let events = client.presenceStream(contextId)
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    for try await event in events {
                        for slice in Self.slices(event) { continuation.yield(slice) }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// The slices one stream event carries: a `snapshot` (an array of entries) or one `presence`
    /// diff. Entries without state (someone left) carry no slice.
    static func slices(_ event: CloudEvent) -> [String] {
        let entries: [JSONValue]
        switch event.data {
        case .array(let list): entries = list
        case .object: entries = [event.data]
        default: return []
        }
        return entries.compactMap { entry in
            guard let hex = entry["state"]?.stringValue, let data = try? Hex.decodeUnsized(hex, label: "presence state")
            else { return nil }
            return String(decoding: data, as: UTF8.self)
        }
    }
}

/// The web app's publishing rule, natively: one slice in flight at a time, and while one is,
/// only the newest waits behind it. At 15 slices a second a slow node drops stale frames instead
/// of queueing them, so the opponent always sees where this fighter is NOW. (Kotlin `SlicePublisher`.)
public actor SlicePublisher {
    private let channel: any PresenceChannel
    private var inFlight = false
    private var waiting: String?
    /// Slices sent, for the screen's meter and the tests.
    public private(set) var sent = 0
    public private(set) var dropped = 0

    public init(channel: any PresenceChannel) { self.channel = channel }

    public func offer(_ sliceJSON: String) async {
        if inFlight {
            if waiting != nil { dropped += 1 }
            waiting = sliceJSON
            return
        }
        inFlight = true
        var next: String? = sliceJSON
        while let slice = next {
            sent += 1
            try? await channel.publish(slice)  // a dropped frame is replaced 66 ms later
            next = waiting
            waiting = nil
        }
        inFlight = false
    }
}
