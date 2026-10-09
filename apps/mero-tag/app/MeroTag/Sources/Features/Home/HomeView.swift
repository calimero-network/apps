import SwiftUI

struct HomeView: View {
    @ObservedObject var store: TrackerStore
    @EnvironmentObject private var sharing: LocationSharing
    @State private var showingNew = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Cal.Space.stack) {
                    PageHeader(title: "Trackers", subtitle: subtitle) {
                        ConnectionPill(connection: store.connection)
                    }

                    if let error = store.lastError {
                        Callout(tone: .danger, message: error)
                            .accessibilityIdentifier("storeError")
                    }

                    if !store.hasLoaded {
                        Card { HStack { Spacer(); ProgressView().tint(Cal.textFaint); Spacer() } }
                    } else if store.trackers.isEmpty {
                        EmptyState(
                            systemImage: "location.slash",
                            title: "No trackers yet",
                            message: "Create a tracker for this phone, then share it with the people who should "
                                + "see where it is."
                        ) {
                            Button {
                                showingNew = true
                            } label: {
                                Label("New tracker", systemImage: "plus")
                            }
                            .buttonStyle(.calPrimary)
                        }
                    } else {
                        Card(padding: 0) {
                            VStack(spacing: 0) {
                                ForEach(Array(store.trackers.enumerated()), id: \.element.id) { index, tracker in
                                    if index > 0 { Hairline().padding(.leading, 62) }
                                    NavigationLink(value: tracker.id) {
                                        TrackerRow(
                                            tracker: tracker,
                                            owner: store.displayName(for: tracker.ownerId),
                                            isMine: tracker.ownerId == store.memberId,
                                            isSharingHere: sharing.isSharing && sharing.trackerId == tracker.id)
                                    }
                                    .buttonStyle(RowButtonStyle())
                                    .accessibilityIdentifier("trackerRow")
                                }
                            }
                        }
                    }
                }
                .calPage()
            }
            .background(Cal.bg.ignoresSafeArea())
            .refreshable { await store.refresh() }
            .navigationDestination(for: String.self) { id in
                TrackerDetailView(trackerId: id, store: store)
            }
            .toolbar {
                ToolbarItem(placement: .calLeading) { BrandTitle() }
                ToolbarItem(placement: .calTrailing) {
                    IconButton(systemImage: "plus", label: "New tracker") { showingNew = true }
                        .accessibilityIdentifier("newTrackerButton")
                }
            }
            .inlineNavigationTitle()
            .calNavigationBar()
            .sheet(isPresented: $showingNew) {
                NewTrackerSheet(store: store)
            }
        }
    }

    private var subtitle: String {
        let count = store.trackers.count
        let members = store.space?.memberCount ?? store.members.count
        return "\(count) \(count == 1 ? "tracker" : "trackers") · \(members) \(members == 1 ? "member" : "members")"
    }
}

private struct TrackerRow: View {
    let tracker: Tracker
    let owner: String
    let isMine: Bool
    let isSharingHere: Bool

    var body: some View {
        ListRow(title: tracker.name, subtitle: subtitle) {
            IconTile(systemImage: tracker.latest == nil ? "location.slash" : "location.fill", accent: isSharingHere)
        } trailing: {
            if isSharingHere {
                Badge(text: "Live", tone: .accent, dot: true)
            } else if let battery = tracker.latest?.battery {
                Badge(text: "\(battery)%", tone: battery <= 20 ? .warning : .neutral, systemImage: BatteryIcon.name(battery))
            }
        }
    }

    private var subtitle: String {
        let who = isMine ? "Yours" : owner
        guard let loc = tracker.latest else { return "\(who) · No location yet" }
        return "\(who) · Updated \(RelativeTime.string(fromMillis: loc.timestamp))"
    }
}

enum BatteryIcon {
    static func name(_ percent: Int) -> String {
        switch percent {
        case ..<13: return "battery.0percent"
        case ..<38: return "battery.25percent"
        case ..<63: return "battery.50percent"
        case ..<88: return "battery.75percent"
        default: return "battery.100percent"
        }
    }
}

/// Name a new tracker.
struct NewTrackerSheet: View {
    @ObservedObject var store: TrackerStore
    @EnvironmentObject private var sharing: LocationSharing
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var shareFromThisPhone = true
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    CalTextField(
                        label: "Name", placeholder: "e.g. My iPhone", text: $name,
                        help: "Members you share it with see this name on their map.",
                        submitLabel: .done, onSubmit: save)
                        .accessibilityIdentifier("trackerNameField")

                    Toggle(isOn: $shareFromThisPhone) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Report this phone's location").font(Cal.Typeface.section).foregroundStyle(Cal.ink)
                            Text("You can stop any time from the Map tab.")
                                .font(Cal.Typeface.meta).foregroundStyle(Cal.textFaint)
                        }
                    }
                    .tint(Cal.accentInk)

                    if let error = store.lastError, !isSaving {
                        Callout(tone: .danger, message: error)
                    }

                    LoadingButton(title: "Create tracker", systemImage: "plus", isLoading: isSaving, action: save)
                        .disabled(trimmed.isEmpty)
                        .accessibilityIdentifier("createTrackerButton")
                }
                .padding(Cal.Space.gutter)
            }
            .background(Cal.bg.ignoresSafeArea())
            .navigationTitle("New tracker")
            .inlineNavigationTitle()
            .calNavigationBar()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.foregroundStyle(Cal.textDim)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    private func save() {
        guard !trimmed.isEmpty, !isSaving else { return }
        isSaving = true
        Task {
            let before = Set(store.trackers.map(\.id))
            let ok = await store.createTracker(name: trimmed)
            isSaving = false
            guard ok else { return }
            if shareFromThisPhone,
               let created = store.trackers.first(where: { !before.contains($0.id) && $0.ownerId == store.memberId }) {
                sharing.start(trackerId: created.id)
            }
            Platform.success()
            dismiss()
        }
    }
}
