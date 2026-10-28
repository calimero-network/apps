import CrmCore
import SwiftUI
import UIKit

private struct EditRequest: Identifiable {
    let focus: DealField?
    var id: String { focus?.rawValue ?? "all" }
}

/// One deal: where it stands, the assistant, its activities and notes.
struct DealDetailView: View {
    let dealId: String
    @EnvironmentObject private var model: PipelineModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var detail: DealDetail?
    @State private var missing = false
    @State private var editing: EditRequest?
    @State private var acting = false
    @State private var losing = false
    @State private var scheduling = false
    @State private var emailing = false
    @State private var confirmDelete = false
    @State private var note = ""
    @FocusState private var noteFocused: Bool

    var body: some View {
        ScrollView {
            if missing {
                Card {
                    EmptyState(
                        icon: "questionmark.folder", title: "This deal no longer exists",
                        message: "It may have been deleted by its creator.")
                }
                .padding(16)
            } else if let detail {
                content(detail)
            } else {
                ProgressView("Loading deal…").frame(maxWidth: .infinity).padding(.vertical, 60)
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .screenBackground()
        .navigationTitle(detail?.deal.title ?? "Deal")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model.load() }
        .task(id: model.version) { await reload() }
        .toolbar {
            if let deal = detail?.deal {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { editing = EditRequest(focus: nil) } label: { Label("Edit", systemImage: "pencil") }
                        if deal.status == "open" {
                            Button { acting = true } label: { Label("Move to stage…", systemImage: "arrow.right.circle") }
                        }
                        if model.isMe(deal.createdBy) {
                            Button(role: .destructive) { confirmDelete = true } label: { Label("Delete deal", systemImage: "trash") }
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .accessibilityLabel("Deal actions")
                }
            }
        }
        .sheet(item: $editing) { request in
            if let deal = detail?.deal {
                DealEditorSheet(editing: deal, focus: request.focus) { _ in editing = nil }.environmentObject(model)
            }
        }
        .sheet(isPresented: $acting) {
            if let deal = detail?.deal { DealActionsSheet(deal: deal).environmentObject(model) }
        }
        .sheet(isPresented: $losing) {
            if let deal = detail?.deal { DealActionsSheet(deal: deal, startLosing: true).environmentObject(model) }
        }
        .sheet(isPresented: $scheduling) {
            ActivitySheet(dealId: dealId) { scheduling = false }.environmentObject(model)
        }
        .sheet(isPresented: $emailing) {
            if let detail { EmailDraftSheet(deal: detail.deal, contact: detail.contact).environmentObject(model) }
        }
        .confirmationDialog(
            "Delete “\(detail?.deal.title ?? "")” with its activities and notes? This cannot be undone.",
            isPresented: $confirmDelete, titleVisibility: .visible
        ) {
            Button("Delete deal", role: .destructive) {
                guard let deal = detail?.deal else { return }
                Task { if await model.deleteDeal(deal) { dismiss() } }
            }
        }
    }

    private func reload() async {
        do {
            detail = try await model.detail(dealId)
            missing = false
        } catch {
            if detail == nil { missing = true }
        }
    }

    @ViewBuilder
    private func content(_ detail: DealDetail) -> some View {
        let deal = detail.deal
        let isOpen = deal.status == "open"
        VStack(alignment: .leading, spacing: 14) {
            header(deal)
            if isOpen {
                HStack(spacing: 10) {
                    Button {
                        Task { if await model.markWon(deal) { Haptics.success() } }
                    } label: {
                        Label("Won", systemImage: "checkmark.circle")
                    }
                    .buttonStyle(SecondaryButtonStyle(tint: Palette.good, compact: true))
                    Button { losing = true } label: { Label("Lost", systemImage: "xmark.circle") }
                        .buttonStyle(SecondaryButtonStyle(tint: Palette.danger, compact: true))
                    Button { acting = true } label: { Label("Move", systemImage: "arrow.right.circle") }
                        .buttonStyle(SecondaryButtonStyle(compact: true))
                }
            } else {
                Button {
                    Task { await model.reopen(deal) }
                } label: {
                    Label("Reopen", systemImage: "arrow.uturn.backward.circle")
                }
                .buttonStyle(SecondaryButtonStyle(compact: true))
            }
            stageStrip(deal)
            detailsCard(detail)
            assistantCard(detail)
            activitiesCard(detail)
            notesCard(detail)
            DetailsDisclosure(rows: [
                ("Deal id", deal.id), ("Contact id", deal.contactId ?? "—"), ("Created by", deal.createdBy),
                ("Pipeline (context)", model.pipeline.contextId),
            ])
        }
        .padding(16)
    }

    private func header(_ deal: DealView) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(deal.title).font(.title2.weight(.bold)).foregroundStyle(Palette.ink)
                StatusPill(status: deal.status)
            }
            let parts = [
                deal.organization, deal.contactName ?? "",
                (deal.owner ?? "").isEmpty ? "" : "owned by \(model.ownerLabel(deal.owner))",
                deal.status == "lost" && !deal.lostReason.isEmpty ? "lost: \(deal.lostReason)" : "",
            ].filter { !$0.isEmpty }
            (Text(Money.format(deal.value, currency: model.currency)).font(.subheadline.weight(.bold)).foregroundColor(Palette.ink)
                + Text(parts.isEmpty ? "" : " · " + parts.joined(separator: " · ")).font(.subheadline).foregroundColor(Palette.ink2))
        }
    }

    private func stageStrip(_ deal: DealView) -> some View {
        let index = model.stages.firstIndex { $0.id == deal.stageId } ?? -1
        let isOpen = deal.status == "open"
        return VStack(alignment: .leading, spacing: 6) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(Array(model.stages.enumerated()), id: \.element.id) { i, stage in
                        Button {
                            Task { await model.move(deal, to: stage.id) }
                        } label: {
                            Text(stage.name).font(.footnote.weight(.semibold)).lineLimit(1)
                                .foregroundStyle(i <= index ? Palette.ink : Palette.ink2)
                                .padding(.horizontal, 12)
                                .frame(minHeight: 32)
                                .background(i == index ? Palette.lime : (i < index ? Palette.limeSoft : Palette.surface), in: Capsule())
                                .overlay(Capsule().strokeBorder(i <= index ? Color.clear : Palette.hairline, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                        .disabled(!isOpen || i == index)
                    }
                }
            }
            if isOpen {
                let days = max(0, Days.between(Days.date(deal.stageEnteredAt), model.now(), model.calendar))
                Text("In this stage for \(days) day\(days == 1 ? "" : "s")").font(.caption).foregroundStyle(Palette.ink3)
            }
        }
    }

    private func detailsCard(_ detail: DealDetail) -> some View {
        let deal = detail.deal
        let today = model.calendar.startOfDay(for: model.now())
        return Card {
            HStack {
                CardTitle(title: "Details")
                Button("Edit") { editing = EditRequest(focus: nil) }.font(.subheadline.weight(.semibold))
            }
            InfoRow(label: "Value", value: Money.format(deal.value, currency: model.currency))
            InfoRow(label: "Organization", value: deal.organization.isEmpty ? "—" : deal.organization)
            InfoRow(label: "Contact person", value: deal.contactName ?? "None")
            InfoRow(label: "Owner", value: model.ownerLabel(deal.owner))
            InfoRow(
                label: "Expected close",
                value: deal.expectedClose.map { Days.short(Days.date($0), model.calendar, now: model.now()) } ?? "Not set",
                valueColor: deal.status == "open" && deal.expectedClose.map { Days.date($0) < today } == true
                    ? Palette.danger : Palette.ink)
            InfoRow(label: "Source", value: deal.source.isEmpty ? "—" : deal.source)
            Text(facts(deal)).font(.caption).foregroundStyle(Palette.ink3)
            if let c = detail.contact {
                Divider()
                NavigationLink(value: Route.contact(c.id)) {
                    HStack(spacing: 12) {
                        Avatar(seed: c.name, size: 36)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(c.name).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink)
                            let sub = [c.jobTitle, c.organization].filter { !$0.isEmpty }.joined(separator: " at ")
                            if !sub.isEmpty { Text(sub).font(.footnote).foregroundStyle(Palette.ink2) }
                        }
                        Spacer()
                        Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Palette.ink3)
                    }
                }
                .buttonStyle(.plain)
                HStack(spacing: 10) {
                    if !c.email.isEmpty, let url = URL(string: "mailto:\(c.email)") {
                        Button { openURL(url) } label: { Label("Email", systemImage: "envelope") }
                            .buttonStyle(SecondaryButtonStyle(compact: true))
                    }
                    if !c.phone.isEmpty, let url = URL(string: "tel:\(c.phone.filter { !$0.isWhitespace })") {
                        Button { openURL(url) } label: { Label("Call", systemImage: "phone") }
                            .buttonStyle(SecondaryButtonStyle(compact: true))
                    }
                }
            }
        }
    }

    private func facts(_ deal: DealView) -> String {
        var s = "Added \(Days.short(Days.date(deal.createdAt), model.calendar, now: model.now()))"
        if let closed = deal.closedAt { s += " · closed \(Days.short(Days.date(closed), model.calendar, now: model.now()))" }
        return s
    }

    private func assistantCard(_ detail: DealDetail) -> some View {
        let deal = detail.deal
        let health = model.health(deal)
        let actions = Assistant.nextActions(
            deal, stages: model.stages, rottingDays: model.rottingDays, now: model.now(), model.calendar)
        return Card {
            CardTitle(title: "Deal assistant", icon: "sparkles")
                .accessibilityIdentifier("deal.assistant")
            if deal.status == "open" {
                HStack(alignment: .top, spacing: 14) {
                    ZStack {
                        Circle().stroke(Palette.sunken, lineWidth: 6)
                        Circle().trim(from: 0, to: CGFloat(health.score) / 100)
                            .stroke(Palette.health(health.level), style: StrokeStyle(lineWidth: 6, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                        Text("\(health.score)").font(.headline).foregroundStyle(Palette.ink)
                    }
                    .frame(width: 58, height: 58)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(health.level.label).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.health(health.level))
                        Text("Win likelihood ~\(health.winLikelihood)% (stage \(deal.probability)%, adjusted for health)")
                            .font(.footnote).foregroundStyle(Palette.ink2)
                        ForEach(health.reasons, id: \.self) { reason in
                            Label(reason, systemImage: "exclamationmark.circle").font(.footnote).foregroundStyle(Palette.ink)
                        }
                    }
                }
                if !actions.isEmpty {
                    SectionLabel(title: "Suggested next steps")
                    ForEach(Array(actions.enumerated()), id: \.element.id) { index, action in
                        HStack(alignment: .top, spacing: 10) {
                            if let a = action.activity {
                                Image(systemName: Icons.kind(a.kind.rawValue)).font(.footnote).foregroundStyle(Palette.ink2)
                                    .frame(width: 20).padding(.top, 2)
                            } else {
                                Image(systemName: "wrench.adjustable").font(.footnote).foregroundStyle(Palette.ink2)
                                    .frame(width: 20).padding(.top, 2)
                            }
                            VStack(alignment: .leading, spacing: 2) {
                                Text(action.title).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink)
                                Text(action.why).font(.footnote).foregroundStyle(Palette.ink2)
                            }
                            Spacer(minLength: 6)
                            Button(action.buttonTitle) {
                                if let a = action.activity {
                                    Task { if await model.schedule(a, on: deal) { Haptics.success() } }
                                } else {
                                    editing = EditRequest(focus: action.field)
                                }
                            }
                            .buttonStyle(SmallPrimaryStyle(filled: action.activity != nil))
                            .accessibilityIdentifier("deal.step.\(index)")
                        }
                        .padding(.vertical, 4)
                    }
                }
            } else {
                Text(deal.status == "won" ? "Closed won. Nice work." : "Closed lost. Reopen it if the conversation comes back.")
                    .font(.subheadline).foregroundStyle(Palette.ink2)
            }
            HStack(spacing: 10) {
                Button { emailing = true } label: { Label("Draft follow-up email", systemImage: "envelope") }
                    .buttonStyle(SecondaryButtonStyle(compact: true))
            }
            Button {
                UIPasteboard.general.string = Assistant.coachingPrompt(
                    detail, stages: model.stages, currency: model.currency, rottingDays: model.rottingDays,
                    now: model.now(), model.calendar)
                Haptics.success()
                model.notice = Notice("Prompt copied. Paste it into your AI assistant.")
            } label: {
                Label("Copy AI coaching prompt", systemImage: "doc.on.doc")
            }
            .buttonStyle(SecondaryButtonStyle(compact: true))
        }
    }

    private func activitiesCard(_ detail: DealDetail) -> some View {
        let open = detail.activities.filter { !$0.done }.count
        return Card {
            HStack {
                CardTitle(title: "Activities", trailing: "\(open) open")
                    .accessibilityIdentifier("deal.activities")
                Button { scheduling = true } label: { Label("Schedule", systemImage: "plus") }
                    .buttonStyle(SmallPrimaryStyle())
            }
            if detail.activities.isEmpty {
                Text("Nothing scheduled yet.").font(.subheadline).foregroundStyle(Palette.ink2)
            }
            ForEach(detail.activities) { a in
                ActivityRowView(activity: a, showDeal: false)
                if a.id != detail.activities.last?.id { Divider() }
            }
        }
    }

    private func notesCard(_ detail: DealDetail) -> some View {
        Card {
            CardTitle(title: "Notes")
                .accessibilityIdentifier("deal.notes")
            TextField("What did you learn? Budget, decision makers, objections…", text: $note, axis: .vertical)
                .lineLimit(2...8)
                .focused($noteFocused)
                .padding(12)
                .background(Palette.background, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Palette.hairline, lineWidth: 1))
            if !note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                HStack {
                    Spacer()
                    Button("Add note") {
                        let body = note
                        Task {
                            if await model.addNote(dealId: dealId, body: body) {
                                note = ""
                                noteFocused = false
                                Haptics.success()
                            }
                        }
                    }
                    .buttonStyle(SmallPrimaryStyle())
                }
            }
            ForEach(detail.notes) { n in
                HStack(alignment: .top, spacing: 10) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(n.body).font(.subheadline).foregroundStyle(Palette.ink).textSelection(.enabled)
                        Text("\(model.personLabel(n.author)) · \(Days.ago(Days.date(n.createdAt), now: model.now(), model.calendar))")
                            .font(.caption).foregroundStyle(Palette.ink3)
                    }
                    Spacer()
                    if model.isMe(n.author) {
                        Button {
                            Task { await model.deleteNote(n) }
                        } label: {
                            Image(systemName: "trash").font(.footnote).foregroundStyle(Palette.ink3)
                        }
                        .accessibilityLabel("Delete note")
                    }
                }
                .padding(.vertical, 4)
            }
        }
    }
}
