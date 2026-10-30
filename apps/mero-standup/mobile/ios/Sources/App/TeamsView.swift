import MeroKit
import MeroKitUI
import StandupCore
import SwiftUI

/// Signed in, no team open: your teams, starting one, joining one.
struct TeamsView: View {
    @EnvironmentObject private var session: MeroAppSession
    @StateObject private var model: TeamsModel
    /// What waits for approval on the consent page; none in demo mode.
    @State private var approvals: ApprovalsModel?
    let onOpen: (TeamSummary) -> Void
    let onSignOut: () -> Void
    @State private var starting = false
    @State private var joining = false

    init(
        backend: any MeroAppBackend, applicationId: String?, onOpen: @escaping (TeamSummary) -> Void,
        onSignOut: @escaping () -> Void
    ) {
        _model = StateObject(wrappedValue: TeamsModel(backend: backend, applicationId: applicationId))
        self.onOpen = onOpen
        self.onSignOut = onSignOut
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if let error = model.error { Card { ErrorLine(message: error) } }
                    if let approvals { ApprovalsCard(model: approvals, orgs: orgs) }
                    if !model.hasLoaded {
                        ProgressView().frame(maxWidth: .infinity).padding(.vertical, 40)
                    } else if model.teams.isEmpty {
                        Card {
                            EmptyState(
                                icon: "person.3", title: "No teams yet",
                                message: model.hasRelay
                                    ? "Start one, or open an invitation link someone sent you."
                                    : "You're not connected to your cluster. Sign in again, or join a team with an invitation link.")
                        }
                    } else {
                        ForEach(Array(model.teams.enumerated()), id: \.element.id) { index, team in
                            Button { onOpen(team) } label: { TeamRow(team: team) }
                                .buttonStyle(.plain)
                                .accessibilityIdentifier("teams.card.\(index)")
                        }
                    }
                    VStack(spacing: 10) {
                        if model.hasRelay {
                            Button { starting = true } label: { Label("Start a team", systemImage: "plus") }
                                .buttonStyle(PrimaryButtonStyle())
                        }
                        Button { joining = true } label: { Label("Join with an invitation", systemImage: "envelope.open") }
                            .buttonStyle(SecondaryButtonStyle())
                    }
                    .padding(.top, 8)
                }
                .padding(16)
            }
            .screenBackground()
            .navigationTitle("Teams")
            .refreshable {
                await model.load()
                await approvals?.load(orgs: orgs)
            }
            .task {
                await model.load()
                if approvals == nil, !DemoMode.isOn {
                    approvals = ApprovalsModel(
                        packageName: AppConfig.packageName, appName: "Mero Standup",
                        fetch: { [weak session] org in
                            guard let session else { throw CancellationError() }
                            return try await session.pendingApprovals(org: org)
                        },
                        consent: { [weak session] request in
                            guard let session else { return nil }
                            return await session.client.requestConsent(request, callback: session.callback)
                        })
                }
                await approvals?.load(orgs: orgs)
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button(role: .destructive, action: onSignOut) {
                            Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                        }
                    } label: {
                        Image(systemName: "person.crop.circle").accessibilityLabel("Account")
                    }
                    .accessibilityIdentifier("teams.account")
                }
            }
            .sheet(isPresented: $starting) {
                StartTeamSheet(model: model) { team in
                    starting = false
                    onOpen(team)
                }
            }
            .sheet(isPresented: $joining) {
                JoinTeamSheet(model: model) { team in
                    joining = false
                    onOpen(team)
                }
            }
        }
    }
}

extension TeamsView {
    /// The orgs the account's teams live in.
    fileprivate var orgs: [String] { Array(Set(model.teams.map(\.namespaceId))).sorted() }
}

private struct TeamRow: View {
    let team: TeamSummary

