import CoreLocation
import MapKit
import SwiftUI

struct LiveMapView: View {
    @ObservedObject var store: TrackerStore
    @EnvironmentObject private var sharing: LocationSharing
    @State private var camera: MapCameraPosition = .automatic
    @State private var selectedId: String?

    private var located: [(Tracker, Location)] {
        store.trackers.compactMap { t in t.latest.map { (t, $0) } }
    }

    var body: some View {
        Map(position: $camera, selection: $selectedId) {
            UserAnnotation()
            ForEach(located, id: \.0.id) { tracker, loc in
                Annotation(tracker.name, coordinate: loc.coordinate, anchor: .bottom) {
                    TrackerPin(
                        name: tracker.name, seed: tracker.id,
                        isLive: store.isOnline(tracker.ownerId),
                        isSelected: selectedId == tracker.id)
                }
                .annotationTitles(.hidden)
                .tag(tracker.id)
            }
        }
        .mapStyle(.standard(elevation: .realistic, pointsOfInterest: .excludingAll))
        .mapControls {
            MapCompass()
            MapScaleView()
        }
        .safeAreaInset(edge: .top) { header }
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 10) {
                if let id = selectedId, let tracker = store.tracker(id: id) {
                    SelectedTrackerCard(tracker: tracker, store: store) {
                        withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) { selectedId = nil }
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
                SharingPanel(store: store, location: sharing.location)
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 8)
            .animation(.spring(response: 0.35, dampingFraction: 0.85), value: selectedId)
        }
        .onChange(of: selectedId) { _, id in
            guard let id, let loc = store.tracker(id: id)?.latest else { return }
            Platform.tap()
            withAnimation(.easeInOut(duration: 0.6)) {
                camera = .region(
                    MKCoordinateRegion(
                        center: loc.coordinate, latitudinalMeters: 1200, longitudinalMeters: 1200))
            }
        }
        .accessibilityIdentifier("liveMap")
    }

    private var header: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                BrandMark(size: 34)
                VStack(alignment: .leading, spacing: 1) {
                    Text(store.space?.name ?? "Mero Tag")
                        .font(Tag.Typeface.brand)
                        .foregroundStyle(Tag.ink)
                        .lineLimit(1)
                    Text(peopleSummary).font(.system(size: 12.5)).foregroundStyle(Tag.textFaint)
                }
                Spacer(minLength: 8)
                ConnectionPill(connection: store.connection)
                IconButton(systemImage: "scope", label: "Show everyone", bordered: true) {
                    Platform.tap()
                    selectedId = nil
                    withAnimation(.easeInOut(duration: 0.6)) { camera = .automatic }
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Color.white.opacity(0.25)))
            .shadow(color: .black.opacity(0.12), radius: 18, y: 8)

            if !store.trackers.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(store.trackers) { tracker in
                            PersonChip(
                                name: tracker.name, seed: tracker.id, isLive: store.isOnline(tracker.ownerId),
                                hasLocation: tracker.latest != nil, isSelected: selectedId == tracker.id
                            ) {
                                withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) {
                                    selectedId = selectedId == tracker.id ? nil : tracker.id
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 2)
                }
            } else if store.hasLoaded {
                Callout(tone: .info, message: "No one has shared a position yet. Create a tracker to start.")
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 4)
    }

    private var peopleSummary: String {
        let live = store.trackers.filter { store.isOnline($0.ownerId) }.count
        let count = store.trackers.count
        return "\(count) \(count == 1 ? "tracker" : "trackers") · \(live) live"
    }
}

/// A person in the strip over the map: avatar, name, live dot.
private struct PersonChip: View {
    let name: String
    let seed: String
    let isLive: Bool
    let hasLocation: Bool
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Avatar(name: name, seed: seed, size: 26)
                Text(name).font(.system(size: 14, weight: .semibold)).lineLimit(1)
                if isLive {
                    Circle().fill(Tag.live).frame(width: 7, height: 7)
                } else if !hasLocation {
                    Image(systemName: "location.slash").font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Tag.textFaint)
                }
            }
            .foregroundStyle(isSelected ? Tag.onAccent : Tag.ink)
            .padding(.leading, 5)
            .padding(.trailing, 12)
            .frame(height: 36)
            .background {
                if isSelected {
                    Capsule().fill(Tag.accentGradient)
                } else {
                    Capsule().fill(.regularMaterial)
                }
            }
            .overlay(Capsule().strokeBorder(Color.white.opacity(isSelected ? 0 : 0.3)))
            .shadow(color: .black.opacity(0.1), radius: 8, y: 4)
        }
        .buttonStyle(.plain)
        .disabled(!hasLocation)
        .accessibilityLabel("\(name), \(isLive ? "live" : hasLocation ? "last seen" : "no location")")
        .accessibilityIdentifier("personChip")
    }
}

/// A person on the map: their avatar in a white ring with a pointer, a mint
/// pulse when live, and their name. Selected pins grow.
struct TrackerPin: View {
    let name: String
    var seed: String?
    let isLive: Bool
    var isSelected = false

