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

/// Bytes in, bytes out: the page's slice is JSON already.
struct PassThroughCodec: Codec {
    func encode(_ value: [UInt8]) throws -> [UInt8] { value }
    func decode(_ bytes: [UInt8]) throws -> [UInt8] { bytes }
}

/// Presence through the account's relay (`RelayPresenceClient`): each slice is a statement the
/// device key signs and the relay gossips. A phone has no node, so this is the only path.
public struct RelayPresenceChannel: PresenceChannel {
    let client: RelayPresenceClient
    let contextId: String

    public init(client: RelayPresenceClient, contextId: String) {
        self.client = client
        self.contextId = contextId
    }

    public func publish(_ sliceJSON: String) async throws {
        try await client.set(contextId: contextId, state: Array(sliceJSON.utf8), codec: PassThroughCodec())
    }

    public func retract() async {
        try? await client.set(contextId: contextId, state: nil, codec: PassThroughCodec())
    }

    public func slices() -> AsyncThrowingStream<String, Error> {
        let entries = client.subscribe(contextId: contextId, codec: PassThroughCodec())
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    for try await entry in entries {
                        guard !entry.removed, let bytes = entry.state else { continue }
                        continuation.yield(String(decoding: bytes, as: UTF8.self))
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

/// The web app's publishing rule, natively: one slice in flight at a time, and while one is,
/// only the newest waits behind it. At 15 slices a second a slow relay drops stale frames instead
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
