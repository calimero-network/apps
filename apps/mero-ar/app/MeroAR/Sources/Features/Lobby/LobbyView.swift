import MeroKitUI
import SwiftUI

/// After sign-in: pick a room. Paste an invitation (or a room ID), or continue
/// in the last room. Session details live in the account menu, behind a
/// technical-details disclosure.
struct LobbyView: View {
    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var client: MeroClient

    @State private var input = ""
    @State private var showAccount = false

    private var looksLikeInvite: Bool { RoomInvite.looksLikeInvite(input) }

    var body: some View {
        VStack(spacing: 0) {
            topBar
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Rooms")
                            .font(.system(size: 26, weight: .bold))
                            .tracking(-0.5)
                            .foregroundStyle(Theme.ink)
                        Text("Join a shared room to place objects together. Rooms open by invitation.")
                            .font(.system(size: 14))
                            .foregroundStyle(Theme.textDim)
                    }
                    .padding(.top, 20)
                    .padding(.bottom, 4)

                    notices

                    if !app.lastRoomId.isEmpty {
                        recentRoom
                    }

                    joinCard
                }
                .padding(.horizontal, Theme.gutter)
                .padding(.bottom, 32)
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(ScreenBackground())
        .sheet(isPresented: $showAccount) {
            AccountSheet()
                .presentationDetents([.medium, .large])
        }
    }

    // MARK: - Chrome

    private var topBar: some View {
        HStack(spacing: 12) {
            BrandLockup()
            Spacer()
            Button {
                showAccount = true
            } label: {
                Avatar(id: client.account ?? "", name: app.effectiveDisplayName, size: 32, me: true)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Account")
            .accessibilityIdentifier("accountButton")
        }
        .padding(.horizontal, Theme.gutter)
        .frame(height: 56)
        .background(Theme.surface.ignoresSafeArea(edges: .top))
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.border).frame(height: 1) }
    }

    @ViewBuilder private var notices: some View {
        if client.isSignedInWithoutRelay {
            Callout(
                tone: .info, title: "No relay yet",
                message: "Your account gets a relay when you redeem your first invitation. Paste one below.")
        } else if let note = client.cloudNote {
            Callout(tone: .warning, title: "Limited connection", message: note)
        }
    }

    // MARK: - Recent room

    private var recentRoom: some View {
        Card(padding: 0) {
            Button {
                Haptics.tap()
                Task { await app.enter(roomOrInvite: app.lastRoomId) }
            } label: {
                HStack(spacing: 12) {
                    IconTile(systemName: "cube", accent: true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(app.lastRoomName.isEmpty ? "Your last room" : app.lastRoomName)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Theme.ink)
                            .lineLimit(1)
                        Text("Continue where you left off")
                            .font(.system(size: 12.5))
                            .foregroundStyle(Theme.textFaint)
                    }
                    Spacer()
                    if app.isEntering && input.isEmpty {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.textFaint)
                    }
                }
                .padding(.horizontal, 20)
                .frame(minHeight: 64)
                .contentShape(Rectangle())
            }
            .buttonStyle(RowButtonStyle())
            .disabled(app.isEntering)
            .accessibilityIdentifier("recentRoomButton")
        }
    }

    // MARK: - Join

    private var joinCard: some View {
        Card {
            VStack(alignment: .leading, spacing: 18) {
                CardHeader(
                    icon: "envelope.open", title: "Join a room",
                    meta: "Paste the invite link someone sent you")

                Field(
                    label: "Invite link or room ID",
                    hint: looksLikeInvite ? nil : "An invite joins you to the room's space first; a room ID opens a room you're already in."
                ) {
                    TextInput(
                        placeholder: "https://links.calimero.network/…", text: $input,
                        icon: looksLikeInvite ? "checkmark.seal" : "link", identifier: "roomInput")
                }

                if looksLikeInvite {
                    Callout(
                        tone: .success, title: inviteTitle,
                        message: "You'll join the room's space with your Calimero account, then enter.")
                }

                Field(label: "Your name in rooms", hint: "Shown to others in the room.") {
                    TextInput(
                        placeholder: app.effectiveDisplayName, text: $app.displayName, icon: "person",
                        identifier: "displayNameInput")
                }

                if let error = app.roomError {
                    Callout(tone: .danger, title: "Couldn't open the room", message: error)
                        .accessibilityIdentifier("roomError")
                }

                Button {
                    Haptics.tap()
                    Task { await app.enter(roomOrInvite: input) }
                } label: {
                    ButtonLabel(
                        title: looksLikeInvite ? "Join and enter" : "Enter room", icon: "arrow.right",
                        isLoading: app.isEntering && !input.isEmpty)
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(input.trimmingCharacters(in: .whitespaces).isEmpty || app.isEntering)
                .accessibilityIdentifier("enterRoomButton")
            }
        }
    }

    private var inviteTitle: String {
        if let name = RoomInvite.decode(pasted: input)?.roomName, !name.isEmpty {
            return "Invite to \(name)"
        }
        return "Invite recognised"
    }
}

/// Flush list row: pressed = hover surface.
struct RowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? Theme.surfaceHover : Color.clear)
    }
}

/// The signed-in account: who, which relay, sign out.
struct AccountSheet: View {
    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var client: MeroClient
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Card {
                        VStack(alignment: .leading, spacing: 16) {
                            HStack(spacing: 12) {
                                Avatar(id: client.account ?? "", name: app.effectiveDisplayName, size: 44, me: true)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(app.effectiveDisplayName)
                                        .font(.system(size: 16, weight: .semibold))
                                        .foregroundStyle(Theme.ink)
                                    HStack(spacing: 6) {
                                        Circle()
                                            .fill(client.relayURL == nil ? Theme.warning : Theme.accent)
                                            .frame(width: 8, height: 8)
                                        Text(client.relayURL == nil ? "Signed in, no relay yet" : "Connected to your relay")
                                            .font(.system(size: 12.5))
                                            .foregroundStyle(Theme.textFaint)
                                    }
                                }
                            }
                            TechnicalDetails(rows: detailRows)
                        }
                    }

                    Button {
                        Task {
                            dismiss()
                            await app.signOut()
                        }
                    } label: {
                        ButtonLabel(title: "Sign out", icon: "rectangle.portrait.and.arrow.right")
                    }
                    .buttonStyle(SecondaryButtonStyle(destructive: true))
                    .accessibilityIdentifier("signOutButton")

                    Text("Signing out keeps this device's key, so signing back in is one passkey prompt.")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textFaint)
                }
                .padding(Theme.gutter)
            }
            .background(ScreenBackground())
            .navigationTitle("Account")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.foregroundStyle(Theme.ink)
                }
            }
        }
    }

    private var detailRows: [(label: String, value: String)] {
        var rows: [(label: String, value: String)] = []
        if let account = client.account { rows.append(("Account", account)) }
        if let device = client.connection?.session.device { rows.append(("Device", device)) }
        if let relay = client.relayURL { rows.append(("Relay", relay)) }
        if let key = client.connection?.nodeKey { rows.append(("Relay node key", key)) }
        return rows
    }
}
