import SwiftUI
import UpdatesCore

/// The team, the investors, your profile and what you follow; for the team,
/// engagement and who read what.
struct PeopleTab: View {
    @ObservedObject var audience: AudienceModel
    @StateObject private var model: PeopleModel
    @State private var editingProfile = false
    @State private var confirm: PersonView?

    init(audience: AudienceModel) {
        self.audience = audience
        _model = StateObject(wrappedValue: PeopleModel(audience: audience))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    PageHeader(
                        title: "People",
                        subtitle: audience.isTeam
                            ? "Who is in this audience, and who is engaged with your updates."
                            : "The team and the other members of this audience.")
                    myProfile
                    if let error = model.error { Card { ErrorLine(message: error) } }
                    SectionLabel(title: "Team", trailing: "\(model.team.count)")
                    people(model.team, engagement: false)
                    SectionLabel(title: "Investors & advisors", trailing: "\(model.investors.count)")
                    if model.hasLoaded && model.investors.isEmpty {
                        Text("Nobody yet. Invite people from the account menu — anyone with the link joins as a reader.")
                            .font(.subheadline).foregroundStyle(Palette.ink2).padding(.horizontal, 4)
                    } else {
                        people(model.investors, engagement: audience.isTeam)
                    }
                    if audience.isTeam && !model.engagement.isEmpty {
                        SectionLabel(title: "Who read what")
                        ForEach(model.engagement) { EngagementCard(row: $0) }
                    }
                }
                .padding(16)
            }
            .screenBackground()
            .audienceToolbar(audience)
            .refreshable { await model.load() }
            .task(id: audience.version) { await model.load() }
            .sheet(isPresented: $editingProfile) { ProfileSheet(audience: audience) }
            .confirmationDialog(
                confirm.map { $0.isTeam ? "Remove \(People.label($0.name, $0.account)) from the team?" : "Make \(People.label($0.name, $0.account)) a teammate?" } ?? "",
                isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }),
                titleVisibility: .visible
            ) {
                if let person = confirm {
                    Button(person.isTeam ? "Remove from team" : "Make teammate", role: person.isTeam ? .destructive : nil) {
                        Task { await model.toggleTeam(person) }
                    }
                }
            } message: {
                Text("Teammates can publish updates, answer questions and see who offered help.")
            }
        }
    }

    @ViewBuilder private var myProfile: some View {
        if let me = audience.me {
            Card {
                HStack(spacing: 12) {
                    Avatar(account: me.account, name: me.name, team: me.isTeam, size: 44)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Signed in as").font(.caption).foregroundStyle(Palette.ink3)
                        HStack(spacing: 4) {
                            Text(People.label(me.name, me.account)).font(.headline).foregroundStyle(Palette.ink)
                            if !me.firm.isEmpty { Text("· \(me.firm)").font(.subheadline).foregroundStyle(Palette.ink2) }
                        }
                    }
                    Spacer()
                    Button { editingProfile = true } label: { Label("Edit", systemImage: "pencil") }
                        .buttonStyle(SecondaryButtonStyle(compact: true))
                }
                if !audience.categories.isEmpty {
                    Text("Categories you follow — muted ones stop counting as unread:")
                        .font(.footnote).foregroundStyle(Palette.ink2)
                    FlowChips(categories: audience.categories) { category in
                        Task { try? await audience.toggleMuted(category) }
                    }
                }
            }
        }
    }

    private func people(_ list: [PersonView], engagement: Bool) -> some View {
        Card(padding: 4) {
            ForEach(list) { person in
                PersonRow(
                    person: person, isSelf: person.account == audience.me?.account, engagement: engagement,
                    canManage: audience.isAdmin && !person.isAdmin, busy: model.pending == person.account
                ) { confirm = person }
                if person.id != list.last?.id { Divider().padding(.leading, 56) }
            }
        }
    }
}