    var body: some View {
        HStack(spacing: 14) {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Palette.limeSoft)
                .frame(width: 42, height: 42)
                .overlay(Text(String(team.title.prefix(1)).uppercased()).font(.headline).foregroundStyle(Palette.ink))
            VStack(alignment: .leading, spacing: 2) {
                Text(team.title).font(.headline).foregroundStyle(team.name.isEmpty ? Palette.ink2 : Palette.ink)
                Text(People.shortAccount(team.contextId)).font(.caption.monospaced()).foregroundStyle(Palette.ink3)
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

private struct StartTeamSheet: View {
    @ObservedObject var model: TeamsModel
    let onStarted: (TeamSummary) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("A team's standups and decisions live on your Calimero cluster and nowhere else.")
                    .font(.subheadline).foregroundStyle(Palette.ink2)
                TextField("Team name, e.g. Platform", text: $name)
                    .focused($focused)
                    .submitLabel(.go)
                    .onSubmit(start)
                    .padding(12)
                    .background(Palette.sunken, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .onChange(of: name) { if $0.count > Limits.teamName { name = String($0.prefix(Limits.teamName)) } }
                if let error = model.error { ErrorLine(message: error) }
                Button(action: start) {
                    Text(model.isWorking ? "Creating…" : "Start team")
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(model.isWorking)
                Spacer()
            }
            .padding(20)
            .navigationTitle("Start a team")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .onAppear {
                model.error = nil
                focused = true
            }
        }
        .presentationDetents([.medium])
    }

    private func start() {
        guard !model.isWorking else { return }
        Task {
            if let team = await model.create(name: name) {
                Haptics.success()
                onStarted(team)
            } else {
                Haptics.error()
            }
        }
    }
}

private struct JoinTeamSheet: View {
    @EnvironmentObject private var session: MeroAppSession
    @ObservedObject var model: TeamsModel
    let onJoined: (TeamSummary) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var link = ""
    @State private var invalid = false
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("Paste the invitation link a teammate sent you.")
                    .font(.subheadline).foregroundStyle(Palette.ink2)
                TextField("Invitation link", text: $link, axis: .vertical)
                    .lineLimit(1...4)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focused)
                    .padding(12)
                    .background(Palette.sunken, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                if invalid { ErrorLine(message: StandupError.notAnInvitation.errorDescription ?? "") }
                if let error = model.error { ErrorLine(message: error) }
                Button(action: join) { Text(model.isWorking ? "Joining…" : "Join") }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(model.isWorking || link.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Spacer()
            }
            .padding(20)
            .navigationTitle("Join a team")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .onAppear {
                model.error = nil
                focused = true
            }
        }
        .presentationDetents([.medium])
    }

    private func join() {
        guard let invitation = StandupInvitation.parse(link) else {
            invalid = true
            Haptics.error()
            return
        }
        invalid = false
        Task {
            if let team = await model.join(invitation) {
                await session.didJoinNamespace()
                Haptics.success()
                onJoined(team)
            } else {
                Haptics.error()
            }
        }
    }
}

/// An invitation link the system handed the app: ask before joining.
struct InvitationSheet: View {
    let raw: String
    let onJoined: (TeamSummary) -> Void
    @StateObject private var model: TeamsModel
    @EnvironmentObject private var session: MeroAppSession

    init(raw: String, backend: any MeroAppBackend, applicationId: String?, onJoined: @escaping (TeamSummary) -> Void) {
        self.raw = raw
        self.onJoined = onJoined
        _model = StateObject(wrappedValue: TeamsModel(backend: backend, applicationId: applicationId))
    }

    var body: some View {
        let invitation = StandupInvitation.parse(raw)
        VStack(alignment: .leading, spacing: 18) {
            Image(systemName: "envelope.open").font(.system(size: 28)).foregroundStyle(Palette.ink)
                .frame(width: 56, height: 56).background(Palette.limeSoft, in: RoundedRectangle(cornerRadius: 14))
            Text("Join this team?").font(.title2.weight(.bold)).foregroundStyle(Palette.ink)
            Text(
                "Joining redeems the invitation: your account becomes a member of the organization this team lives in, and you see its updates and decisions."
            )
            .font(.subheadline).foregroundStyle(Palette.ink2)
            if invitation == nil { ErrorLine(message: StandupError.notAnInvitation.errorDescription ?? "") }
            if let error = model.error { ErrorLine(message: error) }
            Spacer()
            Button {
                guard let invitation else { return }
                Task {
                    if let team = await model.join(invitation) {
                        Haptics.success()
                        onJoined(team)
                    }
                }
            } label: {
                Text(model.isWorking ? "Joining…" : "Join team")
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(invitation == nil || model.isWorking)
            Button("Not now") { session.dismissPendingInvitation() }
                .buttonStyle(SecondaryButtonStyle())
        }
        .padding(24)
        .presentationDetents([.medium])
    }
}
