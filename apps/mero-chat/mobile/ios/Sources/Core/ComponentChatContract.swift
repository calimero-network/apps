import Foundation
import MeroKit

/// The chat contract on the component runtime (`logic/res/abi.json`, the web
/// port #730), behind the v1 shapes the rest of the app speaks.
///
/// ``ChatAPI`` and the models still name methods and fields the v1 way
/// (`send_message`, `parent_message`, numbers for timestamps). The component
/// ABI names methods, arguments and answer fields in camelCase and sends every
/// `u64` as a decimal string. This is the one place that knows both, the same
/// table the web's `src/api/meroChat.ts` keeps:
///
/// - the method name and every argument key go to camelCase
///   (`mentions_usernames` → `mentionsUsernames`, an attachment's
///   `blob_id_str` → `blobIdStr`);
/// - `u64` arguments (`timestamp`, `start`) go out as decimal strings;
/// - answers come back with snake_case keys, and their `u64` strings
///   (`index`, `timestamp`, `edited_on`, sizes, …) as numbers. A message's
///   `reactions` keys are emoji, data rather than field names, and are kept.
/// (Kotlin `ComponentChatContract`.)
struct ComponentChatContract: ChatContract {
    let inner: any ChatContract

    /// `u64` arguments, sent as decimal strings.
    static let u64Arguments: Set<String> = ["timestamp", "start"]
    /// `u64` answer fields (after the snake_case rename), read back as numbers.
    static let u64Answers: Set<String> = [
        "index", "timestamp", "size", "uploaded_at", "edited_on", "thread_last_timestamp", "created_at",
        "anchor_timestamp", "frontier_timestamp",
    ]
    /// Methods whose whole answer is a `u64` (`getMessageCount`, `messagePosition`).
    static let u64Results: Set<String> = ["get_message_count", "message_position"]

    func query(contextId: String, method: String, args: JSONValue) async throws -> JSONValue? {
        let answer = try await inner.query(contextId: contextId, method: Self.method(method), args: Self.args(args))
        return Self.result(answer, method: method)
    }

    func execute(contextId: String, method: String, args: JSONValue) async throws -> JSONValue? {
        let answer = try await inner.execute(contextId: contextId, method: Self.method(method), args: Self.args(args))
        return Self.result(answer, method: method)
    }

    // MARK: Conversions (pure, so tests pin them)

    /// `send_message` → `sendMessage`.
    static func method(_ v1: String) -> String { camel(v1) }

    /// v1 arguments → the ABI's.
    static func args(_ value: JSONValue) -> JSONValue {
        guard case .object(let fields) = value else { return value }
        var out: [String: JSONValue] = [:]
        for (key, field) in fields {
            if u64Arguments.contains(key), case .number(let n) = field {
                out[camel(key)] = .string(String(UInt64(max(0, n.rounded(.down)))))
            } else {
                out[camel(key)] = camelKeys(field)
            }
        }
        return .object(out)
    }

    /// The ABI's answer → v1's.
    static func result(_ value: JSONValue?, method: String) -> JSONValue? {
        guard let value else { return nil }
        if u64Results.contains(method) { return number(value) }
        return snakeKeys(value, key: nil)
    }

    private static func camelKeys(_ value: JSONValue) -> JSONValue {
        switch value {
        case .object(let fields):
            return .object(Dictionary(uniqueKeysWithValues: fields.map { (camel($0.key), camelKeys($0.value)) }))
        case .array(let items):
            return .array(items.map(camelKeys))
        default:
            return value
        }
    }

    private static func snakeKeys(_ value: JSONValue, key: String?) -> JSONValue {
        switch value {
        case .object(let fields):
            // Emoji → accounts: the keys are data.
            if key == "reactions" { return value }
            return .object(
                Dictionary(
                    uniqueKeysWithValues: fields.map { field -> (String, JSONValue) in
                        let name = snake(field.key)
                        return (name, snakeKeys(field.value, key: name))
                    }))
        case .array(let items):
            return .array(items.map { snakeKeys($0, key: key) })
        case .string where key.map(u64Answers.contains) == true:
            return number(value)
        default:
            return value
        }
    }

    /// A decimal string as a number; anything else as it is.
    private static func number(_ value: JSONValue) -> JSONValue {
        if case .string(let text) = value, let n = UInt64(text) { return .number(Double(n)) }
        return value
    }

    static func camel(_ snake: String) -> String {
        let parts = snake.split(separator: "_", omittingEmptySubsequences: false)
        guard parts.count > 1 else { return snake }
        return String(parts[0]) + parts.dropFirst().map { $0.prefix(1).uppercased() + $0.dropFirst() }.joined()
    }

    static func snake(_ camel: String) -> String {
        var out = ""
        for ch in camel {
            if ch.isUppercase {
                out += "_" + ch.lowercased()
            } else {
                out.append(ch)
            }
        }
        return out
    }
}
