import CrmCore
import SwiftUI
import UIKit

/// "Move to stage…" (the phone's stand-in for dragging a card), plus closing the deal.
struct DealActionsSheet: View {
    let deal: DealView
    var startLosing = false
    @EnvironmentObject private var model: PipelineModel
    @Environment(\.dismiss) private var dismiss
    @State private var losing = false
    @State private var reason = ""
    @State private var busy = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if losing {
                        lostReason
                    } else {
                        SectionLabel(title: "Move to stage")
                        VStack(spacing: 0) {
                            ForEach(Array(model.stages.enumerated()), id: \.element.id) { index, stage in
                                Button {
                                    run { await model.move(deal, to: stage.id) }
                                } label: {
                                    HStack {
                                        Image(systemName: stage.id == deal.stageId ? "largecircle.fill.circle" : "circle")
                                            .foregroundStyle(stage.id == deal.stageId ? Palette.ink : Palette.ink3)
                                        Text(stage.name).font(.body.weight(.medium)).foregroundStyle(Palette.ink)
                                        Spacer()
                                        Text("\(stage.probability)%").font(.subheadline).foregroundStyle(Palette.ink3)
                                    }
                                    .padding(.horizontal, 14)
                                    .frame(minHeight: 48)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .accessibilityIdentifier("actions.stage.\(index)")
                                .disabled(busy || deal.status != "open")
                                if stage.id != model.stages.last?.id { Divider().padding(.leading, 44) }
                            }
                        }
                        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Palette.hairline, lineWidth: 0.5))
                        SectionLabel(title: "Close the deal")
                        HStack(spacing: 10) {
                            Button {
                                run { await model.markWon(deal) }
                            } label: {
                                Label("Won", systemImage: "checkmark.circle")
                            }
                            .buttonStyle(SecondaryButtonStyle(tint: Palette.good))
                            Button {
                                withAnimation { losing = true }
                            } label: {
                                Label("Lost", systemImage: "xmark.circle")
                            }
                            .buttonStyle(SecondaryButtonStyle(tint: Palette.danger))
                        }
                        .disabled(busy)
                    }
                }
                .padding(20)
            }
            .screenBackground()
            .navigationTitle(deal.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
        .onAppear { losing = startLosing }
        .presentationDetents([.medium, .large])
    }

    private var lostReason: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Why was “\(deal.title)” lost? It helps the whole team see patterns.")
                .font(.subheadline).foregroundStyle(Palette.ink2)
            FlowChips(items: LostReasons.common, selected: reason) { reason = $0 }
            Field(label: "Reason", placeholder: "Optional", text: $reason)
            Button {
                run { await model.markLost(deal, reason: reason) }
            } label: {
                Text(busy ? "Saving…" : "Mark as lost")
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(busy)
        }
    }

    private func run(_ body: @escaping () async -> Bool) {
        busy = true
        Task {
            let ok = await body()
            busy = false
            if ok {
                Haptics.success()
                dismiss()
            }
        }
    }
}

/// Pills that wrap onto as many lines as they need.
struct FlowChips: View {
    let items: [String]
    let selected: String
    let onTap: (String) -> Void

    var body: some View {
        FlowLayout(spacing: 8) {
            ForEach(items, id: \.self) { item in
                Chip(title: item, selected: item == selected) { onTap(item) }
            }
        }
    }
}

struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var row: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x + size.width > width, x > 0 {
                x = 0
                y += row + spacing
                row = 0
            }
            x += size.width + spacing
            row = max(row, size.height)
        }
        return CGSize(width: proposal.width ?? x, height: y + row)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var row: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX, x > bounds.minX {
                x = bounds.minX
                y += row + spacing
                row = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            row = max(row, size.height)
        }
    }
}

/// New deal, or edit one.
struct DealEditorSheet: View {
    let editing: DealView?
    var focus: DealField?
    let onSaved: (String?) -> Void
    @EnvironmentObject private var model: PipelineModel
    @State private var draft: DealDraft
    @State private var busy = false

