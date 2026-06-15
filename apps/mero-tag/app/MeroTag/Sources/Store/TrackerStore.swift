import Foundation
import MeroKit

/// Observable state for the trackers/presence in the current space. Hydrates
/// from the contract, then reconciles live via SSE events.
@MainActor
public final class TrackerStore: ObservableObject {
    @Published public private(set) var trackers: [Tracker] = []
    @Published public private(set) var presence: [String: Presence] = [:]
    @Published public private(set) var space: SpaceInfo?
    @Published public var lastError: String?

    private let service: MeroService
    private var eventTask: Task<Void, Never>?

    public init(service: MeroService) {
        self.service = service
    }

    public func bootstrap(username: String) async {
        do {
            try await service.join(username: username)
            try await service.updatePresence(online: true)
            await refresh()
            startListening()
        } catch {
            lastError = error.localizedDescription
        }
    }

    public func refresh() async {
        do {
            async let trackers = service.getTrackers()
            async let presence = service.getPresence()
            async let space = service.getSpace()
            self.trackers = try await trackers.sorted { $0.name < $1.name }
            self.presence = Dictionary(uniqueKeysWithValues: try await presence.map { ($0.userId, $0) })
            self.space = try await space
        } catch {
            lastError = error.localizedDescription
        }
    }

    /// Apply a live event. Most events just trigger a targeted refresh; for high
    /// frequency `trackerUpdated` we refetch the single tracker.
    public func startListening() {
        eventTask?.cancel()
        eventTask = Task { [weak self] in
            guard let self else { return }
            for await event in service.events() {
                if Task.isCancelled { break }
                switch event {
                case .trackerUpdated, .trackerCreated, .trackerRenamed,
                     .trackerDeleted, .trackerShared:
                    await self.refreshTrackers()
                case .presenceUpdated:
                    await self.refreshPresence()
                default:
                    break
                }
            }
        }
    }

    private func refreshTrackers() async {
        if let t = try? await service.getTrackers() {
            trackers = t.sorted { $0.name < $1.name }
        }
    }

    private func refreshPresence() async {
        if let p = try? await service.getPresence() {
            presence = Dictionary(uniqueKeysWithValues: p.map { ($0.userId, $0) })
        }
    }

    public func createTracker(name: String) async {
        do {
            try await service.createTracker(id: UUID().uuidString, name: name)
            await refreshTrackers()
        } catch { lastError = error.localizedDescription }
    }

    public func pushLocation(trackerId: String, _ loc: Location) async {
        do { try await service.updateLocation(trackerId: trackerId, loc) }
        catch { lastError = error.localizedDescription }
    }

    public func stop() {
        eventTask?.cancel()
        eventTask = nil
    }
}
