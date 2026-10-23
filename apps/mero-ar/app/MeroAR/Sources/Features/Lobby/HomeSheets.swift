import SwiftUI

#if canImport(UIKit) && os(iOS)
import UIKit
#endif

// MARK: - Invite link

/// Mint an invite link on demand, then share or copy it. Used for a whole
/// home (lobby) and for the open room (People).
struct InviteLinkCard: View {
    let title: String
    let subtitle: String
    let mint: () async throws -> String

    /// The link, once minted. Held so a second tap does not mint another.
    @State private var link: String?
    @State private var minting = false
    @State private var error: String?
    @State private var copied = false

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 12) {
                    IconTile(systemName: "person.badge.plus", size: 42, gradient: true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title).font(Theme.title(17)).foregroundStyle(Theme.text)
                        Text(subtitle).font(.system(size: 13)).foregroundStyle(Theme.textFaint)
                    }
                }
                if let link {
                    HStack(spacing: 10) {
                        Image(systemName: "link").font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.accent)
                        Text(link)
                            .font(.system(size: 13, design: .monospaced))
                            .foregroundStyle(Theme.textDim)
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .textSelection(.enabled)
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.black.opacity(0.25)))
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Invite link")
                    .accessibilityValue(link)
                    .accessibilityIdentifier("inviteLink")
                    HStack(spacing: 10) {
                        ShareLink(item: link) {
                            ButtonLabel(title: "Share", icon: "square.and.arrow.up")
                        }
                        .buttonStyle(PrimaryButtonStyle(height: 46))
                        .accessibilityIdentifier("shareInviteButton")
                        Button {
                            #if canImport(UIKit) && os(iOS)
                            UIPasteboard.general.string = link
                            #endif
                            Haptics.success()
                            copied = true
                        } label: {
                            ButtonLabel(title: copied ? "Copied" : "Copy link", icon: copied ? "checkmark" : "doc.on.doc")
                        }
                        .buttonStyle(GlassButtonStyle(height: 46))
                        .accessibilityIdentifier("copyInviteButton")
                    }
                } else {
                    Button {
                        Haptics.tap()
                        Task { await create() }
                    } label: {
                        ButtonLabel(title: "Create invite link", icon: "link", isLoading: minting)
                    }
                    .buttonStyle(PrimaryButtonStyle(height: 50))
                    .disabled(minting)
                    .accessibilityIdentifier("createInviteButton")
                }
                if let error {
                    Callout(tone: .danger, message: error)
                }
            }
        }
    }

    private func create() async {
        minting = true
        error = nil
        defer { minting = false }
        do {
            link = try await mint()
            Haptics.success()
        } catch {
            self.error = userMessage(error)
        }
    }
}

// MARK: - Nickname

/// Choose the nickname people see in rooms: asked once after sign-in, and
/// changeable from Settings or People.
struct NicknameSheet: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    /// First run: no close button, and the sheet can't be swiped away.
    var isFirstRun = false
    @State private var draft = ""
    @State private var saving = false

    private var trimmed: String { draft.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            if isFirstRun {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Pick a nickname").font(Theme.display(28)).tracking(-0.6).foregroundStyle(Theme.text)
                    Text("It's how people see you in every room: on the roster, your notes and what you place.")
                        .font(.system(size: 15)).foregroundStyle(Theme.textDim)
                }
                .padding(.top, 8)
            } else {
                SheetHeader(title: "Your nickname", subtitle: "Shown to everyone in your rooms.")
            }
            HStack(spacing: 14) {
                Avatar(id: app.client.account ?? app.nodeURL ?? "", name: trimmed.isEmpty ? "?" : trimmed, size: 52, me: true)
                TextInput(placeholder: "Alex", text: $draft, icon: "person.fill", identifier: "nicknameInput")
                    .submitLabel(.done)
                    .onSubmit(save)
            }
            Text("\(trimmed.count)/32").font(.system(size: 12)).foregroundStyle(Theme.textFaint)
                .frame(maxWidth: .infinity, alignment: .trailing)
            Button(action: save) {
                ButtonLabel(title: isFirstRun ? "Continue" : "Save", icon: "checkmark", isLoading: saving)
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(trimmed.isEmpty || trimmed.count > 32 || saving)
            .accessibilityIdentifier("saveNicknameButton")
            Spacer(minLength: 0)
        }
        .padding(24)
        .preferredColorScheme(.dark)
        .interactiveDismissDisabled(isFirstRun)
        .onAppear { draft = app.displayName }
    }

    private func save() {
        guard !trimmed.isEmpty, trimmed.count <= 32, !saving else { return }
        Haptics.success()
        saving = true
        Task {
            await app.setNickname(trimmed)
            saving = false
            dismiss()
        }
    }
}

