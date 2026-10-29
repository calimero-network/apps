import Foundation
import MeroKit

/// A team the account is in: one context, directly in its namespace (as the
/// web app's `ContextPicker` creates them).
public struct TeamSummary: Identifiable, Hashable, Sendable {
    public let namespaceId: String
    public let contextId: String
    /// The team's own name (`team_name`), else the namespace's, else "".
    public var name: String
    public var id: String { contextId }

    public init(namespaceId: String, contextId: String, name: String) {
        self.namespaceId = namespaceId
        self.contextId = contextId
        self.name = name
    }

    public var title: String { name.isEmpty ? "Unnamed team" : name }
}

/// The team list: the account's namespaces for this app, the team contexts
/// in each, and starting or joining one.
@MainActor
public final class TeamsModel: ObservableObject {
    @Published public private(set) var teams: [TeamSummary] = []
    @Published public private(set) var isLoading = false
    @Published public private(set) var hasLoaded = false
    @Published public var error: String?
    @Published public private(set) var isWorking = false

    public let backend: any MeroAppBackend
    private let applicationId: String?

    public init(backend: any MeroAppBackend, applicationId: String?) {
        self.backend = backend
        self.applicationId = applicationId
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
        defer {
            isLoading = false
            hasLoaded = true
        }
        do {
            let namespaces = try await backend.listNamespaces()
            var found: [TeamSummary] = []
            for ns in namespaces {
                let contexts = (try? await backend.listContexts(groupId: ns.id)) ?? []
                found += contexts.map { TeamSummary(namespaceId: ns.id, contextId: $0, name: ns.name ?? "") }
            }
            teams = await withNames(found)
            error = nil
        } catch {
            self.error = ErrorText.describe(error)
        }
    }

    /// Each team's own name, read from its context in parallel. Best effort: a
    /// team whose read fails keeps its namespace's name.
    private func withNames(_ teams: [TeamSummary]) async -> [TeamSummary] {
        let backend = backend
        let names = await withTaskGroup(of: (String, String?).self) { group in
            for team in teams {
                group.addTask {
                    let name = try? await StandupClient(backend: backend, contextId: team.contextId).teamName()
                    return (team.contextId, name)
                }
            }
            var out: [String: String] = [:]
            for await (id, name) in group { if let name, !name.isEmpty { out[id] = name } }
            return out
        }
        return teams.map { team in
            var named = team
            if let name = names[team.contextId] { named.name = name }
            return named
        }.sorted { $0.title.localizedCompare($1.title) == .orderedAscending }
    }

    /// Start a team: found a namespace, create the team's context directly in
    /// it, and name it. Returns the new team, or nil with ``error`` set.
    public func create(name: String) async -> TeamSummary? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        isWorking = true
        defer { isWorking = false }
        do {
            let founded = try await backend.foundNamespace(name: trimmed.isEmpty ? "Standup" : trimmed)
            let app = try await applicationId(for: founded.namespaceId)
            let contextId = try await backend.createContext(
                groupId: founded.namespaceId, applicationId: app, name: trimmed.isEmpty ? "Standup" : trimmed,
                initArgs: .object([:]))
            // Best effort, like the web: an unnamed team still works and anyone
            // in it can name it later.
            if !trimmed.isEmpty {
                try? await StandupClient(backend: backend, contextId: contextId).setTeamName(name: trimmed)
            }
            let team = TeamSummary(namespaceId: founded.namespaceId, contextId: contextId, name: trimmed)
            teams = (teams + [team]).sorted { $0.title.localizedCompare($1.title) == .orderedAscending }
            error = nil
            return team
        } catch {
            self.error = ErrorText.describe(error)
            return nil
        }
    }

    /// The application a new team's context runs: the session's, else the one
    /// the freshly founded namespace was founded with.
    private func applicationId(for namespaceId: String) async throws -> String {
        if let applicationId, !applicationId.isEmpty { return applicationId }
        let namespaces = try await backend.listNamespaces()
        guard let app = namespaces.first(where: { $0.id == namespaceId })?.applicationId, !app.isEmpty else {
            throw StandupError.noApplication
        }
        return app
    }

    /// Redeem an invitation. Returns the team it names; its updates arrive as
    /// the namespace syncs. Nil with ``error`` set when the relay refused.
    public func join(_ invitation: StandupInvitation) async -> TeamSummary? {
        isWorking = true
        defer { isWorking = false }
        do {
            _ = try await backend.joinNamespace(namespaceId: invitation.namespaceId, invitation: invitation.invitation)
            let team = TeamSummary(namespaceId: invitation.namespaceId, contextId: invitation.contextId, name: "")
            if !teams.contains(where: { $0.contextId == team.contextId }) { teams.append(team) }
            error = nil
            return team
        } catch {
            self.error = ErrorText.describe(error)
            return nil
        }
    }
}

public enum StandupError: LocalizedError, Equatable {
    case noApplication
    case notAnInvitation

    public var errorDescription: String? {
        switch self {
        case .noApplication: return "Mero Standup is not installed for your account yet. Try again in a moment."
        case .notAnInvitation: return "That is not a Mero Standup invitation link."
        }
    }
}
