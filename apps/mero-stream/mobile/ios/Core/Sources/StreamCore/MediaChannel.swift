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

/// Where the call's media travels: the room's ephemeral presence. On
/// Calimero 1.0 that is the app instance's presence on its cluster
/// (``CalimeroMediaChannel``): each slice is a `POST /apps/{app}/presence`
/// (at most ``LiveFrames/maxSliceBytes``), passed to every node and read back
/// off `GET /apps/{app}/presence/stream`. Nothing is stored. Tests pass a fake.
public protocol MediaChannel: Sendable {
    /// The author this session's slices carry (the account), to skip our own echo.
    var selfAuthor: String? { get }
    /// Publish one slice. Calls are made one at a time (the call awaits each).
    func publish(contextId: String, slice: [UInt8]) async throws
    /// Retract our slice, on leaving.
    func retract(contextId: String) async
    /// Every slice in the context as it arrives.
    func slices(contextId: String) -> AsyncThrowingStream<MediaSlice, Error>
}

/// ``MediaChannel`` over a Calimero 1.0 app instance's presence
/// (`CalimeroClient.publishPresence` / `presenceStream`). One entry per
/// account and device: newest `seq` wins, an entry not refreshed within 7 s is
/// dropped, and state is at most 4 KiB, which ``LiveFrames`` fragments to.
public final class CalimeroMediaChannel: MediaChannel, @unchecked Sendable {
    public let client: CalimeroClient
    /// The signed-in account. Every device of it is skipped as our own echo.
    public let selfAuthor: String?
    private let lock = NSLock()
    private var seq = 0

    public init(client: CalimeroClient, account: String?) {
        self.client = client
        self.selfAuthor = account
    }

    private func nextSeq() -> Int {
        lock.lock()
        defer { lock.unlock() }
        seq += 1
        return seq
    }

    public func publish(contextId: String, slice: [UInt8]) async throws {
        try await client.publishPresence(contextId, seq: nextSeq(), state: Data(slice))
    }

    public func retract(contextId: String) async {
        try? await client.publishPresence(contextId, seq: nextSeq(), state: nil)
    }

    public func slices(contextId: String) -> AsyncThrowingStream<MediaSlice, Error> {
        let upstream = client.presenceStream(contextId)
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    for try await event in upstream {
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

    /// The slices one stream event carries: a `snapshot` (every entry present
    /// now, replayed so marked stale with `ageMs`) or one `presence` diff
    /// (`state: null` when someone left). The author is the account.
    static func slices(_ event: CloudEvent) -> [MediaSlice] {
        let entries: [JSONValue]
        let replayed = event.kind == "snapshot"
        switch event.data {
        case .array(let list): entries = list
        case .object: entries = [event.data]
        default: return []
        }
        return entries.compactMap { entry in
            guard let account = entry["account"]?.stringValue else { return nil }
            guard let hex = entry["state"]?.stringValue else {
                return MediaSlice(author: account, bytes: nil, removed: true)
            }
            guard let data = try? Hex.decodeUnsized(hex, label: "presence state") else { return nil }
            return MediaSlice(author: account, bytes: [UInt8](data), ageMs: replayed ? 0 : nil)
        }
    }
}
