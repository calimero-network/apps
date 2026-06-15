import Foundation
import CoreLocation

#if canImport(UIKit)
import UIKit
#endif

/// Bridges CoreLocation to the contract. Requests authorization, coalesces
/// updates (distance + time filter so we don't hammer the node), reads battery,
/// and forwards each fix to `onLocation`.
@MainActor
public final class LocationService: NSObject, ObservableObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var lastSentAt: Date = .distantPast
    private var lastSentCoord: CLLocationCoordinate2D?

    /// Minimum spacing between forwarded updates.
    public var minInterval: TimeInterval = 5
    public var minDistanceMeters: CLLocationDistance = 10

    @Published public private(set) var authorization: CLAuthorizationStatus = .notDetermined
    @Published public private(set) var lastLocation: Location?

    /// Called for each accepted (throttled) location fix.
    public var onLocation: ((Location) -> Void)?

    public override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = minDistanceMeters
        #if canImport(UIKit)
        UIDevice.current.isBatteryMonitoringEnabled = true
        #endif
    }

    public func requestAuthorization() {
        manager.requestWhenInUseAuthorization()
    }

    /// Ask for Always (background) authorization — call after When-In-Use is granted.
    public func requestAlways() {
        #if os(iOS)
        manager.allowsBackgroundLocationUpdates = true
        manager.requestAlwaysAuthorization()
        #endif
    }

    public func start() {
        manager.startUpdatingLocation()
        #if os(iOS)
        manager.startMonitoringSignificantLocationChanges()
        #endif
    }

    public func stop() {
        manager.stopUpdatingLocation()
        #if os(iOS)
        manager.stopMonitoringSignificantLocationChanges()
        #endif
    }

    private func batteryPercent() -> Int {
        #if canImport(UIKit)
        let level = UIDevice.current.batteryLevel // -1 when unknown
        return level < 0 ? 100 : Int(level * 100)
        #else
        return 100
        #endif
    }

    // MARK: CLLocationManagerDelegate

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        authorization = manager.authorizationStatus
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        let now = Date()
        // Throttle: enforce min interval and min distance.
        if now.timeIntervalSince(lastSentAt) < minInterval {
            if let last = lastSentCoord {
                let moved = CLLocation(latitude: last.latitude, longitude: last.longitude)
                    .distance(from: loc)
                if moved < minDistanceMeters { return }
            } else { return }
        }
        lastSentAt = now
        lastSentCoord = loc.coordinate

        let model = Location(
            latitude: loc.coordinate.latitude,
            longitude: loc.coordinate.longitude,
            altitude: loc.altitude,
            speed: max(0, loc.speed),
            heading: loc.course >= 0 ? loc.course : 0,
            battery: batteryPercent(),
            timestamp: UInt64(now.timeIntervalSince1970 * 1000)
        )
        lastLocation = model
        onLocation?(model)
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Transient CoreLocation errors are common; ignore and keep going.
    }
}