private struct PersonRow: View {
    let person: PersonView
    let isSelf: Bool
    let engagement: Bool
    let canManage: Bool
    let busy: Bool
    let onManage: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Avatar(account: person.account, name: person.name, team: person.isTeam, size: 36)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(People.label(person.name, person.account)).font(.subheadline.weight(.semibold))
                        .foregroundStyle(Palette.ink)
                    if isSelf { Text("(you)").font(.footnote).foregroundStyle(Palette.ink3) }
                    if person.isAdmin { Badge(title: "Admin") }
                }
                if !person.firm.isEmpty { Text(person.firm).font(.footnote).foregroundStyle(Palette.ink2) }
                if engagement {
                    let pct = Format.percent(person.updatesRead, of: person.updatesTotal)
                    ProgressView(value: Double(pct), total: 100).tint(Palette.ink)
                    Text(PeopleModel.engagementLine(person)).font(.caption).foregroundStyle(Palette.ink2)
                }
            }
            Spacer(minLength: 4)
            if canManage {
                if busy {
                    ProgressView()
                } else {
                    Menu {
                        Button(action: onManage) {
                            if person.isTeam {
                                Label("Remove from team", systemImage: "person.badge.minus")
                            } else {
                                Label("Make teammate", systemImage: "person.badge.plus")
                            }
                        }
                    } label: {
                        Image(systemName: "ellipsis").frame(width: 32, height: 32).foregroundStyle(Palette.ink2)
                    }
                    .accessibilityLabel("Manage \(People.label(person.name, person.account))")
                }
            }
        }
        .padding(12)
    }
}

/// The categories as chips that wrap; a muted one is not selected.
private struct FlowChips: View {
    let categories: [CategoryView]
    let onToggle: (CategoryView) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(categories) { category in
                    CategoryChip(category: category, selected: !category.muted, suffix: category.muted ? " (muted)" : "") {
                        Haptics.tap()
                        onToggle(category)
                    }
                }
            }
        }
    }
}

/// One update: who read it, and who to follow up with.
private struct EngagementCard: View {
    let row: EngagementRow
    @State private var expanded = false

    var body: some View {
        let total = row.readers.count + row.notRead.count
        Card {
            DisclosureGroup(isExpanded: $expanded) {
                VStack(alignment: .leading, spacing: 12) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("READ").font(.caption2.weight(.semibold)).tracking(0.5).foregroundStyle(Palette.ink3)
                        if row.readers.isEmpty { Text("Nobody yet.").font(.footnote).foregroundStyle(Palette.ink3) }
                        ForEach(row.readers) { r in
                            Label {
                                Text("\(People.label(r.name, r.account)) · \(Format.timeAgo(r.firstAt))").font(.footnote)
                            } icon: {
                                Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.good)
                            }
                        }
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        Text("NOT YET — FOLLOW UP").font(.caption2.weight(.semibold)).tracking(0.5).foregroundStyle(Palette.ink3)
                        if row.notRead.isEmpty { Text("Everyone has read it.").font(.footnote).foregroundStyle(Palette.ink3) }
                        ForEach(row.notRead) { r in
                            Label {
                                Text(People.label(r.name, r.account) + (r.firm.isEmpty ? "" : " · \(r.firm)")).font(.footnote)
                            } icon: {
                                Image(systemName: "circle").foregroundStyle(Palette.ink3)
                            }
                        }
                    }
                }
                .padding(.top, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
            } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.title).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink)
                            .multilineTextAlignment(.leading)
                        Text(
                            "\(Format.formatDate(row.publishedAt)) · \(Format.plural(row.reactions, "reaction")) · \(Format.plural(row.comments, "reply", "replies")) · \(Format.plural(row.offers, "offer"))"
                        )
                        .font(.caption).foregroundStyle(Palette.ink2)
                    }
                    Spacer()
                    Text("\(row.readers.count)/\(total) read").font(.footnote.weight(.semibold).monospacedDigit())
                        .foregroundStyle(Palette.ink)
                }
            }
            .tint(Palette.ink2)
        }
    }
}
