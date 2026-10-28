import Foundation
import MeroKit

#if canImport(Combine)
import Combine
#endif

/// The teams list: the account's namespaces running Mero Calendar, founding
/// one, inviting to one and joining one. (`app/src/pages/teams/TeamsPage.tsx`.)
@MainActor
public final class TeamsModel: ObservableObject {
    @Published public private(set) var teams: [Team] = []
    @Published public private(set) var isLoading = false
    @Published public private(set) var hasLoaded = false
    @Published public var error: String?
    /// Teams joined in this session: their calendars may still be on their way.
    @Published public private(set) var justJoined: Set<String> = []

    public let backend: any MeroAppBackend
    public let names: NameBook
    /// Called after a join, so a relayless session reconnects (`MeroAppSession.didJoinNamespace`).
    private let didJoin: @MainActor () async -> Void

    public init(backend: any MeroAppBackend, names: NameBook, didJoin: @escaping @MainActor () async -> Void = {}) {
        self.backend = backend
        self.names = names
        self.didJoin = didJoin
    }

    /// Whether a relay serves the account. Without one only joining works.
    public var hasRelay: Bool { backend.hasRelay }

    public func load() async {
        guard backend.hasRelay else {
            teams = []
            hasLoaded = true
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            let namespaces = try await backend.listNamespaces()
            teams = namespaces.map { ns in
                Team(id: ns.id, name: label(ns.id, ns.name), applicationId: ns.applicationId)
            }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            error = nil
        } catch {
            self.error = ErrorText.describe(error, doing: "load your teams")
        }
        hasLoaded = true
    }

    /// Found a team. Returns a warning when the team exists but the cloud
    /// would not host it (invitations will not work yet).
    @discardableResult
    public func create(name raw: String) async throws -> (team: Team, warning: String?) {
        let name = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let founded = try await backend.foundNamespace(name: name)
        names.setTeamName(name, for: founded.namespaceId)
        await load()
        let team =
            teams.first { $0.id == founded.namespaceId }
            ?? Team(id: founded.namespaceId, name: name, applicationId: "")
        if !teams.contains(where: { $0.id == team.id }) { teams.append(team) }
        let warning = founded.haError.map { "Team created, but invitations will not work yet: \($0)." }
        return (team, warning)
    }

    /// A shareable invitation link to `team`.
    public func inviteLink(for team: Team) async throws -> String {
        let signed = try await backend.createInvitation(namespaceId: team.id)
        return try TeamInvitation(invitation: signed, teamName: team.name).link()
    }

    /// Redeem an invitation link. Returns the team's id.
    @discardableResult
    public func join(link: String) async throws -> String {
        guard let invitation = TeamInvitation.parse(link) else { throw CalendarError.invalidInvitation }
        if let name = invitation.teamName { names.setTeamName(name, for: invitation.namespaceId) }
        _ = try await backend.joinNamespace(namespaceId: invitation.namespaceId, invitation: invitation.invitation)
        justJoined.insert(invitation.namespaceId)
        await didJoin()
        await load()
        return invitation.namespaceId
    }

    /// The team name an invitation link carries, for the "Join …?" prompt.
    public nonisolated static func teamName(inLink link: String) -> String? {
        TeamInvitation.parse(link)?.teamName
    }

    func label(_ id: String, _ server: String?) -> String {
        if let server = server?.trimmingCharacters(in: .whitespaces), !server.isEmpty { return server }
        return names.teamName(id) ?? "Team \(id.prefix(6))"
    }
}
