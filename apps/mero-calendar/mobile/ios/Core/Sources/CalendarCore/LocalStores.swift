import Foundation

/// A tiny string store: `UserDefaults` in the app, a dictionary in tests.
public protocol KeyValueStore: AnyObject, Sendable {
    func string(_ key: String) -> String?
    func set(_ value: String?, for key: String)
}

/// `UserDefaults`-backed store (the app's sandbox; never synced or uploaded).
public final class DefaultsStore: KeyValueStore, @unchecked Sendable {
    private let defaults: UserDefaults
    public init(_ defaults: UserDefaults = .standard) { self.defaults = defaults }
    public func string(_ key: String) -> String? { defaults.string(forKey: key) }
    public func set(_ value: String?, for key: String) {
        if let value { defaults.set(value, forKey: key) } else { defaults.removeObject(forKey: key) }
    }
}

/// In-memory store for tests and previews.
public final class MemoryStore: KeyValueStore, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String: String] = [:]
    public init(_ values: [String: String] = [:]) { self.values = values }
    public func string(_ key: String) -> String? { lock.withLock { values[key] } }
    public func set(_ value: String?, for key: String) { lock.withLock { values[key] = value } }
}

/// Names the person gave things on this device: a fallback when the cluster
/// returns no name (as the web app's `utils/teamName.ts`), and the display name
/// they use in each calendar (`mc-username-<context>`).
public final class NameBook: @unchecked Sendable {
    private let store: KeyValueStore
    public init(store: KeyValueStore) { self.store = store }

    public func teamName(_ id: String) -> String? { nonEmpty(store.string("mc-team-name-\(id)")) }
    public func setTeamName(_ name: String, for id: String) { save(name, "mc-team-name-\(id)") }
    public func calendarName(_ id: String) -> String? { nonEmpty(store.string("mc-calendar-name-\(id)")) }
    public func setCalendarName(_ name: String, for id: String) { save(name, "mc-calendar-name-\(id)") }

    /// The name chosen for one calendar, if any.
    public func username(context: String) -> String? { nonEmpty(store.string("mc-username-\(context)")) }
    /// The last name chosen anywhere: what the name prompt starts with.
    public var lastUsername: String? { nonEmpty(store.string("mc-username-last")) }
    public func setUsername(_ name: String, context: String) {
        save(name, "mc-username-\(context)")
        save(name, "mc-username-last")
    }

    private func save(_ value: String, _ key: String) {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        store.set(trimmed, for: key)
    }

    private func nonEmpty(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
        return value
    }
}
