import MeroKit
import MeroKitUI
import SwiftUI
import UpdatesCore

/// Signed in, no audience open: your companies, founding one, joining one.
struct CompaniesView: View {
    @StateObject private var model: CompaniesModel
    @Binding var path: [CompanyRoute]
    let applicationId: String?
    let onOpen: (AudienceSummary) -> Void
    let onSignOut: () -> Void
    @State private var creating = false
    @State private var joining = false
    @State private var approvals = false

    init(
        backend: any MeroAppBackend, applicationId: String?, path: Binding<[CompanyRoute]>,
        onOpen: @escaping (AudienceSummary) -> Void, onSignOut: @escaping () -> Void
    ) {
        _model = StateObject(wrappedValue: CompaniesModel(backend: backend))
        _path = path
        self.applicationId = applicationId
        self.onOpen = onOpen
        self.onSignOut = onSignOut
    }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    PageHeader(
                        title: "Your companies",
                        subtitle: "A company is a private space for investor relations. Invite someone once and they can read every audience inside it.")
                        .padding(.bottom, 4)
                    if let error = model.error { Card { ErrorLine(message: error) } }
                    if let note = model.hostingNote {
                        Card {
                            Label(note, systemImage: "exclamationmark.triangle")
                                .font(.footnote).foregroundStyle(Palette.warn)
                        }
                    }
                    if !model.hasLoaded {
                        SkeletonCard(height: 72)
                        SkeletonCard(height: 72)
                    } else if model.companies.isEmpty {
                        Card {
                            EmptyState(
                                icon: "square.stack.3d.up", title: "No companies yet",
                                message: "Founders: create yours below. Investors: open the invitation link a founder sent you.")
                        }
                    } else {
                        ForEach(model.companies) { company in
                            NavigationLink(value: CompanyRoute(company: company)) { CompanyRow(company: company) }
                                .buttonStyle(.plain)
                        }
                    }
                    VStack(spacing: 10) {
                        if model.hasRelay {
                            Button { creating = true } label: { Label("New company", systemImage: "plus") }
                                .buttonStyle(PrimaryButtonStyle())
                        }
                        Button { joining = true } label: {
                            Label("Join with an invitation", systemImage: "envelope.open")
                        }
                        .buttonStyle(SecondaryButtonStyle())
                    }
                    .padding(.top, 8)
                }
                .padding(16)
            }
            .screenBackground()
            .navigationTitle("Companies")
            .navigationBarTitleDisplayMode(.inline)
            .refreshable { await model.load() }
            .task { await model.load() }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { approvals = true } label: { Label("Approvals", systemImage: "checkmark.seal") }
                        Button(role: .destructive, action: onSignOut) {
                            Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                        }
                    } label: {
                        Image(systemName: "person.crop.circle").accessibilityLabel("Account")
                    }
                }
            }
            .navigationDestination(for: CompanyRoute.self) { route in
                CompanyView(
                    route: route, backend: model.backend, applicationId: applicationId, onOpen: onOpen)
            }
            .sheet(isPresented: $approvals) {
                ApprovalsSheet(style: .app, orgs: model.companies.map { ($0.id, $0.title) })
            }
            .sheet(isPresented: $creating) {
                NewCompanySheet(model: model) { company in
                    creating = false
                    path = [CompanyRoute(company: company)]
                }
            }
            .sheet(isPresented: $joining) {
                JoinSheet(backend: model.backend) { landing in
                    joining = false
                    switch landing {
                    case .audience(let audience): onOpen(audience)
                    case .company(let company): path = [CompanyRoute(company: company, justJoined: true)]
                    }
                }
            }
        }
    }
}

private struct CompanyRow: View {
    let company: CompanySummary

    var body: some View {
        HStack(spacing: 14) {
            IconTile(icon: "square.stack.3d.up", accent: true, size: 42)
            VStack(alignment: .leading, spacing: 2) {
                Text(company.title).font(.headline).foregroundStyle(Palette.ink)
                if company.memberCount > 0 {
                    Text("\(company.memberCount) member\(company.memberCount == 1 ? "" : "s")")
                        .font(.footnote).foregroundStyle(Palette.ink2)
                }
            }
            Spacer()
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Palette.ink3)
        }
        .padding(14)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Palette.hairline, lineWidth: 0.5))
        .contentShape(Rectangle())
    }
}

