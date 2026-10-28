import CrmCore
import SwiftUI

enum PeopleMode: String, CaseIterable, Identifiable {
    case people, companies
    var id: String { rawValue }
    var title: String { self == .people ? "People" : "Companies" }
}

/// The address book: people, and the companies their organizations make.
struct PeopleView: View {
    @EnvironmentObject private var model: PipelineModel
    @State private var mode: PeopleMode = .people
    @State private var query = ""
    @State private var creating = false

    var body: some View {
        LoadGate {
            List {
                Section {
                    HStack(spacing: 8) {
                        ForEach(PeopleMode.allCases) { m in
                            Chip(title: m.title, count: m == .people ? model.contacts.count : model.companies().count, selected: mode == m) {
                                mode = m
                            }
                            .accessibilityIdentifier("people.mode.\(m.rawValue)")
                        }
                        Spacer()
                    }
                    .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }
                if mode == .people { people } else { companies }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .refreshable { await model.load() }
        }
        .screenBackground()
        .navigationTitle("People")
        .searchable(text: $query, prompt: mode == .people ? "Search people" : "Search companies")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { creating = true } label: { Image(systemName: "person.badge.plus") }
                    .accessibilityLabel("New person")
            }
        }
        .sheet(isPresented: $creating) {
            ContactEditorSheet { creating = false }.environmentObject(model)
        }
    }

    @ViewBuilder private var people: some View {
        let rows = model.contacts.filter { Insights.contactMatches($0, query) }
        if rows.isEmpty {
            EmptyState(
                icon: "person.2", title: query.isEmpty ? "No people yet" : "Nobody matches “\(query)”",
                message: "Add the people you sell to, then link them to deals.")
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
        } else {
            Section {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, c in
                    NavigationLink(value: Route.contact(c.id)) { ContactRow(contact: c) }
                        .accessibilityIdentifier("people.row.\(index)")
                        .listRowBackground(Palette.surface)
                }
            }
        }
    }

    @ViewBuilder private var companies: some View {
        let rows = model.companies().filter { Insights.companyMatches($0, query) }
        if rows.isEmpty {
            EmptyState(
                icon: "building.2", title: query.isEmpty ? "No companies yet" : "No company matches “\(query)”",
                message: "Companies appear here from the organization on people and deals.")
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
        } else {
            Section {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, company in
                    NavigationLink(value: Route.company(company.id)) {
                        HStack(spacing: 12) {
                            RoundedRectangle(cornerRadius: 9, style: .continuous).fill(Palette.limeSoft)
                                .frame(width: 36, height: 36)
                                .overlay(Image(systemName: "building.2").font(.footnote).foregroundStyle(Palette.ink))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(company.name).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink)
                                Text(
                                    "\(company.people.count) \(company.people.count == 1 ? "person" : "people") · \(company.openDeals.count) open"
                                )
                                .font(.footnote).foregroundStyle(Palette.ink2)
                            }
                            Spacer()
                            if company.openValue > 0 {
                                Text(Money.format(company.openValue, currency: model.currency, compact: true))
                                    .font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink)
                            }
                        }
                        .padding(.vertical, 2)
                    }
                    .accessibilityIdentifier("companies.row.\(index)")
                    .listRowBackground(Palette.surface)
                }
            }
        }
    }
}

struct ContactRow: View {
    let contact: ContactView
    @EnvironmentObject private var model: PipelineModel

    var body: some View {
        HStack(spacing: 12) {
            Avatar(seed: contact.name, size: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(contact.name).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink)
                let sub = [contact.jobTitle, contact.organization].filter { !$0.isEmpty }.joined(separator: " · ")
                if !sub.isEmpty { Text(sub).font(.footnote).foregroundStyle(Palette.ink2).lineLimit(1) }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                if contact.openDeals > 0 { Text("\(contact.openDeals) open").font(.footnote.weight(.semibold)).foregroundStyle(Palette.ink) }
                if contact.wonValue > 0 {
                    Text("\(Money.format(contact.wonValue, currency: model.currency, compact: true)) won")
                        .font(.caption).foregroundStyle(Palette.good)
                }
            }
        }
        .padding(.vertical, 2)
    }
}

/// One person: how to reach them, their deals and what is scheduled with them.
struct ContactDetailView: View {
    let contactId: String
    @EnvironmentObject private var model: PipelineModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var editing = false
    @State private var newDeal = false
    @State private var confirmDelete = false

