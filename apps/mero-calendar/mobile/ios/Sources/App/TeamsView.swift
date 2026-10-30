import CalendarCore
import MeroKitUI
import SwiftUI

/// "Your Teams": the account's teams, creating, joining and inviting.
struct TeamsView: View {
    @ObservedObject var session: MeroAppSession
    @ObservedObject var model: TeamsModel
    @ObservedObject var approvals: ApprovalsModel
    @Binding var path: [Route]
    @State private var sheet: TeamsSheet?
    @State private var notice: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Teams are shared calendars.")
                    .font(Theme.body(15)).foregroundStyle(Theme.muted)
                if let notice { Banner(text: notice, isError: false) }
                if let error = model.error {
                    Banner(text: error) { Task { await model.load() } }
                }
                ApprovalsCard(model: approvals, orgs: model.teams.map(\.id))
                content
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
        .background(Theme.ground.ignoresSafeArea())
        .refreshable {
            await model.load()
            await approvals.load(orgs: model.teams.map(\.id))
        }
        .navigationTitle("Your Teams")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button { sheet = .create } label: { Label("Create team", systemImage: "plus") }
                        .disabled(!model.hasRelay)
                    Button { sheet = .join } label: { Label("Join with a link", systemImage: "link") }
                } label: {
                    Image(systemName: "plus").font(.system(size: 17, weight: .semibold))
                }
                .accessibilityLabel("Add a team")
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    if let account = DemoMode.backend?.account ?? session.account {
                        Text("Signed in as \(CalendarConstants.short(account, 10))")
                    }
                    Button(role: .destructive) {
                        Task { await session.signOut() }
                    } label: {
                        Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                } label: {
                    Image(systemName: "person.crop.circle").font(.system(size: 18, weight: .regular))
                }
                .accessibilityLabel("Account")
                .accessibilityIdentifier("teams.account")
            }
        }
        .task {
            if !model.hasLoaded { await model.load() }
            if DemoMode.backend == nil { await approvals.load(orgs: model.teams.map(\.id)) }
        }
        .sheet(item: $sheet) { which in
            switch which {
            case .create:
                NameEntrySheet(
                    title: "New team", label: "Team name", placeholder: "e.g. Design team", action: "Create team",
                    busyAction: "Creating…"
                ) { name in
                    let result = try await model.create(name: name)
                    notice = result.warning
                    path = [.team(result.team)]
                }
            case .join:
                JoinSheet { link in
                    let id = try await model.join(link: link)
                    if let team = model.teams.first(where: { $0.id == id }) { path = [.team(team)] }
                }
            case .invite(let team):
                InviteSheet(team: team) { try await model.inviteLink(for: team) }
            }
        }
    }

    @ViewBuilder private var content: some View {
        if !model.hasLoaded {
            ProgressView().tint(Theme.ink).frame(maxWidth: .infinity).padding(.top, 60)
        } else if !model.hasRelay {
            EmptyStateView(
                symbol: "link", title: "Join your first team",
                message: "You're not connected to your cluster. Sign in again, or open an invitation link to join a team."
            ) {
                Button("Join with a link") { sheet = .join }.buttonStyle(PrimaryButtonStyle())
            }
            .card()
        } else if model.teams.isEmpty {
            EmptyStateView(
                symbol: "calendar", title: "No teams yet",
                message: "Create one, or open an invitation link someone sent you."
            ) {
                Button("Create team") { sheet = .create }.buttonStyle(PrimaryButtonStyle())
                Button("Join with a link") { sheet = .join }.buttonStyle(SecondaryButtonStyle())
            }
            .card()
        } else {
            LazyVStack(spacing: 10) {
                ForEach(Array(model.teams.enumerated()), id: \.element.id) { index, team in
                    Button {
                        path.append(.team(team))
                    } label: {
                        TeamRow(title: team.name, subtitle: "Shared calendars", symbol: "calendar")
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("teams.card.\(index)")
                    .overlay(alignment: .trailing) {
                        Button { sheet = .invite(team) } label: {
                            Image(systemName: "person.badge.plus")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(Theme.ink)
                                .frame(width: 44, height: 44)
                        }
                        .padding(.trailing, 30)
                        .accessibilityLabel("Invite")
                        .accessibilityIdentifier("teams.invite.\(index)")
                    }
                    .contextMenu {
                        Button { path.append(.team(team)) } label: { Label("Open", systemImage: "calendar") }
                        Button { sheet = .invite(team) } label: { Label("Invite", systemImage: "person.badge.plus") }
                    }
                }
            }
        }
    }
}