    var body: some View {
        VStack(spacing: 4) {
            ZStack {
                if isLive { PulseRing(color: Tag.live, size: isSelected ? 50 : 42) }
                VStack(spacing: -4) {
                    Avatar(name: name, seed: seed ?? name, size: isSelected ? 44 : 36)
                        .padding(3)
                        .background(Circle().fill(.white))
                        .overlay(
                            Circle().strokeBorder(isLive ? Tag.live : Color.white, lineWidth: isLive ? 2.5 : 0)
                        )
                        .shadow(color: Color.black.opacity(0.25), radius: 6, y: 3)
                    Image(systemName: "arrowtriangle.down.fill")
                        .font(.system(size: 10))
                        .foregroundStyle(.white)
                        .shadow(color: Color.black.opacity(0.15), radius: 1, y: 1)
                }
            }
            Text(name)
                .font(.system(size: 12, weight: .bold, design: .rounded))
                .foregroundStyle(Tag.ink)
                .lineLimit(1)
                .padding(.horizontal, 9)
                .frame(height: 22)
                .background(Capsule().fill(.regularMaterial))
                .shadow(color: Color.black.opacity(0.1), radius: 3, y: 1)
        }
        .scaleEffect(isSelected ? 1.08 : 1)
        .animation(.spring(response: 0.3, dampingFraction: 0.65), value: isSelected)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(name), \(isLive ? "online" : "offline")")
    }
}

private struct SelectedTrackerCard: View {
    let tracker: Tracker
    @ObservedObject var store: TrackerStore
    let onClose: () -> Void

    var body: some View {
        GlassCard(padding: 14) {
            HStack(spacing: 12) {
                Avatar(name: tracker.name, seed: tracker.id, size: 44)
                VStack(alignment: .leading, spacing: 2) {
                    Text(tracker.name).font(Tag.Typeface.section).foregroundStyle(Tag.ink)
                    Text(meta).font(Tag.Typeface.meta).foregroundStyle(Tag.textFaint).lineLimit(1)
                }
                Spacer(minLength: 8)
                if let battery = tracker.latest?.battery {
                    Badge(text: "\(battery)%", tone: battery <= 20 ? .warning : .neutral, systemImage: BatteryIcon.name(battery))
                }
                IconButton(systemImage: "xmark", label: "Close", action: onClose)
            }
        }
    }

    private var meta: String {
        let owner = store.displayName(for: tracker.ownerId)
        guard let loc = tracker.latest else { return owner }
        return "\(owner) · \(RelativeTime.string(fromMillis: loc.timestamp))"
    }
}

/// Bottom panel: what this phone is sharing, with start/stop and the tracker.
private struct SharingPanel: View {
    @ObservedObject var store: TrackerStore
    @ObservedObject var location: LocationService
    @EnvironmentObject private var sharing: LocationSharing

    var body: some View {
        GlassCard(padding: 14) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    IconTile(
                        systemImage: sharing.isSharing ? "location.fill" : "location.slash",
                        accent: sharing.isSharing)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title).font(Tag.Typeface.section).foregroundStyle(Tag.ink)
                        Text(subtitle).font(Tag.Typeface.meta).foregroundStyle(Tag.textFaint).lineLimit(1)
                    }
                    Spacer(minLength: 8)
                    if sharing.isSharing {
                        StatusPill(text: "Live", state: .live)
                    }
                }

                if isDenied {
                    Callout(
                        tone: .warning, title: "Location is off for Mero Tag",
                        message: "Allow location access in Settings to share this phone's position.")
                    Button("Open Settings") { Platform.openSettings() }
                        .buttonStyle(.tag(.secondary, fullWidth: true))
                } else if store.myTrackers.isEmpty {
                    Text("Create a tracker on the People tab to share this phone's location.")
                        .font(Tag.Typeface.bodySmall)
                        .foregroundStyle(Tag.textDim)
                } else {
                    HStack(spacing: 8) {
                        Menu {
                            ForEach(store.myTrackers) { tracker in
                                Button {
                                    sharing.start(trackerId: tracker.id)
                                } label: {
                                    if sharing.trackerId == tracker.id {
                                        Label(tracker.name, systemImage: "checkmark")
                                    } else {
                                        Text(tracker.name)
                                    }
                                }
                            }
                        } label: {
                            Label(currentName ?? "Choose tracker", systemImage: "chevron.up.chevron.down")
                                .labelStyle(TrailingIconLabelStyle())
                        }
                        .buttonStyle(.tag(.secondary, fullWidth: true))

                        if sharing.isSharing {
                            Button("Stop") { sharing.stop() }
                                .buttonStyle(.tag(.secondary))
                        } else {
                            Button {
                                if let id = sharing.trackerId ?? store.myTrackers.first?.id {
                                    sharing.start(trackerId: id)
                                }
                            } label: {
                                Label("Share", systemImage: "location.fill")
                            }
                            .buttonStyle(.tagPrimary)
                            .accessibilityIdentifier("startSharingButton")
                        }
                    }
                }
            }
        }
    }

    private var isDenied: Bool { location.authorization == .denied || location.authorization == .restricted }

    private var currentName: String? {
        sharing.trackerId.flatMap { store.tracker(id: $0)?.name }
    }

    private var title: String {
        sharing.isSharing ? "Sharing as \(currentName ?? "a tracker")" : "Not sharing"
    }

    private var subtitle: String {
        if sharing.isSharing {
            if let sent = sharing.lastSentAt {
                return "Last sent \(RelativeTime.string(fromMillis: UInt64(sent.timeIntervalSince1970 * 1000)))"
            }
            return "Waiting for the first fix"
        }
        return "This phone's position stays private"
    }
}

private struct TrailingIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) {
            configuration.title.lineLimit(1)
            configuration.icon.imageScale(.small).foregroundStyle(Tag.textFaint)
        }
    }
}

extension Location {
    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}
