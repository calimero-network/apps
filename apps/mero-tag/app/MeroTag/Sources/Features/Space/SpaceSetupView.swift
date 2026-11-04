import SwiftUI

/// After sign-in: create a space, or join one from an invite link. Opening a
/// space by its raw ID stays available behind the technical details.
struct SpaceSetupView: View {
    @EnvironmentObject private var app: AppState
    @State private var displayName = ""
    @State private var spaceName = ""
    @State private var inviteText = ""
    @State private var appId = ""
    @State private var showsIdEntry = false
    @State private var confirmSignOut = false

    private var invite: SpaceInvite? { SpaceInvite.decode(pasted: inviteText) }
    private var isBusy: Bool { app.isCreatingSpace || app.isJoiningSpace || app.isOpeningSpace }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Tag.Space.stack) {
                    PageHeader(
                        title: "Choose a space",
                        subtitle: "A space is the group you share locations with. Start your own, or join one "
                            + "with the invite link someone sent you.")

                    Card {
                        TagTextField(
                            label: "Your name", placeholder: "e.g. Ana", text: $displayName,
                            help: "Shown to the other members of the space.", submitLabel: .done)
                            .accessibilityIdentifier("displayNameField")
                    }

                    if let error = app.spaceError {
                        Callout(tone: .danger, message: error)
                            .accessibilityIdentifier("spaceError")
                    }

                    if app.unreachableSpace != nil {
                        LoadingButton(
                            title: "Try again", systemImage: "arrow.clockwise", isLoading: app.isOpeningSpace,
                            action: { Task { await app.retryUnreachableSpace() } })
                            .disabled(isBusy)
                            .accessibilityIdentifier("retrySpaceButton")
                    }

                    SectionLabel(title: "Join with an invite")
                    joinCard

                    SectionLabel(title: "Start a new space")
                    createCard

                    Card {
                        VStack(alignment: .leading, spacing: 0) {
                            TechnicalDetails(items: AccountDetails.items(app), showsDivider: false)
                            Hairline().padding(.vertical, 12)
                            openByIdDisclosure
                        }
                    }
                }
                .tagPage()
            }
            .background(Tag.bg.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .tagTrailing) {
                    Button("Sign out") { confirmSignOut = true }
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(Tag.textDim)
                }
            }
            .inlineNavigationTitle()
            .tagNavigationBar()
            .confirmationDialog("Sign out of Mero Tag?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) { Task { await app.signOut() } }
            }
        }
        .onAppear {
            if displayName.isEmpty { displayName = app.space?.displayName ?? "" }
            if appId.isEmpty { appId = app.space?.appId ?? "" }
            if let pending = app.pendingInvite { inviteText = pending }
        }
        .onChange(of: app.pendingInvite) { _, pending in
            if let pending { inviteText = pending }
        }
    }

    // MARK: Join

    private var joinCard: some View {
        Card {
            VStack(alignment: .leading, spacing: 16) {
                CardHeader(
                    systemImage: "envelope.open", title: "Invite link",
                    meta: "Joins with your account", accent: invite != nil)

                HStack(alignment: .bottom, spacing: 8) {
                    TagTextField(
                        label: "Link", placeholder: "Paste the invite link", text: $inviteText,
                        monospaced: true, keyboardKind: .identifier, submitLabel: .go, onSubmit: join)
                        .accessibilityIdentifier("inviteField")
                    Button {
                        if let pasted = Platform.pastedString() { inviteText = pasted }
                    } label: {
                        Label("Paste", systemImage: "doc.on.clipboard")
                    }
                    .buttonStyle(.tag(.secondary, size: .regular, fullWidth: false))
                    .padding(.bottom, 4)
                    .accessibilityIdentifier("pasteInviteButton")
                }

                if let invite {
                    Callout(
                        tone: .success, title: invite.spaceName.isEmpty ? "Invite recognised" : "Invite to \(invite.spaceName)",
                        message: "You'll join its organization with your account, then the space opens.")
                } else if !inviteText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Callout(tone: .warning, message: "That doesn't look like a Mero Tag invite link.")
                }

                LoadingButton(
                    title: "Join space", systemImage: "arrow.right", isLoading: app.isJoiningSpace, action: join)
                    .disabled(invite == nil || displayName.isEmpty || isBusy)
                    .accessibilityIdentifier("joinSpaceButton")
            }
        }
    }

    // MARK: Create

    private var createCard: some View {
        Card {
            VStack(alignment: .leading, spacing: 16) {
                CardHeader(
                    systemImage: "plus.circle", title: "Create a space",
                    meta: "You'll be its owner, and can invite people")

                TagTextField(
                        label: "Space name", placeholder: "e.g. Family", text: $spaceName,
                        submitLabel: .go, onSubmit: create)
                        .accessibilityIdentifier("spaceNameField")

                    LoadingButton(
                        title: "Create space", systemImage: "plus", isLoading: app.isCreatingSpace,
                        kind: .secondary, action: create)
                        .disabled(spaceName.isEmpty || displayName.isEmpty || isBusy)
                        .accessibilityIdentifier("createSpaceButton")
            }
        }
    }

    // MARK: Open by ID

    /// The raw-ID path, for developers and for spaces made elsewhere.
    private var openByIdDisclosure: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button {
                withAnimation(.easeOut(duration: 0.18)) { showsIdEntry.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .semibold))
                        .rotationEffect(.degrees(showsIdEntry ? 90 : 0))
                    Text("Open a space by ID").font(Tag.Typeface.label)
                    Spacer()
                }
                .foregroundStyle(Tag.textFaint)
                .frame(minHeight: 28)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("openByIdToggle")

            if showsIdEntry {
                TagTextField(
                    label: "Space ID", placeholder: "Paste the space ID", text: $appId,
                    help: "The app instance ID of a space your account can already reach.", monospaced: true,
                    keyboardKind: .identifier, submitLabel: .go, onSubmit: open)
                    .accessibilityIdentifier("spaceIdField")
                LoadingButton(
                    title: "Open space", systemImage: "arrow.right", isLoading: app.isOpeningSpace,
                    kind: .secondary, size: .regular, action: open)
                    .disabled(appId.isEmpty || displayName.isEmpty || isBusy)
                    .accessibilityIdentifier("openSpaceButton")
            }
        }
    }

    // MARK: Actions

    private func join() {
        guard invite != nil else { return }
        Task { await app.joinSpace(invite: inviteText, displayName: displayName) }
    }

    private func create() {
        Task { await app.createSpace(name: spaceName, displayName: displayName) }
    }

    private func open() {
        Task { await app.openSpace(appId: appId, displayName: displayName) }
    }
}

/// The account/session values worth showing behind "Show technical details".
enum AccountDetails {
    @MainActor
    static func items(_ app: AppState, appId: String? = nil) -> [DetailItem] {
        var items: [DetailItem] = []
        if let appId { items.append(DetailItem(label: "Space (app instance) ID", value: appId)) }
        if let org = app.me?.org { items.append(DetailItem(label: "Organization", value: org)) }
        if let role = app.me?.orgRole { items.append(DetailItem(label: "Your role", value: role, copyable: false)) }
        if let account = app.account { items.append(DetailItem(label: "Account", value: account)) }
        if let node = app.nodeURL { items.append(DetailItem(label: "Cluster node", value: node)) }
        if app.isDevelopmentCluster {
            items.append(DetailItem(label: "Attestation", value: "Mock (development cluster)", copyable: false))
        }
        return items
    }
}