    var body: some View {
        ScrollView {
            if let c = model.contact(contactId) {
                content(c)
            } else {
                Card { EmptyState(icon: "person.crop.circle.badge.questionmark", title: "This person no longer exists") }
                    .padding(16)
            }
        }
        .screenBackground()
        .navigationTitle(model.contact(contactId)?.name ?? "Person")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model.load() }
        .toolbar {
            if let c = model.contact(contactId) {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { editing = true } label: { Label("Edit", systemImage: "pencil") }
                        if model.isMe(c.createdBy) {
                            Button(role: .destructive) { confirmDelete = true } label: { Label("Delete person", systemImage: "trash") }
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .accessibilityLabel("Person actions")
                }
            }
        }
        .sheet(isPresented: $editing) {
            if let c = model.contact(contactId) {
                ContactEditorSheet(editing: c) { editing = false }.environmentObject(model)
            }
        }
        .sheet(isPresented: $newDeal) {
            DealEditorSheet(initial: draft()) { _ in newDeal = false }.environmentObject(model)
        }
        .confirmationDialog(
            "Delete \(model.contact(contactId)?.name ?? "")? Their deals stay, without a contact person.",
            isPresented: $confirmDelete, titleVisibility: .visible
        ) {
            Button("Delete person", role: .destructive) {
                guard let c = model.contact(contactId) else { return }
                Task { if await model.deleteContact(c) { dismiss() } }
            }
        }
    }

    private func draft() -> DealDraft {
        var d = DealDraft()
        d.contactId = contactId
        d.organization = model.contact(contactId)?.organization ?? ""
        return d
    }

    @ViewBuilder
    private func content(_ c: ContactView) -> some View {
        let deals = model.deals.filter { $0.contactId == c.id }.sorted { $0.createdAt > $1.createdAt }
        let todos = model.activities.filter { $0.contactId == c.id && !$0.done }.sorted { $0.dueAt < $1.dueAt }
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 14) {
                Avatar(seed: c.name, size: 56)
                VStack(alignment: .leading, spacing: 4) {
                    Text(c.name).font(.title2.weight(.bold)).foregroundStyle(Palette.ink)
                    let sub = [c.jobTitle, c.organization].filter { !$0.isEmpty }.joined(separator: " at ")
                    if !sub.isEmpty { Text(sub).font(.subheadline).foregroundStyle(Palette.ink2) }
                }
            }
            HStack(spacing: 10) {
                if !c.email.isEmpty, let url = URL(string: "mailto:\(c.email)") {
                    Button { openURL(url) } label: { Label("Email", systemImage: "envelope") }
                        .buttonStyle(SecondaryButtonStyle(compact: true))
                }
                if !c.phone.isEmpty, let url = URL(string: "tel:\(c.phone.filter { !$0.isWhitespace })") {
                    Button { openURL(url) } label: { Label("Call", systemImage: "phone") }
                        .buttonStyle(SecondaryButtonStyle(compact: true))
                }
                Button { newDeal = true } label: { Label("Deal", systemImage: "plus") }
                    .buttonStyle(SecondaryButtonStyle(compact: true))
                    .disabled(model.stages.isEmpty)
            }
            Card {
                CardTitle(title: "Contact")
                InfoRow(label: "Email", value: c.email.isEmpty ? "—" : c.email)
                InfoRow(label: "Phone", value: c.phone.isEmpty ? "—" : c.phone)
                InfoRow(label: "Organization", value: c.organization.isEmpty ? "—" : c.organization)
                InfoRow(label: "Job title", value: c.jobTitle.isEmpty ? "—" : c.jobTitle)
                InfoRow(label: "Open deals", value: "\(c.openDeals)")
                InfoRow(label: "Won", value: c.wonValue > 0 ? Money.format(c.wonValue, currency: model.currency) : "—")
            }
            Card {
                CardTitle(title: "Deals", trailing: "\(deals.count)")
                if deals.isEmpty {
                    Text("No deals with \(c.name) yet.").font(.subheadline).foregroundStyle(Palette.ink2)
                }
                ForEach(deals) { d in
                    NavigationLink(value: Route.deal(d.id)) { DealRow(deal: d) }.buttonStyle(.plain)
                    if d.id != deals.last?.id { Divider() }
                }
            }
            if !todos.isEmpty {
                Card {
                    CardTitle(title: "Scheduled", trailing: "\(todos.count) open")
                    ForEach(todos) { a in
                        ActivityRowView(activity: a, showDeal: true)
                        if a.id != todos.last?.id { Divider() }
                    }
                }
            }
            DetailsDisclosure(rows: [("Person id", c.id), ("Created by", c.createdBy)])
        }
        .padding(16)
    }
}