// MARK: - New home

/// Found a home (a namespace) and its first room, then enter the room.
struct CreateHomeSheet: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var home = ""
    @State private var room = "Living room"

    private var ready: Bool {
        !home.trimmingCharacters(in: .whitespaces).isEmpty && !room.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                SheetHeader(
                    title: "New home",
                    subtitle: "A home is a shared space for your rooms. Invite people to it, and they can open "
                        + "every room inside.")
                Field(label: "Home name", hint: "Like your flat, the office, or a project.") {
                    TextInput(placeholder: "Our flat", text: $home, icon: "house.fill", identifier: "homeNameInput")
                        .submitLabel(.go)
                        .onSubmit(create)
                }
                Field(label: "First room") {
                    TextInput(placeholder: "Living room", text: $room, icon: "cube.transparent", identifier: "roomNameInput")
                        .submitLabel(.go)
                        .onSubmit(create)
                }
                if let error = app.roomError {
                    Callout(tone: .danger, message: error).accessibilityIdentifier("createError")
                }
                Button(action: create) {
                    ButtonLabel(title: app.isCreating ? "Creating…" : "Create and enter", icon: "sparkles", isLoading: app.isCreating || app.isEntering)
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!ready || app.isCreating || app.isEntering)
                .accessibilityIdentifier("confirmCreateHomeButton")
                Label(
                    app.isNodeSession ? "Created on your node. You'll be its admin." : "Created with your Calimero account. You'll be its admin.",
                    systemImage: "checkmark.shield.fill"
                )
                .font(.system(size: 12.5))
                .foregroundStyle(Theme.textFaint)
            }
            .padding(24)
        }
        .preferredColorScheme(.dark)
        .onAppear { app.roomError = nil }
    }

    private func create() {
        guard ready, !app.isCreating, !app.isEntering else { return }
        Haptics.tap()
        Task {
            await app.createHome(named: home, firstRoom: room)
            if app.roomError == nil { dismiss() }
        }
    }
}

// MARK: - New room

/// Name a new room in a home.
struct CreateRoomSheet: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    let home: Home
    @State private var name = ""

    private static let suggestions = ["Living room", "Bedroom", "Kitchen", "Office", "Studio"]

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            SheetHeader(title: "New room", subtitle: "In \(home.name.isEmpty ? "this home" : home.name). Everyone in the home can open it.")
            TextInput(placeholder: "Bedroom", text: $name, icon: "cube.transparent", identifier: "roomNameInput")
                .submitLabel(.go)
                .onSubmit(create)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Self.suggestions.filter { s in !home.rooms.contains { $0.name == s } }, id: \.self) { suggestion in
                        Button {
                            Haptics.soft()
                            name = suggestion
                        } label: {
                            Text(suggestion)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Theme.text)
                                .padding(.horizontal, 14).padding(.vertical, 8)
                                .glassCapsule()
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            if let error = app.roomError {
                Callout(tone: .danger, message: error)
            }
            Button(action: create) {
                ButtonLabel(title: "Create and enter", icon: "sparkles", isLoading: app.isCreating || app.isEntering)
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || app.isCreating || app.isEntering)
            .accessibilityIdentifier("confirmCreateRoomButton")
            Spacer(minLength: 0)
        }
        .padding(24)
        .preferredColorScheme(.dark)
        .onAppear { app.roomError = nil }
    }

    private func create() {
        guard !name.trimmingCharacters(in: .whitespaces).isEmpty, !app.isCreating, !app.isEntering else { return }
        Haptics.tap()
        Task {
            await app.createRoom(named: name, inHome: home.id)
            if app.roomError == nil { dismiss() }
        }
    }
}

// MARK: - Invite to a home

/// Invite someone to a home: they can open every room in it.
struct HomeInviteSheet: View {
    @EnvironmentObject private var app: AppState
    let home: Home

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                SheetHeader(title: "Invite to \(home.name.isEmpty ? "this home" : home.name)")
                InviteLinkCard(
                    title: "Invite someone",
                    subtitle: "They join the home and can open all of its rooms. Send the link any way you like."
                ) {
                    try await app.inviteLink(toHome: home)
                }
                VStack(alignment: .leading, spacing: 10) {
                    step(1, "Send them the link.")
                    step(2, "They sign in to Mero AR and paste it with Join.")
                    step(3, "They pick a nickname, then the home and its rooms appear in their lobby.")
                }
                .padding(18)
                .glass(cornerRadius: 20)
            }
            .padding(24)
        }
        .preferredColorScheme(.dark)
    }

    private func step(_ n: Int, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(n)")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 22, height: 22)
                .background(Circle().fill(Theme.aurora))
            Text(text).font(.system(size: 14)).foregroundStyle(Theme.textDim)
        }
    }
}
