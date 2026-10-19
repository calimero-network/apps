import Foundation
import MeroKit

/// Fixed facts about the chat app.
enum ChatConstants {
    /// The contract's registry package: what a workspace is founded with, and
    /// the slug invitation links carry.
    static let packageName = "com.calimero.chat"
    /// `MESSAGE_PAGE_SIZE` in the web app (`app/src/constants/app.ts`).
    static let messagePageSize = 20
    /// The web app names a DM's subgroup `DM_CONTEXT_<…>` (`utils/dmContext.ts`).
    static let dmAliasPrefix = "DM_CONTEXT_"
    /// The channel every new workspace starts with (`utils/createChannel.ts`).
    static let generalChannel = "general"
    /// The cap core puts on a group/context name (bytes).
    static let maxNameBytes = 64
}

/// Errors the chat layer raises itself.
enum ChatError: Error, Equatable, LocalizedError {
    /// The relay answered with something that is not the shape the contract returns.
    case badResponse(method: String, detail: String)
    /// The signed-in account has no relay yet.
    case noRelay
    /// The input was refused before anything was sent.
    case invalidInput(String)

    var errorDescription: String? {
        switch self {
        case .badResponse(let method, let detail):
            return "The relay's answer to \(method) could not be read: \(detail)"
        case .noRelay:
            return "No relay serves this account yet. Join a workspace from an invitation to get one."
        case .invalidInput(let message):
            return message
        }
    }
}

/// JSON plumbing between the relay's generic `JSONValue` results and typed models.
enum ChatJSON {
    /// Decode `value` (a contract's `returns`) as `T`.
    static func decode<T: Decodable>(_ type: T.Type, _ value: JSONValue?, method: String) throws -> T {
        // Canonical spelling writes integral numbers without a fraction, so a
        // `u64` the relay handed back as a double still decodes as an integer.
        let data = CanonicalJSON.data(value ?? .null)
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw ChatError.badResponse(method: method, detail: "\(error)")
        }
    }

    /// The UTF-8 JSON bytes of `value`, as a context's `initializationParams` takes them.
    static func bytes(_ value: JSONValue) -> [Int] {
        CanonicalJSON.data(value).map { Int($0) }
    }
}

/// How the contract names an account.
enum ChatIdentity {
    /// The contract's `UserId` for an account: base58 of the account's 32
    /// bytes (`user_of` in lib.rs). `nil` when `accountHex` is not 64 hex.
    static func userId(accountHex: String) -> String? {
        guard let bytes = try? Hex.decode(accountHex, label: "account", bytes: 32) else { return nil }
        return InviteCodec.base58Encode(bytes)
    }

    /// A short form of an id for display.
    static func short(_ id: String) -> String {
        id.count > 12 ? "\(id.prefix(6))…\(id.suffix(4))" : id
    }
}

/// Whole seconds since the epoch: every timestamp the contract takes
/// (`check_timestamp` compares against `time_now / 1e9`).
func chatTimestamp(_ date: Date) -> UInt64 {
    UInt64(max(0, date.timeIntervalSince1970.rounded(.down)))
}
