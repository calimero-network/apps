import Foundation
import MeroKit

/// One presence slice as it arrives: whose it is, and its bytes.
public struct MediaSlice: Equatable, Sendable {
    public let author: String
    public let bytes: [UInt8]?
    public let removed: Bool
    /// Set on a replayed entry (the seed a new subscriber gets). Stale media.
    public let ageMs: UInt64?

    public init(author: String, bytes: [UInt8]?, removed: Bool = false, ageMs: UInt64? = nil) {
        self.author = author
        self.bytes = bytes
        self.removed = removed
        self.ageMs = ageMs
    }
}

/// Where the call's media travels: the context's ephemeral presence. On a
/// phone that is the account's relay (``RelayMediaChannel``): each slice is a
/// device-signed `presence-intents` POST, gossiped to the room by the relay,
/// and read back off the relay's event stream. Tests pass a fake.
public protocol MediaChannel: Sendable {
    /// The author this device's slices carry (its device key), to skip our own echo.
    var selfAuthor: String? { get }
    /// Publish one slice. Calls are made one at a time (the call awaits each).
    func publish(contextId: String, slice: [UInt8]) async throws
    /// Retract our slice, on leaving.
    func retract(contextId: String) async
    /// Every slice in the context as it arrives.
    func slices(contextId: String) -> AsyncThrowingStream<MediaSlice, Error>
}

/// Raw bytes as the presence codec: a slice is our framing, not JSON.
public struct BytesCodec: Codec {
    public init() {}
    public func encode(_ value: [UInt8]) throws -> [UInt8] { value }
    public func decode(_ bytes: [UInt8]) throws -> [UInt8] { bytes }
}

/// ``MediaChannel`` over MeroKit's ``RelayPresenceClient``.
public struct RelayMediaChannel: MediaChannel {
    public let presence: RelayPresenceClient
    public let selfAuthor: String?

    public init(presence: RelayPresenceClient, selfAuthor: String?) {
        self.presence = presence
        self.selfAuthor = selfAuthor
    }

    public func publish(contextId: String, slice: [UInt8]) async throws {
        try await presence.set(contextId: contextId, state: slice, codec: BytesCodec())
    }

    public func retract(contextId: String) async {
        try? await presence.set(contextId: contextId, state: nil as [UInt8]?, codec: BytesCodec())
    }

    public func slices(contextId: String) -> AsyncThrowingStream<MediaSlice, Error> {
        let upstream = presence.subscribe(contextId: contextId, codec: BytesCodec())
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    for try await entry in upstream {
                        continuation.yield(
                            MediaSlice(author: entry.author, bytes: entry.state, removed: entry.removed, ageMs: entry.ageMs))
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
