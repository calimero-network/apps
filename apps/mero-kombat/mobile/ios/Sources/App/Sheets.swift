import KombatCore
import MeroKit
import SwiftUI
import UIKit

/// New arena: a title, and the namespace it goes in (a new one by default).
struct NewArenaSheet: View {
    let namespaces: [AppNamespace]
    let onCreate: (String, String?) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var namespaceId: String?
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(KombatConstants.defaultTitle, text: $title)
                        .textInputAutocapitalization(.sentences)
                        .submitLabel(.done)
                } header: {
                    Text("Title")
                }
                Section {
                    Picker("Namespace", selection: $namespaceId) {
                        Text("New namespace").tag(String?.none)
                        ForEach(namespaces) { namespace in
                            Text(namespace.name ?? KombatText.shortId(namespace.id)).tag(Optional(namespace.id))
                        }
                    }
                } header: {
                    Text("Namespace")
                } footer: {
                    Text(
                        "A namespace is who can fight in its arenas: one invitation lets someone into every arena in it."
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
                            Text(busy ? "Creating…" : "Create arena")
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
            .navigationTitle("New arena")
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
                try await onCreate(title, namespaceId)
                Haptics.success()
                dismiss()
            } catch {
                self.error = KombatText.error(error)
            }
            busy = false
        }
    }
}

/// Join with a link pasted from a message.
struct PasteLinkSheet: View {
    let onInvitation: (KombatInvitation) -> Void
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
                        if let invitation = KombatInvitation.parse(text) {
                            onInvitation(invitation)
                        } else {
                            Haptics.warning()
                            error = KombatError.notAnInvitation.errorDescription
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

/// "Join this arena?", asked before following a link acts on the player's behalf: joining binds
/// their account to a namespace someone else chose.
struct JoinSheet: View {
    let invitation: KombatInvitation
    let onJoin: () async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 14) {
                AppMark(size: 48)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Join this arena?").font(Theme.heading(22)).foregroundStyle(Theme.ink)
                    Text("You've been invited to fight in Mero Kombat.").font(Theme.body(14)).foregroundStyle(Theme.muted)
                }
            }
            Text(
                "Joining adds your account to the namespace this arena belongs to, and opens the arena. You can take a corner or watch."
            )
            .font(Theme.body(15)).foregroundStyle(Theme.ink2)
            DisclosureGroup("Details") {
                VStack(spacing: 12) {
                    DetailRow(label: "Namespace", value: invitation.namespaceId)
                    DetailRow(label: "Arena (context)", value: invitation.contextId)
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
                        Text(busy ? "Joining…" : "Join arena")
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
                self.error = KombatText.error(error)
            }
            busy = false
        }
    }
}

/// The account: who is signed in (behind Details), and sign out.
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
            }
            .scrollContentBackground(.hidden)
            .background(Theme.ground)
            .navigationTitle("Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .confirmationDialog("Sign out of Mero Kombat?", isPresented: $confirming, titleVisibility: .visible) {
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
