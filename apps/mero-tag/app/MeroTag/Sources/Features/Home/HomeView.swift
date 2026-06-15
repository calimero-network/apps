import SwiftUI
import MeroKit

struct HomeView: View {
    @EnvironmentObject private var app: AppState
    @State private var showingNew = false
    @State private var newName = ""

    var body: some View {
        NavigationStack {
            Group {
                if let store = app.store {
                    TrackerList(store: store)
                } else {
                    ProgressView("Connecting…")
                }
            }
            .navigationTitle("Trackers")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { showingNew = true } label: { Image(systemName: "plus") }
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Log out") { app.logout() }
                }
            }
            .alert("New tracker", isPresented: $showingNew) {
                TextField("Name", text: $newName)
                Button("Create") {
                    let name = newName.trimmingCharacters(in: .whitespaces)
                    newName = ""
                    guard !name.isEmpty else { return }
                    Task { await app.store?.createTracker(name: name) }
                }
                Button("Cancel", role: .cancel) { newName = "" }
            }
        }
    }
}

private struct TrackerList: View {
    @ObservedObject var store: TrackerStore

    var body: some View {
        List {
            if let space = store.space {
                Section { Text("\(space.trackerCount) trackers · \(space.memberCount) members") }
            }
            ForEach(store.trackers) { tracker in
                NavigationLink(value: tracker) {
                    TrackerRow(tracker: tracker, presence: store.presence[tracker.ownerId])
                }
            }
        }
        .refreshable { await store.refresh() }
        .navigationDestination(for: Tracker.self) { TrackerDetailView(tracker: $0, store: store) }
        .overlay {
            if store.trackers.isEmpty {
                ContentUnavailableView("No trackers yet", systemImage: "location.slash",
                                       description: Text("Tap + to create one."))
            }
        }
    }
}

private struct TrackerRow: View {
    let tracker: Tracker
    let presence: Presence?

    var body: some View {
        HStack {
            Circle()
                .fill((presence?.online ?? false) ? .green : .gray)
                .frame(width: 10, height: 10)
            VStack(alignment: .leading) {
                Text(tracker.name).font(.headline)
                if let loc = tracker.latest {
                    Text(String(format: "%.5f, %.5f", loc.latitude, loc.longitude))
                        .font(.caption).foregroundStyle(.secondary)
                } else {
                    Text("No location yet").font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            if let b = tracker.latest?.battery {
                Label("\(b)%", systemImage: "battery.100")
                    .font(.caption).labelStyle(.titleAndIcon)
            }
        }
    }
}
