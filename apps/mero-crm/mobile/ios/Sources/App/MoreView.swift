import CrmCore
import MeroKitUI
import SwiftUI
import UIKit

/// Insights, pipeline setup, inviting the team, and the way out.
struct MoreView: View {
    let onSwitch: () -> Void
    let onSignOut: () -> Void
    @EnvironmentObject private var model: PipelineModel
    @State private var inviting = false
    @State private var confirmSignOut = false

    var body: some View {
        List {
            Section {
                HStack(spacing: 12) {
                    AppMark(size: 40)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(model.pipeline.name).font(.headline).foregroundStyle(Palette.ink)
                        Text(model.pipeline.workspaceName.isEmpty ? "Workspace" : model.pipeline.workspaceName)
                            .font(.footnote).foregroundStyle(Palette.ink2)
                    }
                }
                .padding(.vertical, 4)
            }
            Section("Pipeline") {
                NavigationLink(value: Route.insights) { MoreRow(title: "Insights", icon: "chart.bar") }
                NavigationLink(value: Route.stages) { MoreRow(title: "Stages", icon: "rectangle.split.3x1") }
                NavigationLink(value: Route.automations) { MoreRow(title: "Automations", icon: "bolt") }
                NavigationLink(value: Route.settings) { MoreRow(title: "Pipeline settings", icon: "gearshape") }
            }
            Section("Workspace") {
                Button { inviting = true } label: { MoreRow(title: "Invite people", icon: "person.badge.plus") }
                Button(action: onSwitch) { MoreRow(title: "Switch pipeline", icon: "square.grid.2x2") }
            }
            Section("Account") {
                MoreRow(title: "Signed in as \(Account.short(model.me))", icon: "person.crop.circle")
                Button(role: .destructive) { confirmSignOut = true } label: {
                    Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right").foregroundStyle(Palette.danger)
                }
            }
            Section {
                DetailsDisclosure(rows: [
                    ("Pipeline (context)", model.pipeline.contextId), ("Workspace (namespace)", model.pipeline.namespaceId),
                    ("Account", model.me),
                ])
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .screenBackground()
        .navigationTitle("More")
        .sheet(isPresented: $inviting) { InviteSheet().environmentObject(model) }
        .confirmationDialog("Sign out of Mero CRM on this device?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive, action: onSignOut)
        }
    }
}

private struct MoreRow: View {
    let title: String
    let icon: String
    var body: some View {
        Label {
            Text(title).foregroundStyle(Palette.ink)
        } icon: {
            Image(systemName: icon).foregroundStyle(Palette.ink2)
        }
    }
}

/// Mint a link to this workspace and share it.
private struct InviteSheet: View {
    @EnvironmentObject private var model: PipelineModel
    @Environment(\.dismiss) private var dismiss
    @State private var link: String?
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text(
                    "Anyone with this link can join \(model.pipeline.workspaceName.isEmpty ? "this workspace" : model.pipeline.workspaceName) and see its pipelines. It opens in the app or in the browser."
                )
                .font(.subheadline).foregroundStyle(Palette.ink2)
                if let link {
                    Text(link).font(.footnote.monospaced()).foregroundStyle(Palette.ink).lineLimit(4).textSelection(.enabled)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Palette.hairline, lineWidth: 1))
                    ShareLink(item: link) { Label("Share link", systemImage: "square.and.arrow.up") }
                        .buttonStyle(PrimaryButtonStyle())
                    Button {
                        UIPasteboard.general.string = link
                        Haptics.success()
                        model.notice = Notice("Invitation link copied")
                    } label: {
                        Label("Copy link", systemImage: "doc.on.doc")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                } else if busy {
                    ProgressView("Creating a link…").frame(maxWidth: .infinity).padding(.vertical, 20)
                }
                if let error {
                    ErrorLine(message: error)
                    Button("Try again") { Task { await mint() } }.buttonStyle(SecondaryButtonStyle())
                }
                Spacer()
            }
            .padding(20)
            .screenBackground()
            .navigationTitle("Invite people")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
            .task { await mint() }
        }
        .presentationDetents([.medium, .large])
    }

    private func mint() async {
        busy = true
        error = nil
        let workspaces = WorkspacesModel(backend: model.backend, applicationId: nil)
        let workspace = Workspace(
            id: model.pipeline.namespaceId, name: model.pipeline.workspaceName, memberCount: 0, pipelines: [])
        link = await workspaces.inviteLink(for: workspace)
        error = link == nil ? workspaces.error : nil
        busy = false
    }
}

