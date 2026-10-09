import MapKit
import SwiftUI

struct TrackerDetailView: View {
    let trackerId: String
    @ObservedObject var store: TrackerStore
    @EnvironmentObject private var sharing: LocationSharing
    @Environment(\.dismiss) private var dismiss

    @State private var renaming = false
    @State private var newName = ""
    @State private var confirmDelete = false
    @State private var showingShare = false

    private var tracker: Tracker? { store.tracker(id: trackerId) }

    var body: some View {
        Group {
            if let tracker {
                content(tracker)
            } else {
                EmptyState(
                    systemImage: "location.slash", title: "Tracker removed",
                    message: "This tracker no longer exists in the space."
                )
                .calPage()
                .padding(.top, 24)
                .frame(maxHeight: .infinity, alignment: .top)
            }
        }
        .background(Cal.bg.ignoresSafeArea())
        .navigationTitle(tracker?.name ?? "Tracker")
        .inlineNavigationTitle()
        .calNavigationBar()
    }

    @ViewBuilder
    private func content(_ tracker: Tracker) -> some View {
        let isMine = tracker.ownerId == store.memberId
        ScrollView {
            VStack(alignment: .leading, spacing: Cal.Space.stack) {
                // Map preview + headline.
                Card(padding: 0) {
                    VStack(alignment: .leading, spacing: 0) {
                        if let loc = tracker.latest {
                            Map(initialPosition: .region(MKCoordinateRegion(
                                center: loc.coordinate,
                                span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01)))) {
                                Annotation(tracker.name, coordinate: loc.coordinate, anchor: .center) {
                                    TrackerPin(name: tracker.name, isLive: isOnline(tracker), isSelected: true)
                                }
                                .annotationTitles(.hidden)
                            }
                            .allowsHitTesting(false)
                            .frame(height: 180)
                            .clipShape(UnevenRoundedRectangle(
                                topLeadingRadius: Cal.Radius.card, topTrailingRadius: Cal.Radius.card))
                            Hairline()
                        }
                        HStack(spacing: 12) {
                            IconTile(systemImage: "location.fill", accent: isOnline(tracker))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(tracker.name).font(Cal.Typeface.h2).foregroundStyle(Cal.ink)
                                Text(updatedText(tracker)).font(Cal.Typeface.meta).foregroundStyle(Cal.textFaint)
                            }
                            Spacer()
                            if isOnline(tracker) {
                                StatusPill(text: "Online", state: .live)
                            } else {
                                StatusPill(text: "Offline", state: .off)
                            }
                        }
                        .padding(Cal.Space.gutter)
                    }
                }

                if let loc = tracker.latest {
                    Card {
                        VStack(alignment: .leading, spacing: 0) {
                            CardHeader(systemImage: "scope", title: "Latest position")
                                .padding(.bottom, 8)
                            KeyValueRow(label: "Coordinates", value: Self.coordinates(loc), monospaced: true)
                            Hairline()
                            KeyValueRow(label: "Altitude", value: String(format: "%.0f m", loc.altitude))
                            Hairline()
                            KeyValueRow(label: "Speed", value: Self.speed(loc.speed))
                            Hairline()
                            KeyValueRow(label: "Heading", value: Self.heading(loc.heading))
                            Hairline()
                            KeyValueRow(label: "Battery", value: "\(loc.battery)%")
                            Hairline()
                            KeyValueRow(
                                label: "Reported",
                                value: Date(timeIntervalSince1970: Double(loc.timestamp) / 1000)
                                    .formatted(date: .abbreviated, time: .shortened))
                        }
                    }
                } else {
                    EmptyState(
                        systemImage: "location.slash", title: "No position yet",
                        message: isMine
                            ? "Start sharing from this phone and the first fix appears here."
                            : "It appears here as soon as \(store.displayName(for: tracker.ownerId)) shares a fix.",
                        compact: true)
                }

                if isMine {
                    Card {
                        VStack(alignment: .leading, spacing: 14) {
                            CardHeader(
                                systemImage: "dot.radiowaves.left.and.right",
                                title: "This phone",
                                meta: sharingHere(tracker) ? "Reporting its location as this tracker" : "Not reporting",
                                accent: sharingHere(tracker))
                            Button {
                                sharing.toggle(trackerId: tracker.id)
                            } label: {
                                Label(
                                    sharingHere(tracker) ? "Stop sharing" : "Share from this phone",
                                    systemImage: sharingHere(tracker) ? "stop.fill" : "location.fill")
                            }
                            .buttonStyle(.cal(sharingHere(tracker) ? .secondary : .primary, fullWidth: true))
                        }
                    }
                }

                // Who can see it.
                Card {
                    VStack(alignment: .leading, spacing: 12) {
                        CardHeader(
                            systemImage: "person.2", title: "Who can see it",
                            meta: viewersMeta(tracker)
                        ) {
                            if isMine {
                                Button {
                                    showingShare = true
                                } label: {
                                    Label("Share", systemImage: "person.badge.plus")
                                }
                                .buttonStyle(.cal(.secondary, size: .small))
                                .accessibilityIdentifier("shareTrackerButton")
                            }
                        }
                        PersonLine(
                            name: store.displayName(for: tracker.ownerId), seed: tracker.ownerId,
                            caption: "Owner", isMe: isMine)
                        ForEach(tracker.viewers, id: \.self) { viewer in
                            PersonLine(
                                name: store.displayName(for: viewer), seed: viewer, caption: "Can view",
                                isMe: viewer == store.memberId,
                                onRemove: isMine ? { Task { await store.unshare(trackerId: tracker.id, from: viewer) } } : nil)
                        }
                        TechnicalDetails(items: [
                            DetailItem(label: "Tracker ID", value: tracker.id),
                            DetailItem(label: "Owner account", value: tracker.ownerId),
                        ] + tracker.viewers.map { DetailItem(label: "Viewer account", value: $0) })
                    }
                }

                if isMine {
                    HStack(spacing: 8) {
                        Button {
                            newName = tracker.name
                            renaming = true
                        } label: {
                            Label("Rename", systemImage: "pencil")
                        }
                        .buttonStyle(.cal(.secondary, fullWidth: true))

                        Button {
                            confirmDelete = true
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                        .buttonStyle(.cal(.danger, fullWidth: true))
                    }
                }
            }
            .calPage()
            .padding(.top, 8)
        }
        .refreshable { await store.refresh() }
        .alert("Rename tracker", isPresented: $renaming) {
            TextField("Name", text: $newName)
            Button("Save") {
                let name = newName.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !name.isEmpty else { return }
                Task { await store.renameTracker(id: tracker.id, name: name) }
            }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog("Delete \(tracker.name)?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete tracker", role: .destructive) {
                if sharing.trackerId == tracker.id { sharing.stop() }
                Task {
                    if await store.deleteTracker(id: tracker.id) { dismiss() }
                }
            }
        } message: {
            Text("Everyone it's shared with stops seeing it. Its history is removed.")
        }
        .sheet(isPresented: $showingShare) {
            ShareTrackerSheet(tracker: tracker, store: store)
        }
    }

    private func isOnline(_ tracker: Tracker) -> Bool { store.isOnline(tracker.ownerId) }
    private func sharingHere(_ tracker: Tracker) -> Bool { sharing.isSharing && sharing.trackerId == tracker.id }

    private func updatedText(_ tracker: Tracker) -> String {
        guard let loc = tracker.latest else { return "No position yet" }
        return "Updated \(RelativeTime.string(fromMillis: loc.timestamp))"
    }

    private func viewersMeta(_ tracker: Tracker) -> String {
        tracker.viewers.isEmpty
            ? "Only the owner"
            : "Owner and \(tracker.viewers.count) \(tracker.viewers.count == 1 ? "member" : "members")"
    }

    static func coordinates(_ loc: Location) -> String {
        String(format: "%.5f, %.5f", loc.latitude, loc.longitude)
    }

    static func speed(_ metersPerSecond: Double) -> String {
        Measurement(value: metersPerSecond, unit: UnitSpeed.metersPerSecond)
            .converted(to: .kilometersPerHour)
            .formatted(.measurement(width: .abbreviated, numberFormatStyle: .number.precision(.fractionLength(0))))
    }

    static func heading(_ degrees: Double) -> String {
        let points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
        let index = Int((degrees.truncatingRemainder(dividingBy: 360) + 22.5) / 45) % 8
        return "\(Int(degrees.rounded()))° \(points[max(0, index)])"
    }
}

