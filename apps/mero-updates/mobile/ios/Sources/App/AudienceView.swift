import MeroKit
import SwiftUI
import UpdatesCore

/// The tabs, in order.
enum AudienceTab: Hashable {
    case updates, asks, questions, kpis, people
}

/// A post to open on a tab's navigation stack.
struct PostRoute: Hashable {
    let id: String
}

/// An open audience: bottom tabs, the live follow, and the account menu.
struct AudienceView: View {
    @StateObject private var model: AudienceModel
    let onSwitch: () -> Void
    let onSignOut: () -> Void
    @State private var tab: AudienceTab = .updates
    @State private var account = false
    @State private var settings = false
    @State private var composer: ComposerLaunch?
    @State private var openPost: String?

    init(
        audience: AudienceSummary, contextId: String, backend: any MeroAppBackend,
        onSwitch: @escaping () -> Void, onSignOut: @escaping () -> Void
    ) {
        _model = StateObject(wrappedValue: AudienceModel(audience: audience, contextId: contextId, backend: backend))
        self.onSwitch = onSwitch
        self.onSignOut = onSignOut
    }

    var body: some View {
        TabView(selection: $tab) {
            UpdatesTab(audience: model, openSettings: { settings = true }, openPost: $openPost)
                .tabItem { Label("Updates", systemImage: "tray.full") }
                .badge(Int(model.overview?.unreadUpdates ?? 0))
                .tag(AudienceTab.updates)
            AsksTab(audience: model)
                .tabItem { Label("Asks", systemImage: "hand.raised") }
                .badge(Int(model.overview?.openAsks ?? 0))
                .tag(AudienceTab.asks)
            QuestionsTab(audience: model)
                .tabItem { Label("Q&A", systemImage: "questionmark.bubble") }
                .badge(model.isTeam ? Int(model.overview?.openQuestions ?? 0) : 0)
                .tag(AudienceTab.questions)
            KpisTab(audience: model)
                .tabItem { Label("KPIs", systemImage: "chart.bar") }
                .tag(AudienceTab.kpis)
            PeopleTab(audience: model)
                .tabItem { Label("People", systemImage: "person.2") }
                .tag(AudienceTab.people)
        }
        .tint(Palette.ink)
        .environment(\.openAccount, { account = true })
        .environment(\.compose, { composer = ComposerLaunch(start: $0) })
        .task { await model.load() }
        .task { await model.follow() }
        .sheet(isPresented: $account) {
            AccountSheet(
                audience: model,
                openSettings: {
                    account = false
                    settings = true
                },
                onSwitch: {
                    account = false
                    onSwitch()
                },
                onSignOut: {
                    account = false
                    onSignOut()
                })
        }
        .sheet(isPresented: $settings) { SettingsView(audience: model) }
        .fullScreenCover(item: $composer) { launch in
            ComposerView(audience: model, start: launch.start) { id in
                composer = nil
                guard let id else { return }
                if case .edit = launch.start { return }
                tab = .updates
                openPost = id
            }
        }
    }
}

private struct OpenAccountKey: EnvironmentKey {
    static let defaultValue: () -> Void = {}
}

private struct ComposeKey: EnvironmentKey {
    static let defaultValue: (ComposerStart) -> Void = { _ in }
}

extension EnvironmentValues {
    /// Opens the composer from any screen (a new update, a draft, an edit).
    var compose: (ComposerStart) -> Void {
        get { self[ComposeKey.self] }
        set { self[ComposeKey.self] = newValue }
    }

    /// Opens the account sheet from any tab's toolbar.
    var openAccount: () -> Void {
        get { self[OpenAccountKey.self] }
        set { self[OpenAccountKey.self] = newValue }
    }
}

/// The leading toolbar button every tab shows: who you are, and the audience menu.
struct AccountButton: View {
    @ObservedObject var audience: AudienceModel
    @Environment(\.openAccount) private var openAccount

    var body: some View {
        Button(action: openAccount) {
            if let me = audience.me {
                Avatar(account: me.account, name: me.name, team: me.isTeam, size: 30)
            } else {
                Image(systemName: "person.crop.circle")
            }
        }
        .accessibilityLabel("Account and audience")
    }
}

