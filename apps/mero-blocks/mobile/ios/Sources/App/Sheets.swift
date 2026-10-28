import BlocksCore
import MeroKit
import SwiftUI
import UIKit

/// Create world: a name and, optionally, a seed (the web app's "Create world" dialog).
struct NewWorldSheet: View {
    let onCreate: (String, UInt64?) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = BlocksConstants.defaultWorldName
    @State private var seed = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(BlocksConstants.defaultWorldName, text: $name)
                        .textInputAutocapitalization(.never)
                        .submitLabel(.done)
                        .onChange(of: name) { value in
                            if value.count > BlocksConstants.worldNameMax {
                                name = String(value.prefix(BlocksConstants.worldNameMax))
                            }
                        }
                } header: {
                    Text("World name")
                }
                Section {
                    HStack {
                        TextField("Random", text: $seed)
                            .keyboardType(.numberPad)
                            .font(Theme.mono)
                        Button {
                            Haptics.selection()
                            seed = String(UInt64.random(in: BlocksConstants.seedRange))
                        } label: {
                            Image(systemName: "dice")
                        }
                        .accessibilityLabel("Random seed")
                    }
                } header: {
                    Text("Seed")
                } footer: {
                    Text("The same seed always grows the same terrain. Leave it empty for a new one.")
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
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(busy)
    }

    private func create() {
        Haptics.tap()
        busy = true
        error = nil
        Task {
            do {
                try await onCreate(name, BlocksText.seed(seed))
                Haptics.success()
                dismiss()
            } catch {
                self.error = BlocksText.error(error)
            }
            busy = false
        }
    }
}

/// Join with a link pasted from a message.
struct PasteLinkSheet: View {
    let onInvitation: (BlocksInvitation) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://links.calimero.network/…", text: $text, axis: .vertical)
                        .lineLimit(3...6)
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
                        if let invitation = BlocksInvitation.parse(text) {
                            onInvitation(invitation)
                        } else {
                            Haptics.warning()
                            error = BlocksError.notAnInvitation.errorDescription
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
        .presentationDetents([.medium, .large])
    }
}

/// "Join this world?", asked before following a link acts on the player's behalf.
struct JoinSheet: View {
    let invitation: BlocksInvitation
    let onJoin: () async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 14) {
                AppMark(size: 48)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Join \(invitation.name ?? "this world")?").font(Theme.heading(22)).foregroundStyle(Theme.ink)
                        .lineLimit(2)
                    Text("You've been invited to build in Mero Blocks.").font(Theme.body(14)).foregroundStyle(Theme.muted)
                }
            }
            Text("Joining adds your account to this world and opens it. Everyone in it sees what you build.")
                .font(Theme.body(15)).foregroundStyle(Theme.ink2)
            DisclosureGroup("Details") {
                VStack(spacing: 12) {
                    DetailRow(label: "Namespace", value: invitation.namespaceId)
                    if let contextId = invitation.contextId { DetailRow(label: "World (context)", value: contextId) }
                }
                .padding(.top, 8)
            }
            .font(Theme.body(14, .semibold))
            .tint(Theme.ink)
            if let error { ErrorBanner(message: error) { self.error = nil } }
            Spacer(minLength: 0)
            VStack(spacing: 10) {
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
                Button("Not now") { dismiss() }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(busy)
            }
        }
        .padding(24)
        .background(Theme.ground.ignoresSafeArea())
        .presentationDetents([.medium, .large])
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
                self.error = BlocksText.error(error)
            }
            busy = false
        }
    }
}

/// The system share sheet.
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Self.Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Self.Context) {}
}