enum TeamsSheet: Identifiable {
    case create, join
    case invite(Team)
    var id: String {
        switch self {
        case .create: return "create"
        case .join: return "join"
        case .invite(let team): return "invite-\(team.id)"
        }
    }
}

/// A card row: lime icon tile, title, subtitle, chevron (or a spinner).
struct TeamRow: View {
    let title: String
    let subtitle: String
    let symbol: String
    var busy = false

    var body: some View {
        HStack(spacing: 14) {
            IconTile(symbol: symbol)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(Theme.body(16, .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                Text(subtitle).font(Theme.body(13)).foregroundStyle(Theme.muted)
            }
            Spacer()
            if busy {
                ProgressView().tint(Theme.ink)
            } else {
                Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.faint)
            }
        }
        .card(padding: 14)
        .contentShape(Rectangle())
    }
}

/// One text field and a primary button, in a sheet ("New team", "New calendar").
struct NameEntrySheet: View {
    let title: String
    let label: String
    let placeholder: String
    let action: String
    let busyAction: String
    var allowEmpty = false
    let submit: (String) async throws -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                Theme.label(label)
                TextField(placeholder, text: $text)
                    .fieldStyle()
                    .focused($focused)
                    .submitLabel(.done)
                    .onSubmit { go() }
                if let error { Banner(text: error) }
                Spacer()
                Button(action: go) {
                    if busy { Text(busyAction) } else { Text(action) }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(busy || (!allowEmpty && text.trimmingCharacters(in: .whitespaces).isEmpty))
            }
            .padding(20)
            .background(Theme.ground.ignoresSafeArea())
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .onAppear { focused = true }
        }
        .presentationDetents([.medium])
    }

    private func go() {
        guard !busy, allowEmpty || !text.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        Theme.haptic()
        busy = true
        error = nil
        Task {
            do {
                try await submit(text)
                Theme.success()
                dismiss()
            } catch {
                self.error = ErrorText.describe(error, doing: action.lowercased())
            }
            busy = false
        }
    }
}

/// Paste an invitation link.
struct JoinSheet: View {
    let join: (String) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var link = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                Text("Paste the invitation link someone sent you.")
                    .font(Theme.body(15)).foregroundStyle(Theme.muted)
                TextField("https://links.calimero.network/…", text: $link, axis: .vertical)
                    .lineLimit(1...4)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .fieldStyle()
                if let error { Banner(text: error) }
                Spacer()
                Button {
                    Theme.haptic()
                    busy = true
                    error = nil
                    Task {
                        do {
                            try await join(link)
                            Theme.success()
                            dismiss()
                        } catch {
                            self.error = ErrorText.describe(error, doing: "join the team")
                        }
                        busy = false
                    }
                } label: {
                    Text(busy ? "Joining…" : "Join team")
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(busy || link.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding(20)
            .background(Theme.ground.ignoresSafeArea())
            .navigationTitle("Join a team")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        if let pasted = UIPasteboard.general.string { link = pasted }
                    } label: {
                        Label("Paste", systemImage: "doc.on.clipboard")
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }
}

/// The invitation link for a team: copy or share it.
struct InviteSheet: View {
    let team: Team
    let makeLink: () async throws -> String
    @Environment(\.dismiss) private var dismiss
    @State private var link: String?
    @State private var error: String?
    @State private var copied = false

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("Anyone with this link can join the team for 24 hours.")
                    .font(Theme.body(15)).foregroundStyle(Theme.muted)
                if let link {
                    Text(link)
                        .font(.system(size: 13, design: .monospaced))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(2)
                        .truncationMode(.middle)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.sunken, in: RoundedRectangle(cornerRadius: Theme.fieldRadius))
                    Button {
                        UIPasteboard.general.string = link
                        Theme.success()
                        copied = true
                    } label: {
                        Label(copied ? "Copied" : "Copy link", systemImage: copied ? "checkmark" : "doc.on.doc")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    ShareLink(item: link) {
                        Label("Share…", systemImage: "square.and.arrow.up")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                } else if let error {
                    Banner(text: error) { Task { await load() } }
                } else {
                    ProgressView().tint(Theme.ink).frame(maxWidth: .infinity).padding(.top, 20)
                }
                Spacer()
            }
            .padding(20)
            .background(Theme.ground.ignoresSafeArea())
            .navigationTitle("Invite to \(team.name)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.accessibilityIdentifier("sheet.done")
                }
            }
            .task { await load() }
        }
        .presentationDetents([.medium])
    }

    private func load() async {
        error = nil
        do {
            link = try await makeLink()
        } catch {
            self.error = ErrorText.describe(error, doing: "make an invitation")
        }
    }
}