extension View {
    /// The tab's title area: the company and audience, and the account button.
    func audienceToolbar(_ audience: AudienceModel) -> some View {
        toolbar {
            ToolbarItem(placement: .topBarLeading) { AccountButton(audience: audience) }
            ToolbarItem(placement: .principal) {
                VStack(spacing: 0) {
                    Text(audience.companyTitle).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink)
                    Text(audience.audience.title).font(.caption).foregroundStyle(Palette.ink2)
                }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// You, this audience, and the ways out of it.
private struct AccountSheet: View {
    @ObservedObject var audience: AudienceModel
    let openSettings: () -> Void
    let onSwitch: () -> Void
    let onSignOut: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var editingProfile = false
    @State private var invite: InviteShare?
    @State private var inviting = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 12) {
                        Avatar(
                            account: audience.me?.account ?? "", name: audience.me?.name ?? "",
                            team: audience.isTeam, size: 44)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(People.label(audience.me?.name ?? "", audience.me?.account ?? ""))
                                .font(.headline).foregroundStyle(Palette.ink)
                            Text(subtitle).font(.footnote).foregroundStyle(Palette.ink2)
                        }
                        Spacer()
                        if let role = audience.roleLabel {
                            Badge(title: role, tone: audience.isTeam ? .lime : .muted)
                        }
                    }
                    Button { editingProfile = true } label: { Label("Edit your profile", systemImage: "pencil") }
                }
                Section("This audience") {
                    LabeledContent("Company", value: audience.companyTitle)
                    LabeledContent("Audience", value: audience.audience.title)
                    if audience.isTeam {
                        Button(action: openSettings) { Label("Settings", systemImage: "gearshape") }
                        Button(action: makeInvite) {
                            Label(inviting ? "Inviting…" : "Invite to this audience", systemImage: "person.badge.plus")
                        }
                        .disabled(inviting)
                    }
                    Button(action: onSwitch) {
                        Label("Switch audience", systemImage: "arrow.left.arrow.right")
                    }
                    if let error { ErrorLine(message: error) }
                }
                Section {
                    DetailsDisclosure(rows: [
                        ("Your account", audience.me?.account ?? "—"),
                        ("Audience context ID", audience.contextId),
                        ("Audience (subgroup) ID", audience.audience.audienceId),
                        ("Company (namespace) ID", audience.audience.companyId),
                    ])
                }
                Section {
                    Button(role: .destructive, action: onSignOut) {
                        Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                }
            }
            .navigationTitle("Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .sheet(isPresented: $editingProfile) { ProfileSheet(audience: audience) }
            .sheet(item: $invite) { InviteSheet(share: $0) }
        }
    }

    private var subtitle: String {
        if let firm = audience.me?.firm, !firm.isEmpty { return firm }
        if audience.isAdmin { return "Company admin" }
        return audience.isTeam ? "Company team" : "Reader"
    }

    private func makeInvite() {
        inviting = true
        Task {
            defer { inviting = false }
            do {
                let invitation = try await audience.invitation()
                Haptics.success()
                invite = InviteShare(
                    invitation: invitation,
                    hint: "Opening the link puts them straight into \(audience.audience.title). It joins the company, which makes every audience in it reachable.")
                error = nil
            } catch {
                self.error = ErrorText.describe(error)
            }
        }
    }
}

/// "Tell your investors who you are": name and firm (or role).
struct ProfileSheet: View {
    @ObservedObject var audience: AudienceModel
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var firm = ""
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                Text(
                    audience.isTeam
                        ? "Your name goes on every update you publish."
                        : "The team sees who read, reacted and offered to help — as a name, not an account id."
                )
                .font(.subheadline).foregroundStyle(Palette.ink2)
                InputField(placeholder: "Your name", text: $name, limit: Limits.name)
                InputField(
                    placeholder: audience.isTeam ? "Role (e.g. CEO)" : "Fund or firm (optional)", text: $firm,
                    limit: Limits.name)
                if let error { ErrorLine(message: error) }
                Button(action: save) { Text(saving ? "Saving…" : "Save") }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(saving || name.trimmingCharacters(in: .whitespaces).isEmpty)
                Spacer()
            }
            .padding(20)
            .navigationTitle(audience.isTeam ? "Tell your investors who you are" : "Tell the team who you are")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .onAppear {
                name = audience.me?.name ?? ""
                firm = audience.me?.firm ?? ""
            }
        }
        .presentationDetents([.medium])
    }

    private func save() {
        saving = true
        Task {
            defer { saving = false }
            do {
                try await audience.setProfile(name: name, firm: firm)
                Haptics.success()
                dismiss()
            } catch {
                self.error = ErrorText.describe(error)
                Haptics.error()
            }
        }
    }
}
