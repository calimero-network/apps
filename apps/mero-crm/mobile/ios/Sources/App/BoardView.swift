import CrmCore
import SwiftUI

/// The board: one swipeable column per stage, with its count, total and win
/// probability, and one card per open deal. A card's menu moves it or closes it.
struct BoardView: View {
    let onSwitch: () -> Void
    @EnvironmentObject private var model: PipelineModel
    @State private var page = ""
    @State private var newDealStage: String?
    @State private var acting: DealView?

    var body: some View {
        LoadGate {
            if model.stages.isEmpty {
                ScrollView {
                    Card {
                        EmptyState(
                            icon: "rectangle.split.3x1", title: "No stages yet",
                            message: "Add the columns of your pipeline in More → Stages.")
                    }
                    .padding(16)
                }
            } else {
                VStack(spacing: 0) {
                    summary
                    stageTabs
                    TabView(selection: $page) {
                        ForEach(Array(model.stages.enumerated()), id: \.element.id) { index, stage in
                            StageColumn(stage: stage, index: index, onAdd: { newDealStage = stage.id }, onAct: { acting = $0 })
                                .tag(stage.id)
                        }
                    }
                    .tabViewStyle(.page(indexDisplayMode: .never))
                }
            }
        }
        .screenBackground()
        .navigationTitle(model.pipeline.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button(action: onSwitch) { Image(systemName: "square.grid.2x2") }
                    .accessibilityLabel("Workspaces")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    newDealStage = currentStage
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("New deal")
                .disabled(model.stages.isEmpty)
            }
        }
        .onChange(of: model.stages.map(\.id)) { ids in
            if !ids.contains(page) { page = ids.first ?? "" }
        }
        .onAppear { if page.isEmpty { page = model.stages.first?.id ?? "" } }
        .sheet(item: Binding(get: { newDealStage.map(StageChoice.init) }, set: { newDealStage = $0?.id })) { choice in
            DealEditorSheet(initial: Self.draft(stage: choice.id)) { _ in newDealStage = nil }
                .environmentObject(model)
        }
        .sheet(item: $acting) { deal in
            DealActionsSheet(deal: deal).environmentObject(model)
        }
    }

    static func draft(stage: String) -> DealDraft {
        var draft = DealDraft()
        draft.stageId = stage
        return draft
    }

    private var currentStage: String { page.isEmpty ? (model.stages.first?.id ?? "") : page }

    private var summary: some View {
        let open = model.openDeals
        let total = open.reduce(UInt64(0)) { $0 + $1.value }
        let weighted = open.reduce(UInt64(0)) { $0 + Insights.weighted($1) }
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                StatPill(value: "\(open.count)", label: "open deals")
                StatPill(value: Money.format(total, currency: model.currency), label: "in pipeline")
                StatPill(value: Money.format(weighted, currency: model.currency), label: "weighted")
            }
            .padding(.horizontal, 16)
            .padding(.top, 10)
        }
    }

    private var stageTabs: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Array(model.stages.enumerated()), id: \.element.id) { index, stage in
                        Chip(title: stage.name, count: model.openDeals(in: stage.id).count, selected: stage.id == currentStage) {
                            withAnimation { page = stage.id }
                        }
                        .accessibilityIdentifier("board.stage.\(index)")
                        .id(stage.id)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
            }
            .onChange(of: page) { id in withAnimation { proxy.scrollTo(id, anchor: .center) } }
        }
    }
}

private struct StageChoice: Identifiable {
    let id: String
}

struct StatPill: View {
    let value: String
    let label: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            Text(value).font(.subheadline.weight(.bold)).foregroundStyle(Palette.ink)
            Text(label).font(.footnote).foregroundStyle(Palette.ink2)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(Palette.surface, in: Capsule())
        .overlay(Capsule().strokeBorder(Palette.hairline, lineWidth: 0.5))
    }
}

/// One stage: its header and its open deals.
private struct StageColumn: View {
    let stage: StageView
    let index: Int
    let onAdd: () -> Void
    let onAct: (DealView) -> Void
    @EnvironmentObject private var model: PipelineModel