private struct NewCompanySheet: View {
    @ObservedObject var model: CompaniesModel
    let onCreated: (CompanySummary) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("Your updates and your investors' replies live on your and their nodes, nowhere else.")
                    .font(.subheadline).foregroundStyle(Palette.ink2)
                TextField("Your company's name — e.g. Acme Inc.", text: $name)
                    .focused($focused)
                    .submitLabel(.go)
                    .onSubmit(create)
                    .padding(12)
                    .background(Palette.sunken, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .onChange(of: name) { if $0.count > Limits.companyName { name = String($0.prefix(Limits.companyName)) } }
                if let error = model.error { ErrorLine(message: error) }
                Button(action: create) { Text(model.isWorking ? "Creating…" : "Create company") }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(model.isWorking || name.trimmingCharacters(in: .whitespaces).isEmpty)
                Spacer()
            }
            .padding(20)
            .navigationTitle("New company")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .onAppear {
                model.error = nil
                focused = true
            }
        }
        .presentationDetents([.medium])
    }

    private func create() {
        guard !model.isWorking, !name.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        Task {
            if let company = await model.create(name: name) {
                Haptics.success()
                onCreated(company)
            } else {
                Haptics.error()
            }
        }
    }
}

/// Paste an invitation link a founder sent you.
private struct JoinSheet: View {
    @EnvironmentObject private var session: MeroAppSession
    @StateObject private var model: CompaniesModel
    let onJoined: (InvitationLanding) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var link = ""
    @State private var invalid = false
    @FocusState private var focused: Bool

    init(backend: any MeroAppBackend, onJoined: @escaping (InvitationLanding) -> Void) {
        _model = StateObject(wrappedValue: CompaniesModel(backend: backend))
        self.onJoined = onJoined
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("Paste the invitation link a founder sent you.")
                    .font(.subheadline).foregroundStyle(Palette.ink2)
                TextField("Invitation link", text: $link, axis: .vertical)
                    .lineLimit(1...4)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focused)
                    .padding(12)
                    .background(Palette.sunken, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                if invalid { ErrorLine(message: UpdatesError.notAnInvitation.errorDescription ?? "") }
                if let error = model.error { ErrorLine(message: error) }
                Button(action: join) { Text(model.isWorking ? "Joining…" : "Join") }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(model.isWorking || link.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Spacer()
            }
            .padding(20)
            .navigationTitle("Join a company")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .onAppear { focused = true }
        }
        .presentationDetents([.medium])
    }

    private func join() {
        guard let invitation = UpdatesInvitation.parse(link) else {
            invalid = true
            Haptics.error()
            return
        }
        invalid = false
        Task {
            if let landing = await model.join(invitation) {
                await session.didJoinNamespace()
                Haptics.success()
                onJoined(landing)
            } else {
                Haptics.error()
            }
        }
    }
}

/// An invitation link the system handed the app: ask before joining.
struct InvitationSheet: View {
    let raw: String
    let onJoined: (InvitationLanding) -> Void
    @StateObject private var model: CompaniesModel
    @EnvironmentObject private var session: MeroAppSession

    init(raw: String, backend: any MeroAppBackend, onJoined: @escaping (InvitationLanding) -> Void) {
        self.raw = raw
        self.onJoined = onJoined
        _model = StateObject(wrappedValue: CompaniesModel(backend: backend))
    }

    var body: some View {
        let invitation = UpdatesInvitation.parse(raw)
        VStack(alignment: .leading, spacing: 18) {
            IconTile(icon: "envelope.open", accent: true, size: 56)
            Text(title(invitation)).font(Typeface.display(24)).foregroundStyle(Palette.ink)
            Text(
                "Joining makes your account a member of the company, and its updates sync to you from the team. You can read every audience in it."
            )
            .font(.subheadline).foregroundStyle(Palette.ink2)
            if invitation == nil { ErrorLine(message: UpdatesError.notAnInvitation.errorDescription ?? "") }
            if let error = model.error { ErrorLine(message: error) }
            Spacer()
            Button {
                guard let invitation else { return }
                Task {
                    if let landing = await model.join(invitation) {
                        Haptics.success()
                        onJoined(landing)
                    } else {
                        Haptics.error()
                    }
                }
            } label: {
                Text(model.isWorking ? "Joining…" : "Join")
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(invitation == nil || model.isWorking)
            Button("Not now") { session.dismissPendingInvitation() }
                .buttonStyle(SecondaryButtonStyle())
        }
        .padding(24)
        .presentationDetents([.medium, .large])
    }

    private func title(_ invitation: UpdatesInvitation?) -> String {
        if let name = invitation?.audienceName { return "Join \(name)?" }
        if let name = invitation?.companyName { return "Join \(name)?" }
        return "Join this company?"
    }
}
