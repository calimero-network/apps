import CoreLocation
import Foundation

/// Which tracker this device reports as, and whether it is reporting. Owns
/// the ``LocationService`` so sharing keeps running across tabs.
@MainActor
final class LocationSharing: ObservableObject {
    @Published private(set) var trackerId: String?
    @Published private(set) var isSharing = false
    @Published private(set) var lastSentAt: Date?

    let location = LocationService()
    private let preferences: SpacePreferences
    private weak var store: TrackerStore?

    init(preferences: SpacePreferences = SpacePreferences()) {
        self.preferences = preferences
        self.trackerId = preferences.sharingTrackerId
    }

    var authorization: CLAuthorizationStatus { location.authorization }

    var isDenied: Bool {
        location.authorization == .denied || location.authorization == .restricted
    }

    func attach(_ store: TrackerStore) {
        self.store = store
        location.onLocation = { [weak self] loc in
            guard let self, self.isSharing, let id = self.trackerId, let store = self.store else { return }
            Task {
                await store.pushLocation(trackerId: id, loc)
                self.lastSentAt = Date()
            }
        }
        // Resume sharing after a relaunch if a tracker of ours was chosen.
        if let id = trackerId, store.trackers.isEmpty || store.tracker(id: id) != nil {
            start(trackerId: id)
        }
    }

    func start(trackerId: String) {
        self.trackerId = trackerId
        preferences.sharingTrackerId = trackerId
        location.requestAuthorization()
        location.start()
        isSharing = true
    }

    func stop() {
        location.stop()
        isSharing = false
        preferences.sharingTrackerId = nil
    }

    /// Start, or restart with a different tracker.
    func toggle(trackerId: String) {
        if isSharing && self.trackerId == trackerId { stop() } else { start(trackerId: trackerId) }
    }
}
