import Foundation
import MeroKit

/// One repository: a context in the workspace's root group running the tracker.
public struct Repo: Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let url: String

    public init(id: String, name: String, url: String) {
        self.id = id
        self.name = name
        self.url = url
    }
}

/// Where a read stands.
public enum LoadPhase: Equatable, Sendable {
    case idle
    case loading
    case loaded
    case failed(String)
}

/// Workspaces (Calimero orgs) and their repos (app instances), the web app's sidebar:
/// switching, founding a workspace, adding a repo, inviting and joining.
@MainActor
public final class WorkspaceModel: ObservableObject {
    @Published public private(set) var workspaces: [AppNamespace] = []
    @Published public private(set) var activeWorkspaceId: String?
    @Published public private(set) var repos: [Repo] = []
    @Published public private(set) var activeRepoId: String?
    @Published public private(set) var phase: LoadPhase = .idle
    @Published public private(set) var reposPhase: LoadPhase = .idle
    /// A workspace joined from an invitation whose repos have not arrived yet.
    @Published public private(set) var syncingWorkspaceId: String?

    public let backend: any MeroAppBackend
    public let account: String
    private let applicationId: String?
    private let store: TrackerStore

    public init(backend: any MeroAppBackend, applicationId: String?, store: TrackerStore) {
        self.backend = backend
        self.account = backend.account
        self.applicationId = applicationId
        self.store = store
    }

    public var activeWorkspace: AppNamespace? { workspaces.first { $0.id == activeWorkspaceId } }
    public var activeRepo: Repo? { repos.first { $0.id == activeRepoId } }
    public var hasRelay: Bool { backend.hasRelay }
    public var isSyncing: Bool { syncingWorkspaceId != nil && syncingWorkspaceId == activeWorkspaceId && repos.isEmpty }

    /// A workspace's name as people see it.
    public static func displayName(_ ns: AppNamespace) -> String {
        let name = ns.name?.trimmingCharacters(in: .whitespaces) ?? ""
        return name.isEmpty ? "Workspace \(ns.id.prefix(8))" : name
    }

    /// The contract in a repo.
    public func client(for repoId: String) -> IssueTrackerClient {
        IssueTrackerClient(contract: backend.contract, contextId: repoId)
    }

    // MARK: Loading

    /// List workspaces and open the remembered one (or the first), then its repos.
    public func load() async {
        if workspaces.isEmpty { phase = .loading }
        do {
            let list = try await backend.listNamespaces()
            workspaces = list.sorted { Self.displayName($0).localizedCaseInsensitiveCompare(Self.displayName($1)) == .orderedAscending }
            phase = .loaded
        } catch {
            phase = .failed(TrackerFormat.errorText(error))
            return
        }
        let remembered = store.activeWorkspace
        let next =
            workspaces.first { $0.id == activeWorkspaceId }?.id
            ?? workspaces.first { $0.id == remembered }?.id
            ?? workspaces.first?.id
        if next != activeWorkspaceId { repos = []; activeRepoId = nil }
        activeWorkspaceId = next
        if let next { store.activeWorkspace = next }
        await loadRepos()
    }

    /// Switch to another workspace.
    public func selectWorkspace(_ id: String) async {
        guard id != activeWorkspaceId else { return }
        activeWorkspaceId = id
        store.activeWorkspace = id
        repos = []
        activeRepoId = nil
        await loadRepos()
    }

    /// The active workspace's repos, named from this device's memory, else their URL.
    public func loadRepos() async {
        guard let ns = activeWorkspaceId else {
            repos = []
            reposPhase = .loaded
            return
        }
        if repos.isEmpty { reposPhase = .loading }
        do {
            let ids = try await backend.listContexts(groupId: ns)
            let contract = backend.contract
            let urls = await withTaskGroup(of: (String, String).self) { group -> [String: String] in
                for id in ids {
                    group.addTask {
                        let url = (try? await IssueTrackerClient(contract: contract, contextId: id).getRepoInfo().repoUrl) ?? ""
                        return (id, url)
                    }
                }
                var out: [String: String] = [:]
                for await (id, url) in group { out[id] = url }
                return out
            }
            guard ns == activeWorkspaceId else { return }
            repos = ids.map { id in
                let url = urls[id] ?? ""
                let name = store.repoName(id) ?? TrackerFormat.repoName(fromURL: url) ?? "Repo \(id.prefix(6))"
                return Repo(id: id, name: name, url: url)
            }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            reposPhase = .loaded
            if !repos.isEmpty, syncingWorkspaceId == ns { syncingWorkspaceId = nil }
        } catch {
            reposPhase = .failed(TrackerFormat.errorText(error))
            return
        }
        let remembered = store.activeRepo(in: ns)
        activeRepoId =
            repos.first { $0.id == activeRepoId }?.id
            ?? repos.first { $0.id == remembered }?.id
            ?? repos.first?.id
    }