private struct PersonLine: View {
    let name: String
    let seed: String
    let caption: String
    var isMe = false
    var onRemove: (() -> Void)?

    var body: some View {
        HStack(spacing: 10) {
            Avatar(name: name, seed: seed, size: 28, isMe: isMe)
            Text(name).font(Cal.Typeface.bodySmall).foregroundStyle(Cal.ink).lineLimit(1)
            Spacer()
            Text(caption).font(Cal.Typeface.meta).foregroundStyle(Cal.textFaint)
            if let onRemove {
                IconButton(systemImage: "xmark", label: "Stop sharing with \(name)", action: onRemove)
            }
        }
        .frame(minHeight: 34)
    }
}

/// Pick members to share a tracker with.
private struct ShareTrackerSheet: View {
    let tracker: Tracker
    @ObservedObject var store: TrackerStore
    @Environment(\.dismiss) private var dismiss
    @State private var working: String?

    private var candidates: [Member] {
        store.members.filter { $0.id != tracker.ownerId }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Cal.Space.stack) {
                    Text("Members you add see \(tracker.name) on their map, live.")
                        .font(Cal.Typeface.bodySmall)
                        .foregroundStyle(Cal.textDim)

                    if candidates.isEmpty {
                        EmptyState(
                            systemImage: "person.badge.plus", title: "No one else here yet",
                            message: "Invite people to this space first; they show up here once they join.",
                            compact: true)
                    } else {
                        Card(padding: 0) {
                            VStack(spacing: 0) {
                                ForEach(Array(candidates.enumerated()), id: \.element.id) { index, member in
                                    if index > 0 { Hairline().padding(.leading, 60) }
                                    row(member)
                                }
                            }
                        }
                    }
                    if let error = store.lastError { Callout(tone: .danger, message: error) }
                }
                .padding(Cal.Space.gutter)
            }
            .background(Cal.bg.ignoresSafeArea())
            .navigationTitle("Share tracker")
            .inlineNavigationTitle()
            .calNavigationBar()
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.fontWeight(.semibold).foregroundStyle(Cal.ink)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func row(_ member: Member) -> some View {
        let shared = store.tracker(id: tracker.id)?.viewers.contains(member.id) ?? false
        return Button {
            working = member.id
            Task {
                if shared {
                    await store.unshare(trackerId: tracker.id, from: member.id)
                } else {
                    await store.share(trackerId: tracker.id, with: member.id)
                }
                working = nil
            }
        } label: {
            ListRow(title: member.username, subtitle: shared ? "Can view" : "Can't view", showsChevron: false) {
                Avatar(name: member.username, seed: member.id, size: 34)
            } trailing: {
                if working == member.id {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: shared ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 20))
                        .foregroundStyle(shared ? Cal.accentInk : Cal.borderStrong)
                }
            }
        }
        .buttonStyle(RowButtonStyle())
        .disabled(working != nil)
        .accessibilityValue(shared ? "shared" : "not shared")
    }
}
