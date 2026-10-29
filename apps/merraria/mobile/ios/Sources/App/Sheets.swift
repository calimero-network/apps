import MeroKit
import MerrariaCore
import SwiftUI
import UIKit

/// Create world: a name and a seed, as the web app's "Create world" asks.
struct NewWorldSheet: View {
    let onCreate: (String, UInt64) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = MerrariaConstants.defaultWorldName
    @State private var seed = String(MerrariaConstants.randomSeed())
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(MerrariaConstants.defaultWorldName, text: $name)
                        .textInputAutocapitalization(.never)
                        .submitLabel(.done)
                        .onChange(of: name) { value in
                            if value.count > MerrariaConstants.maxWorldName {
                                name = String(value.prefix(MerrariaConstants.maxWorldName))
                            }
                        }
                } header: {
                    Text("World name")
                } footer: {
                    Text("Friends you invite see this name.")
                }
                Section {
                    HStack {
                        TextField("1337", text: $seed).keyboardType(.numberPad).font(Theme.mono)
                        Button {
                            Haptics.select()
                            seed = String(MerrariaConstants.randomSeed())
                        } label: {
                            Image(systemName: "dice")
                        }
                        .accessibilityLabel("Random seed")
                    }
                } header: {
                    Text("Seed")
                } footer: {
                    Text("The terrain grows from the seed: the same seed makes the same world.")
                }
                if let error {
                    Section { Text(error).foregroundStyle(Theme.danger) }
                }
                Section {
                    Button {
                        create()
                    } label: {
                        HStack(spacing: 10) {
                            if busy { ProgressView().tint(Theme.ink) }
                            Text(busy ? "Creating…" : "Create world")
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(busy)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.ground)
            .navigationTitle("Create world")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) }
            }
        }
        .interactiveDismissDisabled(busy)
    }

    private func create() {
        Haptics.tap()
        busy = true
        error = nil
        Task {
            do {
                try await onCreate(name, MerrariaConstants.seed(from: seed, fallback: MerrariaConstants.randomSeed()))
                Haptics.success()
                dismiss()
            } catch {
                self.error = MerrariaText.error(error)
            }
            busy = false
        }
    }
}

/// Join with a link pasted from a message.
struct PasteLinkSheet: View {
    let onInvitation: (WorldInvitation) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://links.calimero.network/…", text: $text, axis: .vertical)
                        .lineLimit(2...4)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .font(Theme.mono)
                    Button {
                        if let pasted = UIPasteboard.general.string { text = pasted }
                    } label: {
                        Label("Paste", systemImage: "doc.on.clipboard")
                    }
                } header: {
                    Text("Invitation link")
                } footer: {
                    Text("Paste the link a friend shared with you. You'll be asked before anything is joined.")
                }
                if let error {
                    Section { Text(error).foregroundStyle(Theme.danger) }
                }
                Section {
                    Button("Continue") {
                        if let invitation = WorldInvitation.parse(text) {
                            onInvitation(invitation)
                        } else {
                            Haptics.warning()
                            error = MerrariaError.notAnInvitation.errorDescription
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.ground)
            .navigationTitle("Join with a link")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
    }
}

/// "Join this world?", asked before an invitation acts on the player's behalf: joining binds their
/// account to a world someone else chose.
struct JoinSheet: View {
    let invitation: WorldInvitation
    let onJoin: () async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 14) {
                    AppMark(size: 48)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Join \(invitation.worldName ?? "this world")?").font(Theme.heading(22))
                            .foregroundStyle(Theme.ink)
                        Text("You've been invited to play Merraria.").font(Theme.body(14)).foregroundStyle(Theme.muted)
                    }
                }
                Text("Joining adds your account to this world, and opens it. Everyone in it sees your digging and building.")
                    .font(Theme.body(15)).foregroundStyle(Theme.ink2)
                DisclosureGroup("Details") {
                    VStack(spacing: 12) {
                        DetailRow(label: "Namespace", value: invitation.namespaceId)
                        if let contextId = invitation.contextId { DetailRow(label: "World (context)", value: contextId) }
                        if let groupId = invitation.groupId { DetailRow(label: "Group", value: groupId) }
                    }
                    .padding(.top, 8)
                }
                .font(Theme.body(14, .semibold))
                .tint(Theme.ink)
                if let error { ErrorBanner(message: error) { self.error = nil } }
                HStack(spacing: 10) {
                    Button("Not now") { dismiss() }
                        .buttonStyle(SecondaryButtonStyle())
                        .disabled(busy)
                    Button {
                        join()
                    } label: {
                        HStack(spacing: 10) {
                            if busy { ProgressView().tint(Theme.ink) }
                            Text(busy ? "Joining…" : "Join world")
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(busy)
                }
            }
            .padding(24)
        }
        .background(Theme.ground.ignoresSafeArea())
        .interactiveDismissDisabled(busy)
    }

    private func join() {
        Haptics.tap()
        busy = true
        error = nil
        Task {
            do {
                try await onJoin()
                Haptics.success()
                dismiss()
            } catch {
                self.error = MerrariaText.error(error)
            }
            busy = false
        }
    }
}

/// Settings: the name others see, the game's zoom, the account (behind Details) and sign out.
struct SettingsSheet: View {
    let account: String
    let settings: PlayerSettings
    let onSignOut: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var zoom = MerrariaConstants.defaultZoom
    @State private var confirming = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(MerrariaConstants.defaultPlayerName, text: $name)
                        .textInputAutocapitalization(.words)
                        .onChange(of: name) { value in
                            if value.count > MerrariaConstants.maxPlayerName {
                                name = String(value.prefix(MerrariaConstants.maxPlayerName))
                            }
                        }
                } header: {
                    Text("Player name")
                } footer: {
                    Text("Shown above your miner and in the player list.")
                }
                Section {
                    HStack(spacing: 12) {
                        Image(systemName: "minus.magnifyingglass").foregroundStyle(Theme.muted)
                        Slider(value: $zoom, in: MerrariaConstants.zoomRange, step: 0.1).tint(Theme.ink)
                        Image(systemName: "plus.magnifyingglass").foregroundStyle(Theme.muted)
                        Text(String(format: "%.1f×", zoom)).font(Theme.mono).foregroundStyle(Theme.ink2)
                            .frame(width: 40, alignment: .trailing)
                    }
                } header: {
                    Text("Zoom")
                } footer: {
                    Text("Zoom out to see more of the world at once.")
                }
                Section {
                    HStack(spacing: 14) {
                        AppMark(size: 40)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Signed in").font(Theme.heading(17))
                            Text("with your Calimero account").font(Theme.body(13)).foregroundStyle(Theme.muted)
                        }
                    }
                    DisclosureGroup("Details") {
                        DetailRow(label: "Account", value: account)
                    }
                    .tint(Theme.ink)
                    Button(role: .destructive) {
                        confirming = true
                    } label: {
                        Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                } header: {
                    Text("Account")
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.ground)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .confirmationDialog("Sign out of Merraria?", isPresented: $confirming, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) {
                    dismiss()
                    onSignOut()
                }
            }
        }
        .onAppear {
            name = settings.name
            zoom = settings.zoom
        }
        .onDisappear {
            settings.name = name
            settings.zoom = zoom
        }
    }
}
