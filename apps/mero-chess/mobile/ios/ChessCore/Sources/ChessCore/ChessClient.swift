import Foundation
@_exported import MeroChessGenerated
import MeroKit

/// The generated client over one table's contract.
///
/// The generated file declares its own `ContextContractCalling` (it imports nothing), with the
/// same two methods as MeroKit's; this forwards one to the other, so every contract call in the app
/// goes through `MeroChessClient` and never names a method by hand.
struct ContractTransport: MeroChessGenerated.ContextContractCalling {
    let inner: any MeroKit.ContextContractCalling

    func query(method: String, argsJSON: Data) async throws -> Data {
        try await inner.query(method: method, argsJSON: argsJSON)
    }

    func execute(method: String, argsJSON: Data) async throws -> Data {
        try await inner.execute(method: method, argsJSON: argsJSON)
    }
}

extension MeroChessClient {
    /// `MeroChessClient` for `contextId` in the account's backend.
    public static func bound(_ backend: any MeroAppBackend, contextId: String) -> MeroChessClient {
        MeroChessClient(transport: ContractTransport(inner: backend.contract.bound(to: contextId)))
    }
}

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
