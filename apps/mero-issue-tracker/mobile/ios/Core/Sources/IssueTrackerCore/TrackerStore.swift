import Foundation

/// What the app remembers on this device: the open workspace and repo, and the
/// names of repos (a repo's name is a context label the cluster does not return,
/// see README "SDK gaps").
public protocol TrackerStore: AnyObject, Sendable {
    func repoName(_ contextId: String) -> String?
    func setRepoName(_ name: String, for contextId: String)
    var activeWorkspace: String? { get set }
    func activeRepo(in workspaceId: String) -> String?
    func setActiveRepo(_ contextId: String?, in workspaceId: String)
}

/// ``TrackerStore`` in `UserDefaults`.
public final class DefaultsTrackerStore: TrackerStore, @unchecked Sendable {
    private let defaults: UserDefaults
    private let prefix = "issues."

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func repoName(_ contextId: String) -> String? {
        defaults.string(forKey: prefix + "repoName." + contextId)
    }

    public func setRepoName(_ name: String, for contextId: String) {
        defaults.set(name, forKey: prefix + "repoName." + contextId)
    }

    public var activeWorkspace: String? {
        get { defaults.string(forKey: prefix + "workspace") }
        set { defaults.set(newValue, forKey: prefix + "workspace") }
    }

    public func activeRepo(in workspaceId: String) -> String? {
        defaults.string(forKey: prefix + "repo." + workspaceId)
    }

    public func setActiveRepo(_ contextId: String?, in workspaceId: String) {
        defaults.set(contextId, forKey: prefix + "repo." + workspaceId)
    }
}

/// ``TrackerStore`` in memory, for tests and previews.
public final class MemoryTrackerStore: TrackerStore, @unchecked Sendable {
    private let lock = NSLock()
    private var names: [String: String] = [:]
    private var repos: [String: String] = [:]
    private var workspace: String?

    public init() {}

    public func repoName(_ contextId: String) -> String? { lock.withLock { names[contextId] } }
    public func setRepoName(_ name: String, for contextId: String) { lock.withLock { names[contextId] = name } }
    public var activeWorkspace: String? {
        get { lock.withLock { workspace } }
        set { lock.withLock { workspace = newValue } }
    }
    public func activeRepo(in workspaceId: String) -> String? { lock.withLock { repos[workspaceId] } }
    public func setActiveRepo(_ contextId: String?, in workspaceId: String) {
        lock.withLock { repos[workspaceId] = contextId }
    }
}