    var body: some View {
        let cards = model.openDeals(in: stage.id)
        let total = cards.reduce(UInt64(0)) { $0 + $1.value }
        ScrollView {
            VStack(spacing: 10) {
                Card(spacing: 8) {
                    HStack(spacing: 8) {
                        Text(stage.name).font(.headline).foregroundStyle(Palette.ink).lineLimit(1)
                        Pill(text: "\(cards.count)")
                        Spacer()
                        Button(action: onAdd) {
                            Image(systemName: "plus").font(.footnote.weight(.bold)).foregroundStyle(Palette.ink)
                                .frame(width: 30, height: 30)
                                .background(Palette.lime, in: Circle())
                        }
                        .accessibilityLabel("Add deal to \(stage.name)")
                    }
                    HStack(alignment: .firstTextBaseline) {
                        Text(Money.format(total, currency: model.currency, compact: true))
                            .font(.title3.weight(.bold)).foregroundStyle(Palette.ink)
                        Spacer()
                        Text("\(stage.probability)% win").font(.footnote.weight(.semibold)).foregroundStyle(Palette.ink3)
                    }
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Palette.sunken)
                            Capsule().fill(Palette.lime).frame(width: geo.size.width * CGFloat(stage.probability) / 100)
                        }
                    }
                    .frame(height: 4)
                }
                ForEach(Array(cards.enumerated()), id: \.element.id) { n, deal in
                    DealCard(deal: deal, id: "board.card.\(index).\(n)", onAct: { onAct(deal) })
                }
                if cards.isEmpty {
                    Button(action: onAdd) {
                        VStack(spacing: 6) {
                            Image(systemName: "plus.circle").font(.title3)
                            Text("No deals in this stage. Add one.").font(.subheadline)
                        }
                        .foregroundStyle(Palette.ink2)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 26)
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .strokeBorder(Palette.hairline, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4])))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .refreshable { await model.load() }
    }
}

/// A deal on the board: value, who, the next step and whether it is late, health.
struct DealCard: View {
    let deal: DealView
    var id = "board.card"
    let onAct: () -> Void
    @EnvironmentObject private var model: PipelineModel

    var body: some View {
        let health = model.health(deal)
        NavigationLink(value: Route.deal(deal.id)) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top, spacing: 8) {
                    HealthDot(health: health).padding(.top, 6)
                    Text(deal.title).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 32)
                }
                if !who.isEmpty {
                    Text(who).font(.footnote).foregroundStyle(Palette.ink2).lineLimit(1)
                }
                HStack {
                    Text(Money.format(deal.value, currency: model.currency)).font(.subheadline.weight(.bold)).foregroundStyle(Palette.ink)
                    Spacer()
                    Avatar(seed: model.ownerLabel(deal.owner), size: 24)
                }
                HStack(spacing: 6) {
                    if let next = deal.nextActivity {
                        DueChip(kind: next.kind, dueAt: next.dueAt, subject: next.subject)
                    } else {
                        Pill(text: "No next step", fg: Palette.warn, bg: Palette.warnSoft)
                    }
                    if health.rotting {
                        Text("Idle \(health.idleDays)d").font(.caption.weight(.semibold)).foregroundStyle(Palette.danger)
                    }
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(health.rotting ? Palette.danger.opacity(0.4) : Palette.hairline, lineWidth: health.rotting ? 1 : 0.5))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(id)
        .overlay(alignment: .topTrailing) {
            Button(action: onAct) {
                Image(systemName: "ellipsis").font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink2)
                    .frame(width: 40, height: 36)
            }
            .accessibilityLabel("Move or close \(deal.title)")
            .accessibilityIdentifier("\(id).menu")
        }
        .contextMenu {
            Button(action: onAct) { Label("Move to stage…", systemImage: "arrow.right.circle") }
        }
    }

    private var who: String {
        [deal.organization, deal.contactName ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")
    }
}
