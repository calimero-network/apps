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
        NavigationStack {
            Map(position: $camera, selection: $selectedId) {
                UserAnnotation()
                ForEach(located, id: \.0.id) { tracker, loc in
                    Annotation(tracker.name, coordinate: loc.coordinate, anchor: .bottom) {
                        TrackerPin(
                            name: tracker.name,
                            isLive: store.isOnline(tracker.ownerId),
                            isSelected: selectedId == tracker.id)
                    }
                    .annotationTitles(.hidden)
                    .tag(tracker.id)
                }
            }
            .mapStyle(.standard(pointsOfInterest: .excludingAll))
            .mapControls {
                MapUserLocationButton()
                MapCompass()
                MapScaleView()
            }
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 10) {
                    if let id = selectedId, let tracker = store.tracker(id: id) {
                        SelectedTrackerCard(tracker: tracker, store: store) { selectedId = nil }
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                    SharingPanel(store: store, location: sharing.location)
                }
                .padding(.horizontal, Cal.Space.gutter)
                .padding(.bottom, 10)
                .animation(.easeOut(duration: 0.2), value: selectedId)
            }
            .overlay(alignment: .top) {
                if located.isEmpty && store.hasLoaded {
                    Callout(tone: .info, message: "No tracker has reported a position yet.")
                        .padding(.horizontal, Cal.Space.gutter)
                        .padding(.top, 8)
                }
            }
            .toolbar {
                ToolbarItem(placement: .calLeading) { BrandTitle() }
                ToolbarItem(placement: .calTrailing) {
                    IconButton(systemImage: "scope", label: "Show all trackers") {
                        withAnimation { camera = .automatic }
                    }
                }
            }
            .inlineNavigationTitle()
            .calNavigationBar()
        }
    }
}

/// A tracker on the map: white disc with a hairline and a lime (live) or
/// grey (offline) core, plus a name label. Selected pins grow.
struct TrackerPin: View {
    let name: String
    let isLive: Bool
    var isSelected = false

    var body: some View {
        VStack(spacing: 4) {
            ZStack {
                if isLive {
                    Circle()
                        .fill(Cal.lime.opacity(0.28))
                        .frame(width: isSelected ? 52 : 42, height: isSelected ? 52 : 42)
                }
                Circle()
                    .fill(Cal.surface)
                    .frame(width: isSelected ? 38 : 32, height: isSelected ? 38 : 32)
                    .overlay(Circle().strokeBorder(Cal.border, lineWidth: 1))
                    .shadow(color: Color.black.opacity(0.18), radius: 4, y: 2)
                Circle()
                    .fill(isLive ? Cal.lime : Cal.bgSubtle)
                    .frame(width: isSelected ? 28 : 24, height: isSelected ? 28 : 24)
                    .overlay(Circle().strokeBorder(Cal.limeEdge, lineWidth: 1))
                Image(systemName: "location.fill")
                    .font(.system(size: isSelected ? 12 : 10, weight: .bold))
                    .foregroundStyle(isLive ? Cal.onLime : Cal.textDim)
            }
            Text(name)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Cal.ink)
                .lineLimit(1)
                .padding(.horizontal, 8)
                .frame(height: 22)
                .background(Capsule().fill(Cal.surface))
                .overlay(Capsule().strokeBorder(Cal.border, lineWidth: 1))
                .shadow(color: Color.black.opacity(0.08), radius: 2, y: 1)
        }
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isSelected)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(name), \(isLive ? "online" : "offline")")
    }
}

private struct SelectedTrackerCard: View {
    let tracker: Tracker
    @ObservedObject var store: TrackerStore
    let onClose: () -> Void

    var body: some View {
        Card(padding: 14) {
            HStack(spacing: 12) {
                Avatar(name: tracker.name, seed: tracker.id, size: 36)
                VStack(alignment: .leading, spacing: 2) {
                    Text(tracker.name).font(Cal.Typeface.section).foregroundStyle(Cal.ink)
                    Text(meta).font(Cal.Typeface.meta).foregroundStyle(Cal.textFaint).lineLimit(1)
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
        Card(padding: 14) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    IconTile(
                        systemImage: sharing.isSharing ? "location.fill" : "location.slash",
                        accent: sharing.isSharing)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title).font(Cal.Typeface.section).foregroundStyle(Cal.ink)
                        Text(subtitle).font(Cal.Typeface.meta).foregroundStyle(Cal.textFaint).lineLimit(1)
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
                        .buttonStyle(.cal(.secondary, fullWidth: true))
                } else if store.myTrackers.isEmpty {
                    Text("Create a tracker on the Trackers tab to share this phone's location.")
                        .font(Cal.Typeface.bodySmall)
                        .foregroundStyle(Cal.textDim)
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
                        .buttonStyle(.cal(.secondary, fullWidth: true))

                        if sharing.isSharing {
                            Button("Stop") { sharing.stop() }
                                .buttonStyle(.cal(.secondary))
                        } else {
                            Button {
                                if let id = sharing.trackerId ?? store.myTrackers.first?.id {
                                    sharing.start(trackerId: id)
                                }
                            } label: {
                                Label("Share", systemImage: "location.fill")
                            }
                            .buttonStyle(.calPrimary)
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
            configuration.icon.imageScale(.small).foregroundStyle(Cal.textFaint)
        }
    }
}

extension Location {
    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}
