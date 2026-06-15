import SwiftUI
import MeroKit

struct TrackerDetailView: View {
    let tracker: Tracker
    @ObservedObject var store: TrackerStore

    private var presence: Presence? { store.presence[tracker.ownerId] }

    var body: some View {
        List {
            Section("Status") {
                row("Online", (presence?.online ?? false) ? "Yes" : "No")
                if let last = presence?.lastSeen {
                    row("Last seen", Date(timeIntervalSince1970: Double(last) / 1000).formatted())
                }
            }
            if let loc = tracker.latest {
                Section("Latest location") {
                    row("Latitude", String(format: "%.6f", loc.latitude))
                    row("Longitude", String(format: "%.6f", loc.longitude))
                    row("Altitude", String(format: "%.1f m", loc.altitude))
                    row("Speed", String(format: "%.1f m/s", loc.speed))
                    row("Heading", String(format: "%.0f°", loc.heading))
                    row("Battery", "\(loc.battery)%")
                    row("Updated", Date(timeIntervalSince1970: Double(loc.timestamp) / 1000).formatted())
                }
            } else {
                Section { Text("No location reported yet.").foregroundStyle(.secondary) }
            }
            Section("Sharing") {
                Text("Owner: \(tracker.ownerId)").font(.caption)
                Text("Viewers: \(tracker.viewers.isEmpty ? "none" : tracker.viewers.joined(separator: ", "))")
                    .font(.caption)
            }
        }
        .navigationTitle(tracker.name)
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack { Text(label); Spacer(); Text(value).foregroundStyle(.secondary) }
    }
}