// MARK: - Insights

struct InsightsView: View {
    @EnvironmentObject private var model: PipelineModel

    var body: some View {
        let s = model.stats()
        let currency = model.currency
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                    Tile(label: "Open pipeline", value: Money.format(s.openValue, currency: currency, compact: true), sub: "\(s.openCount) deals")
                    Tile(label: "Weighted", value: Money.format(s.weightedValue, currency: currency, compact: true), sub: "value × stage odds")
                    Tile(label: "Won this month", value: Money.format(s.wonThisMonth, currency: currency, compact: true), sub: "\(s.wonCount) won in total")
                    Tile(label: "Win rate", value: s.winRate.map { "\($0)%" } ?? "—", sub: "\(s.wonCount) won · \(s.lostCount) lost")
                    Tile(label: "Average deal", value: s.avgWonValue.map { Money.format($0, currency: currency, compact: true) } ?? "—", sub: "won deals")
                    Tile(label: "Sales cycle", value: s.avgCycleDays.map { "\($0)d" } ?? "—", sub: "created to won")
                }
                Card {
                    CardTitle(title: "Value by stage")
                    let top = max(1, s.perStage.map(\.value).max() ?? 1)
                    ForEach(s.perStage) { row in
                        Bar(label: row.stage.name, detail: "\(row.count) · \(Money.format(row.value, currency: currency, compact: true))",
                            fraction: Double(row.value) / Double(top))
                    }
                }
                Card {
                    CardTitle(title: "Forecast", trailing: "weighted by stage")
                    let top = max(1, s.forecast.map(\.value).max() ?? 1)
                    ForEach(s.forecast) { m in
                        Bar(label: m.label, detail: "\(Money.format(m.weighted, currency: currency, compact: true)) of \(Money.format(m.value, currency: currency, compact: true))",
                            fraction: Double(m.value) / Double(top))
                    }
                }
                Card {
                    CardTitle(title: "Lost reasons")
                    if s.lostReasons.isEmpty { Text("Nothing lost yet.").font(.subheadline).foregroundStyle(Palette.ink2) }
                    ForEach(s.lostReasons) { r in InfoRow(label: r.reason, value: "\(r.count)") }
                }
                Card {
                    CardTitle(title: "By owner")
                    if s.byOwner.isEmpty { Text("No deals yet.").font(.subheadline).foregroundStyle(Palette.ink2) }
                    ForEach(s.byOwner) { o in
                        HStack {
                            Avatar(seed: model.ownerLabel(o.owner), size: 28)
                            Text(model.ownerLabel(o.owner)).font(.subheadline).foregroundStyle(Palette.ink)
                            Spacer()
                            VStack(alignment: .trailing, spacing: 2) {
                                Text("\(Money.format(o.wonValue, currency: currency, compact: true)) won").font(.subheadline.weight(.semibold))
                                Text("\(Money.format(o.openValue, currency: currency, compact: true)) open").font(.caption).foregroundStyle(Palette.ink2)
                            }
                        }
                    }
                }
                let attention = model.openDeals.map { ($0, model.health($0)) }.filter { $0.1.level != .healthy }
                    .sorted { $0.1.score < $1.1.score }.prefix(8)
                Card {
                    CardTitle(title: "Needs attention")
                    if attention.isEmpty { Text("Every open deal is on track.").font(.subheadline).foregroundStyle(Palette.ink2) }
                    ForEach(Array(attention), id: \.0.id) { deal, health in
                        NavigationLink(value: Route.deal(deal.id)) {
                            HStack(alignment: .top, spacing: 10) {
                                HealthDot(health: health).padding(.top, 6)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(deal.title).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink)
                                    Text(health.reasons.first ?? health.level.label).font(.footnote).foregroundStyle(Palette.ink2)
                                }
                                Spacer()
                                Text("\(health.score)").font(.subheadline.weight(.bold)).foregroundStyle(Palette.health(health.level))
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(16)
        }
        .screenBackground()
        .navigationTitle("Insights")
        .refreshable { await model.load() }
    }
}

