import CrmCore
import SwiftUI

enum DealStatusFilter: String, CaseIterable, Identifiable {
    case open, won, lost, all
    var id: String { rawValue }
    var title: String { rawValue.prefix(1).uppercased() + rawValue.dropFirst() }
}

enum DealSort: String, CaseIterable, Identifiable {
    case created, value, close, health
    var id: String { rawValue }
    var title: String {
        switch self {
        case .created: return "Newest"
        case .value: return "Value"
        case .close: return "Expected close"
        case .health: return "Health"
        }
    }
}

/// Every deal as a list: for when the board is too visual.
struct DealsView: View {
    @EnvironmentObject private var model: PipelineModel
    @State private var status: DealStatusFilter = .open
    @State private var sort: DealSort = .created
    @State private var mine = false
    @State private var query = ""
    @State private var creating = false
    @State private var acting: DealView?

    var body: some View {
        LoadGate {
            let rows = self.rows
            List {
                Section {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(DealStatusFilter.allCases) { f in
                                Chip(title: f.title, count: count(f), selected: status == f) { status = f }
                            }
                        }
                        .padding(.vertical, 2)
                    }
                    .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    HStack {
                        Text("\(rows.count) deals · \(Money.format(rows.reduce(0) { $0 + $1.value }, currency: model.currency))")
                            .font(.footnote.weight(.semibold)).foregroundStyle(Palette.ink2)
                        Spacer()
                    }
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }
                if rows.isEmpty {
                    EmptyState(
                        icon: "list.bullet.rectangle",
                        title: query.isEmpty ? "No \(status == .all ? "" : status.rawValue + " ")deals" : "No deals match “\(query)”",
                        message: status == .open ? "Add one with the + button." : nil)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                } else {
                    Section {
                        ForEach(rows) { deal in
                            NavigationLink(value: Route.deal(deal.id)) { DealRow(deal: deal) }
                                .listRowBackground(Palette.surface)
                                .swipeActions(edge: .trailing) {
                                    if deal.status == "open" {
                                        Button { acting = deal } label: { Label("Move", systemImage: "arrow.right.circle") }
                                            .tint(Palette.ink2)
                                    }
                                }
                                .contextMenu {
                                    if deal.status == "open" {
                                        Button { acting = deal } label: { Label("Move to stage…", systemImage: "arrow.right.circle") }
                                    }
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
        .navigationTitle("Deals")
        .searchable(text: $query, prompt: "Search deals")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Menu {
                    Picker("Sort by", selection: $sort) {
                        ForEach(DealSort.allCases) { Text($0.title).tag($0) }
                    }
                    Toggle("Only mine", isOn: $mine)
                } label: {
                    Image(systemName: "line.3.horizontal.decrease.circle")
                }
                .accessibilityLabel("Sort and filter")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { creating = true } label: { Image(systemName: "plus") }
                    .accessibilityLabel("New deal")
                    .disabled(model.stages.isEmpty)
            }
        }
        .sheet(isPresented: $creating) {
            DealEditorSheet { _ in creating = false }.environmentObject(model)
        }
        .sheet(item: $acting) { deal in
            DealActionsSheet(deal: deal).environmentObject(model)
        }
    }

    private func count(_ f: DealStatusFilter) -> Int {
        f == .all ? model.deals.count : model.deals.filter { $0.status == f.rawValue }.count
    }

    private var rows: [DealView] {
        let list = model.deals
            .filter { status == .all || $0.status == status.rawValue }
            .filter { !mine || model.isMe($0.owner) }
            .filter { Insights.dealMatches($0, query, ownerLabel: model.ownerLabel) }
        switch sort {
        case .created: return list.sorted { $0.createdAt > $1.createdAt }
        case .value: return list.sorted { $0.value > $1.value }
        case .close: return list.sorted { ($0.expectedClose ?? .max) < ($1.expectedClose ?? .max) }
        case .health: return list.sorted { model.health($0).score < model.health($1).score }
        }
    }
}

/// A deal in a list.
struct DealRow: View {
    let deal: DealView
    @EnvironmentObject private var model: PipelineModel

    var body: some View {
        let health = model.health(deal)
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                if deal.status == "open" { HealthDot(health: health) }
                Text(deal.title).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink).lineLimit(2)
                Spacer()
                Text(Money.format(deal.value, currency: model.currency)).font(.subheadline.weight(.bold)).foregroundStyle(Palette.ink)
            }
            let who = [deal.organization, deal.contactName ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")
            if !who.isEmpty { Text(who).font(.footnote).foregroundStyle(Palette.ink2).lineLimit(1) }
            HStack(spacing: 6) {
                if deal.status == "open" {
                    Pill(text: model.stage(deal.stageId)?.name ?? "—")
                    if let next = deal.nextActivity {
                        DueChip(kind: next.kind, dueAt: next.dueAt)
                    } else {
                        Pill(text: "No next step", fg: Palette.warn, bg: Palette.warnSoft)
                    }
                } else {
                    StatusPill(status: deal.status)
                    if !deal.lostReason.isEmpty { Text(deal.lostReason).font(.caption).foregroundStyle(Palette.ink2).lineLimit(1) }
                }
                Spacer()
                if let close = deal.expectedClose {
                    let late = deal.status == "open" && Days.date(close) < model.calendar.startOfDay(for: model.now())
                    Text(Days.short(Days.date(close), model.calendar, now: model.now())).font(.caption)
                        .foregroundStyle(late ? Palette.danger : Palette.ink3)
                }
            }
        }
        .padding(.vertical, 4)
    }
}
