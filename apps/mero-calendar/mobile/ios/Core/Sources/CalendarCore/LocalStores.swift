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

/// Private events for an account, kept on this device and never sent anywhere:
/// the phone's copy of the web app's `api/privateStore.ts`.
///
/// On a node a private event is the contract's `#[app::private]` storage. An
/// account has no node: its calls run on a relay, which has no private storage
/// for the accounts it serves. So for an account "private" can only mean the
/// device the person holds. Keyed by account + team (namespace), each record
/// carrying its calendar's context id, exactly as the web app keys them.
public final class PrivateEventStore: @unchecked Sendable {
    public static let prefix = "mc-private-events"
    private let store: KeyValueStore
    private let lock = NSLock()

    public init(store: KeyValueStore) { self.store = store }

    public static func key(account: String, namespaceId: String) -> String {
        "\(prefix):\(account):\(namespaceId)"
    }

    /// True for an id this store minted.
    public static func isLocalId(_ id: String) -> Bool { id.hasPrefix("local-") }

    private struct Record: Codable {
        var contextId: String
        var event: CalendarItem
    }

    private func read(_ key: String) -> [Record] {
        guard let raw = store.string(key), let data = raw.data(using: .utf8) else { return [] }
        return (try? JSONDecoder().decode([Record].self, from: data)) ?? []
    }

    private func write(_ key: String, _ records: [Record]) {
        guard let data = try? JSONEncoder().encode(records) else { return }
        store.set(String(decoding: data, as: UTF8.self), for: key)
    }

    /// The private events of one calendar.
    public func list(key: String, contextId: String) -> [CalendarItem] {
        lock.withLock { read(key).filter { $0.contextId == contextId }.map(\.event) }
    }

    /// Store a new private event; returns its id.
    @discardableResult
    public func add(key: String, contextId: String, event: CalendarItem) -> String {
        lock.withLock {
            var event = event
            event.id = "local-\(UUID().uuidString.lowercased())"
            event.peers = []
            event.isPrivate = true
            var all = read(key)
            all.append(Record(contextId: contextId, event: event))
            write(key, all)
            return event.id
        }
    }

    /// Replace a stored event. Returns false when the id is unknown.
    @discardableResult
    public func update(key: String, event: CalendarItem) -> Bool {
        lock.withLock {
            var all = read(key)
            guard let index = all.firstIndex(where: { $0.event.id == event.id }) else { return false }
            var event = event
            event.peers = []
            event.isPrivate = true
            all[index].event = event
            write(key, all)
            return true
        }
    }

    /// Remove a stored event. Returns false when the id is unknown.
    @discardableResult
    public func remove(key: String, id: String) -> Bool {
        lock.withLock {
            let all = read(key)
            let kept = all.filter { $0.event.id != id }
            guard kept.count != all.count else { return false }
            write(key, kept)
            return true
        }
    }
}

/// Names the person gave things on this device: a fallback when the relay
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