private struct Tile: View {
    let label: String
    let value: String
    let sub: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.footnote.weight(.semibold)).foregroundStyle(Palette.ink2)
            Text(value).font(.title2.weight(.bold)).foregroundStyle(Palette.ink).lineLimit(1).minimumScaleFactor(0.7)
            Text(sub).font(.caption).foregroundStyle(Palette.ink3).lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Palette.hairline, lineWidth: 0.5))
    }
}

private struct Bar: View {
    let label: String
    let detail: String
    let fraction: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label).font(.subheadline).foregroundStyle(Palette.ink)
                Spacer()
                Text(detail).font(.footnote).foregroundStyle(Palette.ink2)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Palette.sunken)
                    Capsule().fill(Palette.lime).frame(width: max(0, geo.size.width * fraction))
                }
            }
            .frame(height: 6)
        }
    }
}

// MARK: - Stages

struct StagesView: View {
    @EnvironmentObject private var model: PipelineModel
    @State private var editing: StageView?
    @State private var adding = false

    var body: some View {
        List {
            Section {
                ForEach(Array(model.stages.enumerated()), id: \.element.id) { i, stage in
                    HStack(spacing: 10) {
                        Button { editing = stage } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(stage.name).font(.body.weight(.medium)).foregroundStyle(Palette.ink)
                                let open = model.openDeals(in: stage.id).count
                                Text("\(stage.probability)% win · \(open) open deal\(open == 1 ? "" : "s")")
                                    .font(.footnote).foregroundStyle(Palette.ink2)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        Button { Task { await model.moveStage(stage, by: -1) } } label: { Image(systemName: "arrow.up") }
                            .buttonStyle(.borderless).disabled(i == 0)
                            .accessibilityLabel("Move \(stage.name) up")
                        Button { Task { await model.moveStage(stage, by: 1) } } label: { Image(systemName: "arrow.down") }
                            .buttonStyle(.borderless).disabled(i == model.stages.count - 1)
                            .accessibilityLabel("Move \(stage.name) down")
                    }
                    .listRowBackground(Palette.surface)
                }
            } footer: {
                Text("The columns of your pipeline, in order. Probability drives the weighted forecast.")
            }
            Section {
                Button { adding = true } label: { Label("Add stage", systemImage: "plus") }
                    .listRowBackground(Palette.surface)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .screenBackground()
        .navigationTitle("Stages")
        .sheet(item: $editing) { stage in StageEditorSheet(stage: stage) { editing = nil }.environmentObject(model) }
        .sheet(isPresented: $adding) { StageEditorSheet(stage: nil) { adding = false }.environmentObject(model) }
    }
}

private struct StageEditorSheet: View {
    let stage: StageView?
    let onDone: () -> Void
    @EnvironmentObject private var model: PipelineModel
    @State private var name: String
    @State private var probability: String
    @State private var busy = false
    @State private var confirmDelete = false

    init(stage: StageView?, onDone: @escaping () -> Void) {
        self.stage = stage
        self.onDone = onDone
        _name = State(initialValue: stage?.name ?? "")
        _probability = State(initialValue: stage.map { String($0.probability) } ?? "50")
    }

    private var p: Int? { Int(probability.trimmingCharacters(in: .whitespaces)).flatMap { (0...100).contains($0) ? $0 : nil } }
    private var openDeals: Int { stage.map { model.openDeals(in: $0.id).count } ?? 0 }

    var body: some View {
        SheetScaffold(
            title: stage == nil ? "New stage" : "Edit stage", action: stage == nil ? "Add stage" : "Save", busy: busy,
            enabled: !name.trimmingCharacters(in: .whitespaces).isEmpty && p != nil, onAction: save
        ) {
            Field(label: "Name", placeholder: "e.g. Demo", text: $name)
            Field(label: "Win probability (%)", placeholder: "0–100", text: $probability, keyboard: .numberPad)
            if p == nil { Text("A whole number from 0 to 100.").font(.footnote).foregroundStyle(Palette.danger) }
            if let stage {
                Button(role: .destructive) { confirmDelete = true } label: { Label("Delete stage", systemImage: "trash") }
                    .buttonStyle(SecondaryButtonStyle(tint: Palette.danger))
                    .disabled(openDeals > 0)
                if openDeals > 0 {
                    Text("Move its \(openDeals) open deal\(openDeals == 1 ? "" : "s") first.").font(.footnote).foregroundStyle(Palette.ink2)
                }
            }
        }
        .confirmationDialog(
            "Delete the \(stage?.name ?? "") stage and its automations?", isPresented: $confirmDelete, titleVisibility: .visible
        ) {
            Button("Delete stage", role: .destructive) {
                guard let stage else { return }
                Task { if await model.deleteStage(stage) { onDone() } }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func save() {
        guard let p else { return }
        busy = true
        Task {
            let ok = stage == nil ? await model.addStage(name: name, probability: p) : await model.updateStage(stage!, name: name, probability: p)
            busy = false
            if ok {
                Haptics.success()
                onDone()
            }
        }
    }
}

// MARK: - Automations (read-only on the phone)

struct AutomationsView: View {
    @EnvironmentObject private var model: PipelineModel

    var body: some View {
        List {
            Section {
                if model.automations.isEmpty {
                    Text("No automations yet.").foregroundStyle(Palette.ink2).listRowBackground(Palette.surface)
                }
                ForEach(model.automations) { a in
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: Icons.kind(a.kind)).foregroundStyle(a.enabled ? Palette.ink : Palette.ink3).frame(width: 22)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(sentence(a)).font(.subheadline).foregroundStyle(a.enabled ? Palette.ink : Palette.ink3)
                            if !a.enabled { Pill(text: "Off") }
                        }
                    }
                    .padding(.vertical, 4)
                    .listRowBackground(Palette.surface)
                }
            } footer: {
                Text(
                    "When a deal enters a stage, these schedule an activity for the deal's owner automatically. Add and change them in Mero CRM on the web."
                )
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .screenBackground()
        .navigationTitle("Automations")
    }

    private func sentence(_ a: AutomationView) -> String {
        let stage = model.stage(a.stageId)?.name ?? "—"
        let due = a.dueInDays == 0 ? "for the same day" : "due in \(a.dueInDays) day\(a.dueInDays == 1 ? "" : "s")"
        return "When a deal enters \(stage), schedule \(ActivityKind.label(a.kind).lowercased()) “\(a.subject)” \(due)."
    }
}

// MARK: - Settings

struct PipelineSettingsView: View {
    @EnvironmentObject private var model: PipelineModel
    @State private var currency = ""
    @State private var rotting = 14

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Card {
                    CardTitle(title: "Currency")
                    Text("Every deal's value is in this currency.").font(.footnote).foregroundStyle(Palette.ink2)
                    Field(label: "Code", placeholder: "USD", text: $currency, capitalization: .characters)
                    Button("Save currency") { Task { await model.setCurrency(currency) } }
                        .buttonStyle(SmallPrimaryStyle())
                        .disabled(currency.uppercased() == model.currency || !Money.isValidCode(currency))
                }
                Card {
                    CardTitle(title: "Idle threshold")
                    Text("A deal with no activity for longer than this is flagged on the board.").font(.footnote).foregroundStyle(Palette.ink2)
                    Stepper(value: $rotting, in: 1...365) {
                        Text("\(rotting) day\(rotting == 1 ? "" : "s")").font(.body.weight(.semibold)).foregroundStyle(Palette.ink)
                    }
                    Button("Save threshold") { Task { await model.setRottingDays(rotting) } }
                        .buttonStyle(SmallPrimaryStyle())
                        .disabled(rotting == model.rottingDays)
                }
            }
            .padding(16)
        }
        .screenBackground()
        .navigationTitle("Pipeline settings")
        .onAppear {
            currency = model.currency
            rotting = model.rottingDays
        }
    }
}
