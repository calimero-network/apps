import Foundation

/// What the app remembers on this device: the open workspace, and the names of
/// spreadsheets this device created (shown until the workbook's own name, from
/// `get_project`, can be read).
public protocol SheetsStore: AnyObject, Sendable {
    func spreadsheetName(_ contextId: String) -> String?
    func setSpreadsheetName(_ name: String, for contextId: String)
    var activeWorkspace: String? { get set }
}

/// ``SheetsStore`` in `UserDefaults`.
public final class DefaultsSheetsStore: SheetsStore, @unchecked Sendable {
    private let defaults: UserDefaults
    private let prefix = "sheets."

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func spreadsheetName(_ contextId: String) -> String? {
        defaults.string(forKey: prefix + "name." + contextId)
    }

    public func setSpreadsheetName(_ name: String, for contextId: String) {
        defaults.set(name, forKey: prefix + "name." + contextId)
    }

    public var activeWorkspace: String? {
        get { defaults.string(forKey: prefix + "workspace") }
        set { defaults.set(newValue, forKey: prefix + "workspace") }
    }
}

/// ``SheetsStore`` in memory, for tests and previews.
public final class MemorySheetsStore: SheetsStore, @unchecked Sendable {
    private let lock = NSLock()
    private var names: [String: String] = [:]
    private var workspace: String?

    public init() {}

    public func spreadsheetName(_ contextId: String) -> String? { lock.withLock { names[contextId] } }
    public func setSpreadsheetName(_ name: String, for contextId: String) { lock.withLock { names[contextId] = name } }
    public var activeWorkspace: String? {
        get { lock.withLock { workspace } }
        set { lock.withLock { workspace = newValue } }
    }
}