    init(editing: DealView? = nil, initial: DealDraft = DealDraft(), focus: DealField? = nil, onSaved: @escaping (String?) -> Void = { _ in }) {
        self.editing = editing
        self.focus = focus
        self.onSaved = onSaved
        _draft = State(initialValue: editing.map(DealDraft.init) ?? initial)
    }

    var body: some View {
        SheetScaffold(
            title: editing == nil ? "New deal" : "Edit deal", action: editing == nil ? "Add deal" : "Save",
            busy: busy, enabled: draft.isValid, onAction: save
        ) {
            Field(label: "Title", placeholder: "What are you selling, to whom?", text: $draft.title)
            Field(label: "Value (\(model.currency))", placeholder: "e.g. 12k", text: $draft.value, keyboard: .decimalPad)
            if draft.parsedValue == nil {
                Text(CrmError.invalidValue.errorDescription ?? "").font(.footnote).foregroundStyle(Palette.danger)
            }
            Field(label: "Organization", placeholder: "Company", text: $draft.organization)
            PickerField(label: "Contact person", value: contactLabel) {
                Button("None") {
                    draft.contactId = nil
                    draft.creatingContact = false
                }
                if editing == nil {
                    Button {
                        draft.contactId = nil
                        draft.creatingContact = true
                    } label: {
                        Label("New person…", systemImage: "person.badge.plus")
                    }
                }
                ForEach(model.contacts) { c in
                    Button(c.organization.isEmpty ? c.name : "\(c.name) · \(c.organization)") {
                        draft.contactId = c.id
                        draft.creatingContact = false
                    }
                }
            }
            if draft.creatingContact {
                Field(label: "Name", placeholder: "Full name", text: $draft.newContactName, capitalization: .words)
                Field(
                    label: "Email", placeholder: "name@company.com", text: $draft.newContactEmail, keyboard: .emailAddress,
                    capitalization: .never)
            }
            if editing == nil {
                PickerField(label: "Stage", value: model.stage(draft.stageId)?.name ?? "Choose a stage") {
                    ForEach(model.stages) { s in
                        Button("\(s.name) · \(s.probability)%") { draft.stageId = s.id }
                    }
                }
            }
            PickerField(label: "Owner", value: model.ownerLabel(draft.owner)) {
                Button("Unassigned") { draft.owner = nil }
                ForEach(ownerChoices, id: \.self) { o in
                    Button(model.ownerLabel(o)) { draft.owner = o }
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                Toggle(isOn: $draft.hasClose) {
                    Text("Expected close").font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink2)
                }
                .tint(Palette.good)
                if draft.hasClose {
                    DatePicker("Close date", selection: $draft.expectedClose, displayedComponents: .date)
                        .datePickerStyle(.compact)
                        .font(.subheadline)
                }
            }
            Field(label: "Source", placeholder: "Referral, inbound…", text: $draft.source)
        }
        .onAppear {
            if draft.stageId.isEmpty { draft.stageId = model.stages.first?.id ?? "" }
            if editing == nil, draft.owner == nil { draft.owner = model.me }
            if focus == .expectedClose { draft.hasClose = true }
        }
    }

    private var ownerChoices: [String] {
        var options = model.ownerOptions
        if let o = draft.owner, !options.contains(where: { Account.same($0, o) || $0 == o }) { options.append(o) }
        return options
    }

    private var contactLabel: String {
        if draft.creatingContact { return "New person" }
        return model.contact(draft.contactId)?.name ?? "None"
    }

    private func save() {
        busy = true
        Task {
            if let editing {
                let ok = await model.updateDeal(editing.id, draft)
                busy = false
                if ok {
                    Haptics.success()
                    onSaved(editing.id)
                }
            } else {
                let id = await model.createDeal(draft)
                busy = false
                if let id {
                    Haptics.success()
                    onSaved(id)
                }
            }
        }
    }
}

