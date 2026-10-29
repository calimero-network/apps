import MeroKit
import SwiftUI
import UpdatesCore

/// One company's audiences: open one, make one, invite people.
struct CompanyView: View {
    @StateObject private var model: CompanyModel
    let onOpen: (AudienceSummary) -> Void
    @State private var creating = false
    @State private var invite: InviteShare?

    init(
        route: CompanyRoute, backend: any MeroAppBackend, applicationId: String?,
        onOpen: @escaping (AudienceSummary) -> Void
    ) {
        _model = StateObject(
            wrappedValue: CompanyModel(
                company: route.company, backend: backend, applicationId: applicationId, justJoined: route.justJoined))
        self.onOpen = onOpen
    }

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text(model.company.title).font(Typeface.display(28)).foregroundStyle(Palette.ink)
                    Text(
                        "An audience is a feed of updates. Everyone invited to this company can open every audience in it — for something confidential, like a board, create a separate company and invite only the board."
                    )
                    .font(.subheadline).foregroundStyle(Palette.ink2)
                    HStack(spacing: 10) {
                        Button { creating = true } label: { Label("New audience", systemImage: "plus") }
                            .buttonStyle(PrimaryButtonStyle(compact: true))
                        Button {
                            Task {
                                if let invitation = await model.companyInvitation() {
                                    Haptics.success()
                                    invite = InviteShare(invitation: invitation, hint: companyHint)
                                }
                            }
                        } label: {
                            Label(model.pending == "invite" ? "Inviting…" : "Invite people", systemImage: "person.badge.plus")
                        }
                        .buttonStyle(SecondaryButtonStyle(compact: true))
                        .disabled(model.isWorking)
                    }
                    .padding(.top, 6)
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 8, leading: 4, bottom: 8, trailing: 4))
            }

            if let error = model.error {
                Section { ErrorLine(message: error) }
            }

            Section {
                if !model.hasLoaded {
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, 20)
                } else if model.isSyncing {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("Syncing this company's audiences. They appear as your relay catches up.")
                            .font(.subheadline).foregroundStyle(Palette.ink2)
                    }
                    .padding(.vertical, 8)
                } else if model.audiences.isEmpty {
                    EmptyState(
                        icon: "number", title: "No audiences yet",
                        message: "Most companies start with one called “All investors”.")
                } else {
                    ForEach(model.audiences) { audience in
                        Button { enter(audience) } label: { AudienceRow(audience: audience, busy: model.pending == "enter:\(audience.audienceId)") }
                            .buttonStyle(.plain)
                            .swipeActions(edge: .trailing) {
                                Button { inviteTo(audience) } label: { Label("Invite", systemImage: "person.badge.plus") }
                                    .tint(Palette.ink)
                            }
                            .contextMenu {
                                Button { inviteTo(audience) } label: {
                                    Label("Invite to this audience", systemImage: "person.badge.plus")
                                }
                            }
                    }
                }
            } header: {
                Text("Audiences")
            }

            Section {
                DetailsDisclosure(rows: [("Company (namespace) ID", model.company.id)])
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .screenBackground()
        .navigationTitle(model.company.title)
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model.load() }
        .task {
            await model.load()
            await model.syncWhileEmpty()
        }
        .sheet(isPresented: $creating) {
            NewAudienceSheet(model: model) { audience in
                creating = false
                onOpen(audience)
            }
        }
        .sheet(item: $invite) { share in InviteSheet(share: share) }
    }

    private var companyHint: String {
        "This link joins \(model.company.title) and every audience in it, including audiences made later. It lands them on the audience list — to drop someone straight into one audience, swipe that audience and choose Invite."
    }

    private func enter(_ audience: AudienceSummary) {
        Task {
            if let entered = await model.enter(audience) { onOpen(entered) }
        }
    }

    private func inviteTo(_ audience: AudienceSummary) {
        Task {
            if let invitation = await model.audienceInvitation(audience) {
                Haptics.success()
                invite = InviteShare(
                    invitation: invitation,
                    hint: "Opening the link puts them straight into \(audience.title). It joins \(model.company.title), which makes every audience in it reachable — access is inherited from the company, so this is not narrower than the company link.")
            }
        }
    }
}

private struct AudienceRow: View {
    let audience: AudienceSummary
    var busy = false

    var body: some View {
        HStack(spacing: 12) {
            IconTile(icon: "number", size: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(audience.title).font(.headline).foregroundStyle(Palette.ink)
                if audience.contextId == nil {
                    Text("Syncing…").font(.footnote).foregroundStyle(Palette.ink2)
                }
            }
            Spacer()
            if busy {
                ProgressView()
            } else {
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Palette.ink3)
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }
}

private struct NewAudienceSheet: View {
    @ObservedObject var model: CompanyModel
    let onCreated: (AudienceSummary) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("Everyone invited to the company can open it. You become its admin.")
                    .font(.subheadline).foregroundStyle(Palette.ink2)
                TextField("e.g. All investors, Angels, Advisors", text: $name)
                    .focused($focused)
                    .submitLabel(.go)
                    .onSubmit(create)
                    .padding(12)
                    .background(Palette.sunken, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .onChange(of: name) { if $0.count > Limits.name { name = String($0.prefix(Limits.name)) } }
                if let error = model.error { ErrorLine(message: error) }
                Button(action: create) { Text(model.pending == "create" ? "Creating…" : "Create audience") }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(model.isWorking || name.trimmingCharacters(in: .whitespaces).isEmpty)
                Spacer()
            }
            .padding(20)
            .navigationTitle("New audience")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .onAppear {
                model.error = nil
                if model.audiences.isEmpty && name.isEmpty { name = "All investors" }
                focused = true
            }
        }
        .presentationDetents([.medium])
    }

    private func create() {
        guard !model.isWorking, !name.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        Task {
            if let audience = await model.create(name: name) {
                Haptics.success()
                onCreated(audience)
            } else {
                Haptics.error()
            }
        }
    }
}

/// An invitation ready to send.
struct InviteShare: Identifiable {
    let invitation: UpdatesInvitation
    let hint: String
    var id: String { invitation.scope + hint }
    var link: String { (try? invitation.link()) ?? "" }
}

struct InviteSheet: View {
    let share: InviteShare
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Badge(title: share.invitation.scope, tone: .muted, icon: "person.badge.plus")
                Text(share.hint).font(.subheadline).foregroundStyle(Palette.ink2)
                Text(share.link)
                    .font(.caption.monospaced())
                    .foregroundStyle(Palette.ink)
                    .lineLimit(3)
                    .truncationMode(.middle)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Palette.sunken, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .textSelection(.enabled)
                Text("Links expire after 24 hours. Anyone with the link joins as a reader.")
                    .font(.footnote).foregroundStyle(Palette.ink3)
                if let url = URL(string: share.link) {
                    ShareLink(item: url) { Label("Share link", systemImage: "square.and.arrow.up") }
                        .buttonStyle(PrimaryButtonStyle())
                }
                Button {
                    UIPasteboard.general.string = share.link
                    copied = true
                    Haptics.success()
                } label: {
                    Label(copied ? "Copied" : "Copy link", systemImage: copied ? "checkmark" : "doc.on.doc")
                }
                .buttonStyle(SecondaryButtonStyle())
                Spacer()
            }
            .padding(20)
            .navigationTitle("Invitation ready")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }
}
