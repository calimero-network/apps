import Foundation
import MeroKit

/// Milliseconds since the epoch: every `now` the contract takes.
func nowMillis() -> UInt64 { UInt64(Date().timeIntervalSince1970 * 1000) }

/// Where the player's chosen display name lives between visits.
public protocol NameStore: AnyObject {
    var name: String { get set }
}

/// `UserDefaults`, under the web app's key.
public final class DefaultsNameStore: NameStore {
    private let defaults: UserDefaults
    public static let key = "mero-chess:name"

    public init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    public var name: String {
        get { defaults.string(forKey: Self.key) ?? "" }
        set { defaults.set(newValue, forKey: Self.key) }
    }
}

/// For tests and previews.
public final class MemoryNameStore: NameStore {
    public var name: String
    public init(_ name: String = "") { self.name = name }
}