/// Schedule a call, meeting, task, email or deadline.
struct ActivitySheet: View {
    let fixedDeal: String?
    let onDone: () -> Void
    @EnvironmentObject private var model: PipelineModel
    @State private var draft: ActivityDraft
    @State private var busy = false

    init(dealId: String?, onDone: @escaping () -> Void) {
        fixedDeal = dealId
        self.onDone = onDone
        _draft = State(initialValue: ActivityDraft(due: Days.dueIn(1, now: Date(), .current), dealId: dealId))
    }

    var body: some View {
        SheetScaffold(
            title: "Schedule", action: "Schedule", busy: busy, enabled: draft.isValid, onAction: save
        ) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Type").font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink2)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(ActivityKind.allCases) { kind in
                            Chip(title: kind.label, icon: Icons.kind(kind.rawValue), selected: draft.kind == kind) {
                                draft.kind = kind
                            }
                        }
                    }
                }
            }
            Field(label: "What needs to happen?", placeholder: "e.g. Call about the proposal", text: $draft.subject)
            if fixedDeal == nil {
                PickerField(label: "Deal", value: draft.dealId.flatMap { model.deal($0)?.title } ?? "No deal") {
                    Button("No deal") { draft.dealId = nil }
                    ForEach(model.openDeals) { d in
                        Button(d.title) { draft.dealId = d.id }
                    }
                }
            }
            DatePicker("Due", selection: $draft.due, displayedComponents: [.date, .hourAndMinute])
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Palette.ink2)
            VStack(alignment: .leading, spacing: 6) {
                Text("Note").font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink2)
                TextField("Optional", text: $draft.note, axis: .vertical)
                    .lineLimit(2...6)
                    .padding(12)
                    .background(Palette.surface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Palette.hairline, lineWidth: 1))
            }
        }
        .presentationDetents([.large])
    }

    private func save() {
        busy = true
        Task {
            let ok = await model.schedule(draft)
            busy = false
            if ok {
                Haptics.success()
                onDone()
            }
        }
    }
}

/// The assistant's follow-up email: copy, open in Mail, or log it.
struct EmailDraftSheet: View {
    let deal: DealView
    let contact: ContactView?
    @EnvironmentObject private var model: PipelineModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    var body: some View {
        let email = Assistant.followUpEmail(deal, stages: model.stages, contact: contact, sender: "")
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Card {
                        Text("SUBJECT").font(.caption2.weight(.semibold)).tracking(0.5).foregroundStyle(Palette.ink3)
                        Text(email.subject).font(.headline).foregroundStyle(Palette.ink).textSelection(.enabled)
                        Divider()
                        Text(email.body).font(.subheadline).foregroundStyle(Palette.ink).textSelection(.enabled)
                    }
                    Button {
                        UIPasteboard.general.string = "Subject: \(email.subject)\n\n\(email.body)"
                        Haptics.success()
                        model.notice = Notice("Email copied")
                    } label: {
                        Label("Copy", systemImage: "doc.on.doc")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    if let address = contact?.email, !address.isEmpty, let url = mailURL(address, email) {
                        Button {
                            openURL(url)
                        } label: {
                            Label("Open in Mail", systemImage: "envelope")
                        }
                        .buttonStyle(SecondaryButtonStyle())
                    }
                    Button {
                        Task {
                            var draft = ActivityDraft(due: Days.dueIn(0, now: model.now(), model.calendar), dealId: deal.id)
                            draft.kind = .email
                            draft.subject = email.subject
                            draft.note = email.body
                            if await model.schedule(draft) { dismiss() }
                        }
                    } label: {
                        Label("Log as email activity", systemImage: "tray.and.arrow.down")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
                .padding(20)
            }
            .screenBackground()
            .navigationTitle("Follow-up email")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
    }

    private func mailURL(_ address: String, _ email: EmailDraft) -> URL? {
        var c = URLComponents()
        c.scheme = "mailto"
        c.path = address
        c.queryItems = [URLQueryItem(name: "subject", value: email.subject), URLQueryItem(name: "body", value: email.body)]
        return c.url
    }
}