    /// Open a repo.
    public func selectRepo(_ id: String) {
        activeRepoId = id
        if let ns = activeWorkspaceId { store.setActiveRepo(id, in: ns) }
    }

    /// Make sure the account may call the contract in a repo (joined members of
    /// the workspace are; a context in an open group is joined). Best-effort.
    public func ensureMember(_ repoId: String) async {
        guard (try? await backend.isMember(contextId: repoId)) == false else { return }
        try? await backend.joinContext(contextId: repoId)
    }

    // MARK: Writes

    /// Found a workspace and open it. Returns a hosting notice when the cloud
    /// would not host it (an invitation from it will not reach anyone yet).
    @discardableResult
    public func createWorkspace(name: String) async throws -> String? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw TrackerError.message("Give the workspace a name.") }
        let founded = try await backend.foundNamespace(name: trimmed)
        store.activeWorkspace = founded.namespaceId
        activeWorkspaceId = founded.namespaceId
        repos = []
        activeRepoId = nil
        await load()
        if !workspaces.contains(where: { $0.id == founded.namespaceId }) {
            workspaces.append(AppNamespace(id: founded.namespaceId, name: trimmed, applicationId: applicationId ?? ""))
            activeWorkspaceId = founded.namespaceId
        }
        return founded.haEnabled ? nil : (founded.haError ?? "the cloud is not hosting it")
    }

    /// Add a repo to the active workspace: a context, then its GitHub URL in shared state.
    public func addRepo(name: String, url: String) async throws {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedURL = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else { throw TrackerError.message("Repo name is required") }
        guard let ns = activeWorkspace else { throw TrackerError.message("Open a workspace first.") }
        let appId = ns.applicationId.isEmpty ? (applicationId ?? "") : ns.applicationId
        guard !appId.isEmpty else { throw TrackerError.message("The app's id is not known yet. Try again in a moment.") }
        let contextId = try await backend.createContext(
            groupId: ns.id, applicationId: appId, name: trimmedName, initArgs: .object([:]))
        store.setRepoName(trimmedName, for: contextId)
        if !trimmedURL.isEmpty {
            try await client(for: contextId).setRepoUrl(url: trimmedURL)
        }
        store.setActiveRepo(contextId, in: ns.id)
        activeRepoId = contextId
        await loadRepos()
        if !repos.contains(where: { $0.id == contextId }) {
            repos.append(Repo(id: contextId, name: trimmedName, url: trimmedURL))
        }
        activeRepoId = contextId
    }

    /// Change the active repo's GitHub URL (shared with every member).
    public func setRepoURL(_ url: String) async throws {
        guard let repo = activeRepo else { return }
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        try await client(for: repo.id).setRepoUrl(url: trimmed)
        repos = repos.map { $0.id == repo.id ? Repo(id: $0.id, name: $0.name, url: trimmed) : $0 }
    }

    /// Mint an invitation link to the active workspace.
    public func inviteLink() async throws -> String {
        guard let ns = activeWorkspace else { throw TrackerError.message("Open a workspace first.") }
        let signed = try await backend.createInvitation(namespaceId: ns.id)
        return try TrackerInvitation(invitation: signed, workspaceName: Self.displayName(ns)).link()
    }

    /// Redeem an invitation and remember its workspace as the open one. The
    /// caller then reconnects the session (`MeroAppSession.didJoinNamespace()`).
    public func join(_ invitation: TrackerInvitation) async throws {
        let id = invitation.namespaceId
        guard !id.isEmpty else { throw TrackerError.message("That invitation does not name a workspace.") }
        _ = try await backend.joinNamespace(namespaceId: id, invitation: invitation.invitation)
        store.activeWorkspace = id
        syncingWorkspaceId = id
        activeWorkspaceId = id
        repos = []
        activeRepoId = nil
        await load()
    }

    /// Mark a workspace as just joined, so an empty repo list reads as "syncing".
    public func markSyncing(_ id: String?) {
        syncingWorkspaceId = id
    }
}

/// A failure the app words itself.
public enum TrackerError: Error, LocalizedError, Equatable {
    case message(String)

    public var errorDescription: String? {
        switch self {
        case .message(let text): return text
        }
    }
}
