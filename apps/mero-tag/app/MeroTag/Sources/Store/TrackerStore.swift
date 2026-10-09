import Foundation
import MeroKit

/// Observable state for one space: trackers, members and presence. Hydrates
/// from the contract, then reconciles from live events — or, when the relay
/// session that carries events is unavailable, by polling.
@MainActor
public final class TrackerStore: ObservableObject {
    public enum Connection: Equatable {
        case connecting
        /// Receiving live events.
        case live
        /// No event stream; refreshing on a timer.
        case polling
    }

    @Published public private(set) var trackers: [Tracker] = []
    @Published public private(set) var members: [Member] = []
    @Published public private(set) var presence: [String: Presence] = [:]
    @Published public private(set) var space: SpaceInfo?
    @Published public private(set) var connection: Connection = .connecting
    @Published public private(set) var hasLoaded = false
    @Published public var lastError: String?

    public let service: MeroService
    public var memberId: String { service.memberId }

    /// Called when an error means the account session is over (revoked), so
    /// the app can return to sign-in with a reason.
    var onSessionEnded: ((String) -> Void)?

    private var eventTask: Task<Void, Never>?
    private var pollTask: Task<Void, Never>?
    private let pollInterval: UInt64

    public init(service: MeroService, pollInterval: TimeInterval = 20) {
        self.service = service
        self.pollInterval = UInt64(pollInterval * 1_000_000_000)
    }

    // MARK: Lifecycle

    /// Join the space (once per account), announce presence, load, listen.
    public func bootstrap(displayName: String) async {
        await refresh()
        do {
            if !members.contains(where: { $0.id == memberId }) {
                try await service.join(username: displayName)
                members = (try? await service.getMembers()) ?? members
            }
            try await service.updatePresence(online: true)
        } catch {
            report(error)
        }
        startListening()
    }

    public func refresh() async {
        do {
            async let trackers = service.getTrackers()
            async let presence = service.getPresence()
            async let space = service.getSpace()
            async let members = service.getMembers()
            self.trackers = try await trackers.sorted(by: Self.order)
            self.presence = Self.index(try await presence)
            self.space = try await space
            self.members = try await members
            lastError = nil
        } catch {
            report(error)
        }
        hasLoaded = true
    }

    public func startListening() {
        stopListening()
        guard let stream = service.events() else {
            startPolling()
            return
        }
        connection = .live
        eventTask = Task { [weak self] in
            do {
                for try await batch in stream {
                    guard let self, !Task.isCancelled else { return }
                    await self.apply(batch)
                }
            } catch {
                self?.report(error)
            }
            // The stream ends only when it cannot be re-established.
            guard let self, !Task.isCancelled else { return }
            self.startPolling()
        }
    }

    public func stop() {
        stopListening()
        connection = .connecting
    }

    private func stopListening() {
        eventTask?.cancel()
        eventTask = nil
        pollTask?.cancel()
        pollTask = nil
    }

    private func startPolling() {
        connection = .polling
        pollTask?.cancel()
        pollTask = Task { [weak self, pollInterval] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: pollInterval)
                guard let self, !Task.isCancelled else { return }
                await self.refresh()
            }
        }
    }

    func apply(_ batch: [TagEvent]) async {
        var needsTrackers = false
        var needsPresence = false
        var needsAll = false
        for event in batch {
            switch event {
            case .trackerCreated, .trackerUpdated, .trackerRenamed, .trackerDeleted, .trackerShared:
                needsTrackers = true
            case .presenceUpdated:
                needsPresence = true
            case .memberJoined, .stateChanged:
                needsAll = true
            default:
                break
            }
        }
        if needsAll { return await refresh() }
        if needsTrackers, let t = try? await service.getTrackers() { trackers = t.sorted(by: Self.order) }
        if needsPresence, let p = try? await service.getPresence() { presence = Self.index(p) }
    }

    // MARK: Actions

    @discardableResult
    public func createTracker(name: String) async -> Bool {
        do {
            try await service.createTracker(id: UUID().uuidString.lowercased(), name: name)
            await refreshTrackers()
            return true
        } catch {
            report(error)
            return false
        }
    }

    @discardableResult
    public func renameTracker(id: String, name: String) async -> Bool {
        await perform { try await self.service.renameTracker(id: id, name: name) }
    }

    @discardableResult
    public func deleteTracker(id: String) async -> Bool {
        await perform { try await self.service.deleteTracker(id: id) }
    }

    @discardableResult
    public func share(trackerId: String, with userId: String) async -> Bool {
        await perform { try await self.service.shareTracker(trackerId: trackerId, userId: userId) }
    }

    @discardableResult
    public func unshare(trackerId: String, from userId: String) async -> Bool {
        await perform { try await self.service.unshareTracker(trackerId: trackerId, userId: userId) }
    }

    public func pushLocation(trackerId: String, _ loc: Location) async {
        do { try await service.updateLocation(trackerId: trackerId, loc) } catch { report(error) }
    }

    /// Mark this member offline (best effort) before leaving the space.
    public func goOffline() async {
        try? await service.updatePresence(online: false)
    }

    private func perform(_ work: @escaping () async throws -> Void) async -> Bool {
        do {
            try await work()
            await refreshTrackers()
            return true
        } catch {
            report(error)
            return false
        }
    }

    private func refreshTrackers() async {
        if let t = try? await service.getTrackers() { trackers = t.sorted(by: Self.order) }
    }

    // MARK: Lookups

    public func tracker(id: String) -> Tracker? { trackers.first { $0.id == id } }

    /// A member's display name, or a short form of their account id.
    public func displayName(for memberId: String) -> String {
        if memberId == self.memberId, let me = members.first(where: { $0.id == memberId }) {
            return "\(me.username) (you)"
        }
        return members.first { $0.id == memberId }?.username ?? Self.shortId(memberId)
    }

    public func isOnline(_ memberId: String) -> Bool { presence[memberId]?.online ?? false }

    public var myTrackers: [Tracker] { trackers.filter { $0.ownerId == memberId } }

    // MARK: Errors

    func report(_ error: Error) {
        if let reason = Self.sessionEndReason(error) {
            onSessionEnded?(reason)
            return
        }
        lastError = Self.message(for: error)
    }

    /// A terminal account-session failure, phrased for the sign-in screen.
    static func sessionEndReason(_ error: Error) -> String? {
        switch error {
        case MeroError.authRevoked:
            return "Your Calimero session was revoked."
        case AccountError.credentialRejected, AccountError.notSignedIn:
            return "This device is no longer signed in to your Calimero account."
        default:
            return nil
        }
    }

    static func message(for error: Error) -> String {
        switch error {
        case AccountError.intentRefused(let reason, _, let status) where status == 403:
            return "The relay refused that change: \(reason)"
        case AccountError.intentRefused(let reason, _, _):
            return reason
        case MeroError.network:
            return "Can't reach your relay. Check your connection; changes will retry when you're back online."
        default:
            return (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    static func shortId(_ id: String) -> String {
        id.count > 12 ? "\(id.prefix(6))…\(id.suffix(4))" : id
    }

    private static func order(_ a: Tracker, _ b: Tracker) -> Bool {
        a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
    }

    private static func index(_ list: [Presence]) -> [String: Presence] {
        Dictionary(list.map { ($0.userId, $0) }, uniquingKeysWith: { a, b in a.lastSeen >= b.lastSeen ? a : b })
    }
}
