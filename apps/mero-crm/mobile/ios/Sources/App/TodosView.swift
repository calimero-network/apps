import CrmCore
import SwiftUI

/// The to-do list: every call, meeting and task across the pipeline, grouped by
/// when it is due. Overdue first, because that is the list that loses deals.
struct TodosView: View {
    @EnvironmentObject private var model: PipelineModel
    @State private var kind: ActivityKind?
    @State private var mine = false
    @State private var query = ""
    @State private var creating = false

    var body: some View {
        LoadGate {
            let list = model.activities
                .filter { kind == nil || $0.kind == kind!.rawValue }
                .filter { !mine || model.isMe($0.owner) }
                .filter { Insights.activityMatches($0, query) }
            let buckets = Insights.buckets(list, now: model.now(), model.calendar)
            List {
                Section {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            Chip(title: "All", selected: kind == nil) { kind = nil }
                            ForEach(ActivityKind.allCases) { k in
                                Chip(title: k.label, icon: Icons.kind(k.rawValue), selected: kind == k) { kind = k }
                            }
                        }
                        .padding(.vertical, 2)
                    }
                    .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    HStack(spacing: 4) {
                        Text("\(buckets[.overdue]?.count ?? 0)").fontWeight(.bold)
                            .foregroundStyle((buckets[.overdue]?.isEmpty ?? true) ? Palette.ink : Palette.danger)
                        Text("overdue ·")
                        Text("\(buckets[.today]?.count ?? 0)").fontWeight(.bold).foregroundStyle(Palette.ink)
                        Text("today ·")
                        Text("\(buckets[.upcoming]?.count ?? 0)").fontWeight(.bold).foregroundStyle(Palette.ink)
                        Text("upcoming")
                    }
                    .font(.footnote)
                    .foregroundStyle(Palette.ink2)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }
                if list.isEmpty {
                    EmptyState(
                        icon: "checklist", title: "No activities",
                        message: "Schedule one with the + button, or from a deal. Automations can schedule them for you.")
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                } else {
                    ForEach(ActivityBucket.allCases, id: \.self) { bucket in
                        let items = bucket == .done ? Array((buckets[bucket] ?? []).prefix(20)) : (buckets[bucket] ?? [])
                        if !items.isEmpty || bucket.emptyText != nil {
                            Section {
                                if items.isEmpty {
                                    Text(bucket.emptyText ?? "").font(.footnote).foregroundStyle(Palette.ink3)
                                        .listRowBackground(Palette.surface)
                                }
                                ForEach(items) { a in
                                    ActivityRowView(activity: a, showDeal: true)
                                        .listRowBackground(Palette.surface)
                                        .swipeActions(edge: .leading) {
                                            Button {
                                                Task { await model.setDone(a, !a.done) }
                                            } label: {
                                                Label(a.done ? "Not done" : "Done", systemImage: a.done ? "arrow.uturn.backward" : "checkmark")
                                            }
                                            .tint(Palette.good)
                                        }
                                        .swipeActions(edge: .trailing) {
                                            Button(role: .destructive) {
                                                Task { await model.deleteActivity(a) }
                                            } label: {
                                                Label("Delete", systemImage: "trash")
                                            }
                                            if !a.done {
                                                Button {
                                                    Task { await model.snooze(a) }
                                                } label: {
                                                    Label("Tomorrow", systemImage: "sunrise")
                                                }
                                                .tint(Palette.ink2)
                                            }
                                        }
                                }
                            } header: {
                                Text("\(bucket.title) · \(items.count)")
                                    .font(.footnote.weight(.semibold))
                                    .foregroundStyle(bucket == .overdue ? Palette.danger : Palette.ink2)
                            }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .refreshable { await model.load() }
        }
        .screenBackground()
        .navigationTitle("To-dos")
        .searchable(text: $query, prompt: "Search to-dos")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Menu {
                    Toggle("Only mine", isOn: $mine)
                } label: {
                    Image(systemName: "line.3.horizontal.decrease.circle")
                }
                .accessibilityLabel("Filter")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { creating = true } label: { Image(systemName: "plus") }
                    .accessibilityLabel("Schedule an activity")
            }
        }
        .sheet(isPresented: $creating) {
            ActivitySheet(dealId: nil) { creating = false }.environmentObject(model)
        }
    }
}

/// One activity: tick it off, see what and when, snooze or delete it.
struct ActivityRowView: View {
    let activity: ActivityView
    let showDeal: Bool
    @EnvironmentObject private var model: PipelineModel

    var body: some View {
        let a = activity
        HStack(alignment: .top, spacing: 12) {
            Button {
                Haptics.tap()
                Task { await model.setDone(a, !a.done) }
            } label: {
                Image(systemName: a.done ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(a.done ? Palette.good : Palette.ink3)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(a.done ? "Mark “\(a.subject)” not done" : "Mark “\(a.subject)” done")
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Image(systemName: Icons.kind(a.kind)).font(.footnote).foregroundStyle(Palette.ink2)
                    Text(a.subject).font(.subheadline.weight(.medium))
                        .foregroundStyle(a.done ? Palette.ink3 : Palette.ink)
                        .strikethrough(a.done)
                }
                if !a.note.isEmpty && !showDeal {
                    Text(a.note).font(.footnote).foregroundStyle(Palette.ink2).lineLimit(3)
                }
                HStack(spacing: 6) {
                    if a.done {
                        Text("Done \(Days.ago(Days.date(a.doneAt ?? 0), now: model.now(), model.calendar))")
                            .font(.caption).foregroundStyle(Palette.ink3)
                    } else {
                        DueChip(kind: a.kind, dueAt: a.dueAt)
                    }
                    if a.automationId != nil { Pill(text: "Auto", icon: "bolt") }
                    if showDeal {
                        Text(meta).font(.caption).foregroundStyle(Palette.ink2).lineLimit(1)
                    }
                }
            }
            Spacer(minLength: 0)
            Menu {
                if showDeal, let dealId = a.dealId {
                    NavigationLink(value: Route.deal(dealId)) { Label("Open deal", systemImage: "arrow.up.right") }
                }
                if !a.done {
                    Button { Task { await model.snooze(a) } } label: { Label("Tomorrow", systemImage: "sunrise") }
                }
                Button(role: .destructive) { Task { await model.deleteActivity(a) } } label: {
                    Label("Delete", systemImage: "trash")
                }
            } label: {
                Image(systemName: "ellipsis").font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink3)
                    .frame(width: 32, height: 32)
            }
            .accessibilityLabel("More for “\(a.subject)”")
        }
        .padding(.vertical, 4)
    }

    private var meta: String {
        let deal = activity.dealTitle ?? "No deal"
        let owner = (activity.owner ?? "").isEmpty ? "" : " · \(model.ownerLabel(activity.owner))"
        return deal + owner
    }
}
