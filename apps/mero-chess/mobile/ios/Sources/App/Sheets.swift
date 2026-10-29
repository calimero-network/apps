import ChessCore
import MeroKit
import SwiftUI
import UIKit

/// New table: a title, and the club it goes in (a new one by default).
struct NewTableSheet: View {
    let clubs: [AppNamespace]
    let onCreate: (String, String?) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var clubId: String?
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(ChessConstants.defaultTitle, text: $title)
                        .textInputAutocapitalization(.sentences)
                        .submitLabel(.done)
                } header: {
                    Text("Title")
                }
                Section {
                    Picker("Club", selection: $clubId) {
                        Text("New club").tag(String?.none)
                        ForEach(clubs) { club in
                            Text(club.name ?? ChessText.shortId(club.id)).tag(Optional(club.id))
                        }
                    }
                } header: {
                    Text("Club")
                } footer: {
                    Text(
                        "A club is who can sit at its tables: one invitation lets someone into every table in it."
                    )
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
                            Text(busy ? "Creating…" : "Create table")
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
            .navigationTitle("New table")
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
                try await onCreate(title, clubId)
                Haptics.success()
                dismiss()
            } catch {
                self.error = ChessText.error(error)
            }
            busy = false
        }
    }
}

/// Join with a link pasted from a message.
struct PasteLinkSheet: View {
    let onInvitation: (ChessInvitation) -> Void
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
                    Text("Paste the link someone shared with you. You'll be asked before anything is joined.")
                }
                if let error {
                    Section { Text(error).foregroundStyle(Theme.danger) }
                }
                Section {
                    Button("Continue") {
                        if let invitation = ChessInvitation.parse(text) {
                            onInvitation(invitation)
                        } else {
                            Haptics.warning()
                            error = ChessError.notAnInvitation.errorDescription
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

/// "Join this table?", asked before following a link acts on the player's behalf: joining binds
/// their account to a club someone else chose.
struct JoinSheet: View {
    let invitation: ChessInvitation
    let onJoin: () async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 14) {
                AppMark(size: 48)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Join this table?").font(Theme.heading(22)).foregroundStyle(Theme.ink)
                    Text("You've been invited to play Mero Chess.").font(Theme.body(14)).foregroundStyle(Theme.muted)
                }
            }
            Text(
                "Joining adds your account to the club this table belongs to, and opens the table. You can sit down or watch."
            )
            .font(Theme.body(15)).foregroundStyle(Theme.ink2)
            DisclosureGroup("Details") {
                VStack(spacing: 12) {
                    DetailRow(label: "Club (namespace)", value: invitation.namespaceId)
                    DetailRow(label: "Table (context)", value: invitation.contextId)
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
                        Text(busy ? "Joining…" : "Join table")
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
                self.error = ChessText.error(error)
            }
            busy = false
        }
    }
}

/// The account: who is signed in (behind Details), sign out, and the artwork's credit.
struct AccountSheet: View {
    let account: String
    let onSignOut: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var confirming = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 14) {
                        AppMark(size: 44)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Signed in").font(Theme.heading(17))
                            Text("with your Calimero account").font(Theme.body(13)).foregroundStyle(Theme.muted)
                        }
                    }
                    DisclosureGroup("Details") {
                        DetailRow(label: "Account", value: account)
                    }
                    .tint(Theme.ink)
                }
                Section {
                    Button(role: .destructive) {
                        confirming = true
                    } label: {
                        Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                }
                Section {
                    Text(
                        "Chess pieces: Chessnut, © 2015 Alexis Luengas, Apache License 2.0."
                    )
                    .font(Theme.body(13)).foregroundStyle(Theme.muted)
                } header: {
                    Text("Acknowledgements")
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.ground)
            .navigationTitle("Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .confirmationDialog("Sign out of Mero Chess?", isPresented: $confirming, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) {
                    dismiss()
                    onSignOut()
                }
            }
        }
        .presentationDetents([.medium, .large])
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