/// A company: its people and deals, and what they are worth.
struct CompanyDetailView: View {
    let key: String
    @EnvironmentObject private var model: PipelineModel
    @State private var newDeal = false
    @State private var newPerson = false

    var body: some View {
        let company = model.companies().first { $0.id == key }
        ScrollView {
            if let company {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(spacing: 14) {
                        RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Palette.limeSoft)
                            .frame(width: 56, height: 56)
                            .overlay(Image(systemName: "building.2").font(.title3).foregroundStyle(Palette.ink))
                        Text(company.name).font(.title2.weight(.bold)).foregroundStyle(Palette.ink)
                    }
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            StatPill(value: Money.format(company.openValue, currency: model.currency), label: "open")
                            StatPill(value: Money.format(company.wonValue, currency: model.currency), label: "won")
                            StatPill(value: "\(company.people.count)", label: company.people.count == 1 ? "person" : "people")
                        }
                    }
                    HStack(spacing: 10) {
                        Button { newDeal = true } label: { Label("Deal", systemImage: "plus") }
                            .buttonStyle(SecondaryButtonStyle(compact: true))
                            .disabled(model.stages.isEmpty)
                        Button { newPerson = true } label: { Label("Person", systemImage: "person.badge.plus") }
                            .buttonStyle(SecondaryButtonStyle(compact: true))
                    }
                    Card {
                        CardTitle(title: "People", trailing: "\(company.people.count)")
                        if company.people.isEmpty {
                            Text("Nobody at \(company.name) yet.").font(.subheadline).foregroundStyle(Palette.ink2)
                        }
                        ForEach(company.people) { c in
                            NavigationLink(value: Route.contact(c.id)) { ContactRow(contact: c) }.buttonStyle(.plain)
                            if c.id != company.people.last?.id { Divider() }
                        }
                    }
                    Card {
                        CardTitle(title: "Deals", trailing: "\(company.deals.count)")
                        if company.deals.isEmpty {
                            Text("No deals with \(company.name) yet.").font(.subheadline).foregroundStyle(Palette.ink2)
                        }
                        ForEach(company.deals) { d in
                            NavigationLink(value: Route.deal(d.id)) { DealRow(deal: d) }.buttonStyle(.plain)
                            if d.id != company.deals.last?.id { Divider() }
                        }
                    }
                }
                .padding(16)
            } else {
                Card { EmptyState(icon: "building.2", title: "Nothing here any more") }.padding(16)
            }
        }
        .screenBackground()
        .navigationTitle(company?.name ?? "Company")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model.load() }
        .sheet(isPresented: $newDeal) {
            DealEditorSheet(initial: dealDraft(company?.name ?? "")) { _ in newDeal = false }.environmentObject(model)
        }
        .sheet(isPresented: $newPerson) {
            ContactEditorSheet(organization: company?.name ?? "") { newPerson = false }.environmentObject(model)
        }
    }

    private func dealDraft(_ org: String) -> DealDraft {
        var d = DealDraft()
        d.organization = org
        return d
    }
}

/// New person, or edit one.
struct ContactEditorSheet: View {
    let editing: ContactView?
    let onDone: () -> Void
    @EnvironmentObject private var model: PipelineModel
    @State private var draft: ContactDraft
    @State private var busy = false

    init(editing: ContactView? = nil, organization: String = "", onDone: @escaping () -> Void) {
        self.editing = editing
        self.onDone = onDone
        var initial = editing.map(ContactDraft.init) ?? ContactDraft()
        if editing == nil { initial.organization = organization }
        _draft = State(initialValue: initial)
    }

    var body: some View {
        SheetScaffold(
            title: editing == nil ? "New person" : "Edit person", action: editing == nil ? "Add person" : "Save",
            busy: busy, enabled: draft.isValid, onAction: save
        ) {
            Field(label: "Name", placeholder: "Full name", text: $draft.name, capitalization: .words)
            Field(label: "Organization", placeholder: "Company", text: $draft.organization)
            Field(label: "Job title", placeholder: "e.g. Head of Operations", text: $draft.jobTitle)
            Field(label: "Email", placeholder: "name@company.com", text: $draft.email, keyboard: .emailAddress, capitalization: .never)
            Field(label: "Phone", placeholder: "+1 555 0100", text: $draft.phone, keyboard: .phonePad, capitalization: .never)
        }
    }

    private func save() {
        busy = true
        Task {
            let ok: Bool
            if let editing {
                ok = await model.updateContact(editing.id, draft)
            } else {
                ok = await model.createContact(draft) != nil
            }
            busy = false
            if ok {
                Haptics.success()
                onDone()
            }
        }
    }
}
