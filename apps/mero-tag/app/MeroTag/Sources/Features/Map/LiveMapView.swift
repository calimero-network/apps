import SwiftUI
import MapKit
import MeroKit

struct LiveMapView: View {
    @EnvironmentObject private var app: AppState
    @StateObject private var location = LocationService()
    @State private var camera: MapCameraPosition = .automatic
    @State private var sharingTrackerId: String?

    var body: some View {
        NavigationStack {
            Group {
                if let store = app.store {
                    mapBody(store: store)
                } else {
                    ProgressView()
                }
            }
            .navigationTitle("Live Map")
            .onAppear { setupLocation() }
        }
    }

    @ViewBuilder
    private func mapBody(store: TrackerStore) -> some View {
        Map(position: $camera) {
            UserAnnotation()
            ForEach(store.trackers.compactMap { t in t.latest.map { (t, $0) } }, id: \.0.id) { pair in
                let (tracker, loc) = pair
                Annotation(tracker.name,
                           coordinate: CLLocationCoordinate2D(latitude: loc.latitude, longitude: loc.longitude)) {
                    ZStack {
                        Circle().fill(.blue).frame(width: 24, height: 24)
                        Image(systemName: "location.fill").font(.caption2).foregroundStyle(.white)
                    }
                }
            }
        }
        .mapControls { MapUserLocationButton(); MapCompass(); MapPitchToggle() }
        .safeAreaInset(edge: .bottom) {
            if let id = sharingTrackerId {
                Label("Sharing as this device", systemImage: "dot.radiowaves.up.forward")
                    .padding(8).background(.thinMaterial, in: Capsule()).padding(.bottom, 8)
                    .onTapGesture { _ = id }
            }
        }
    }

    private func setupLocation() {
        guard let store = app.store else { return }
        location.requestAuthorization()
        // Bind this device to the first tracker we own (demo behaviour).
        location.onLocation = { loc in
            guard let trackerId = sharingTrackerId else { return }
            Task { await store.pushLocation(trackerId: trackerId, loc) }
        }
        if sharingTrackerId == nil {
            sharingTrackerId = store.trackers.first?.id
        }
        location.start()
    }
}
