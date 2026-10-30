import Foundation
import MeroKit

/// One open team: who you are in it, its name, the people the contract knows,
/// and a ``version`` that moves whenever its state may have changed (a write
/// from here, a teammate's sync event, or the poll). Every tab re-reads when
/// it moves (the web's `useTeam`).
@MainActor
public final class TeamModel: ObservableObject {
    public let team: TeamSummary
    public let client: StandupClient
    public let backend: any MeroAppBackend

    /// The calling account, as the contract's views render it.
    @Published public private(set) var me: String?
    /// Your name on this team, "" when unset.
    @Published public private(set) var myName = ""
    @Published public private(set) var teamName = ""
    @Published public private(set) var members: [MemberView] = []
    @Published public private(set) var version = 0
    /// The last identity read failed: shown while a just-joined team syncs.
    @Published public private(set) var error: String?
    @Published public private(set) var hasLoaded = false

    /// How often to re-read with a live stream up, and without one.
    public var pollWithStream: Duration = .seconds(30)
    public var pollWithoutStream: Duration = .seconds(10)

    private var nudge: Task<Void, Never>?

    public init(team: TeamSummary, backend: any MeroAppBackend) {
        self.team = team
        self.backend = backend
        self.client = StandupClient(backend: backend, contextId: team.contextId)
        self.teamName = team.name
    }

    public var contextId: String { team.contextId }
    public var namespaceId: String { team.namespaceId }

    /// The team's title for the navigation bar.
    public var title: String { teamName.isEmpty ? "Unnamed team" : teamName }

    /// What to call `account`: "You", their name on this team, or a short id.
    public func name(of account: String, _ name: String?, you: Bool = true) -> String {
        if you, account == me { return "You" }
        if let member = members.first(where: { $0.account == account }), !member.name.isEmpty, (name ?? "").isEmpty {
            return member.name
        }
        return People.displayName(account, name)
    }

    /// Whether to ask for a name: the contract knows you and you have none.
    public var needsName: Bool { hasLoaded && me != nil && myName.isEmpty }

    /// Re-read who you are, the names and the members.
    public func load() async {
        do {
            let me: String
            if let known = self.me {
                me = known
            } else {
                me = try await client.whoami()
            }
            async let name = client.getName(account: me)
            async let teamName = client.teamName()
            async let members = client.members()
            let (n, t, m) = try await (name, teamName, members)
            self.me = me
            self.myName = n
            self.teamName = t
            self.members = m
            error = nil
            hasLoaded = true
        } catch {
            self.error = ErrorText.describe(error)
        }
    }

    /// Something may have changed: every tab re-reads.
    public func bump() {
        version += 1
    }

    /// Run one write, then re-read everything (the web's `act`).
    @discardableResult
    public func act<T>(_ write: (StandupClient) async throws -> T) async throws -> T {
        defer { bump() }
        return try await write(client)
    }

    public func renameTeam(_ name: String) async throws {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        try await act { try await $0.setTeamName(name: trimmed) }
        teamName = trimmed
    }

    public func setMyName(_ name: String) async throws {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        try await act { try await $0.setName(name: trimmed) }
        myName = trimmed
    }

    /// An invitation link to this team's org: an invite token in the SDK's link payload.
    public func inviteLink() async throws -> String {
        let minted = try await backend.createInvitation(namespaceId: namespaceId)
        let name = teamName.trimmingCharacters(in: .whitespaces)
        return try StandupInvitation(
            invitation: OrgInvitation(
                namespaceId: minted.namespaceId, token: minted.token, contextId: contextId,
                name: name.isEmpty ? nil : name)
        ).link()
    }

    /// Follow the team while the screen is up: the node's event stream when
    /// it has one, coalesced (one post can arrive as several events), and a
    /// poll either way, since a dropped stream would otherwise leave the board
    /// stale with nothing saying so. Runs until cancelled.
    public func follow() async {
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.listen() }
            group.addTask { await self.poll() }
        }
    }

    private func listen() async {
        guard backend.canSubscribe else { return }
        do {
            for try await _ in backend.events(contextId: contextId) {
                nudge?.cancel()
                nudge = Task { [weak self] in
                    try? await Task.sleep(for: .milliseconds(250))
                    guard !Task.isCancelled else { return }
                    self?.bump()
                }
            }
        } catch {
            // The poll carries on.
        }
    }

    private func poll() async {
        while !Task.isCancelled {
            let interval = backend.canSubscribe ? pollWithStream : pollWithoutStream
            try? await Task.sleep(for: interval)
            guard !Task.isCancelled else { return }
            bump()
        }
    }
}
