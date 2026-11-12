import Foundation
import MeroKit

// The app half of the bridge between the game page (`../../game/src/bridge.ts`) and the
// signed-in session. The page posts JSON text; the app answers by evaluating
// `window.meroBridge.receive("<JSON>")`. Same shapes as the Kotlin `Bridge.kt`.

public enum BridgeOp: String, Sendable, Equatable {
    case query
    case execute
}

/// One message from the page.
public enum BridgeRequest: Equatable, Sendable {
    /// A contract call. `argsJSON` is the argument object as JSON text.
    case call(id: Int, op: BridgeOp, method: String, argsJSON: Data)
    /// The page is listening: send `start`.
    case ready
    /// The world is read and on screen.
    case loaded
    /// The menu button was tapped.
    case menu
    case haptic(style: String)
    /// The world could not be opened.
    case fatal(message: String)
}

public enum BridgeError: Error, LocalizedError, Equatable {
    case malformed(String)
    case unknownMethod(String)
    case wrongPath(method: String, expected: BridgeOp)
    case badArguments(method: String, detail: String)

    public var errorDescription: String? {
        switch self {
        case .malformed(let detail): return "Malformed bridge message: \(detail)"
        case .unknownMethod(let method): return "The game may not call \(method)."
        case .wrongPath(let method, let expected): return "\(method) must go through \(expected.rawValue)."
        case .badArguments(let method, let detail): return "Bad arguments for \(method): \(detail)"
        }
    }
}

/// What the app tells the page when it starts.
public struct GameStart: Equatable, Sendable, Encodable {
    public let contextId: String
    /// "Me" as the contract keys players: the account, 64 hex (`PlayerView.id` with no device).
    public let myId: String
    public let name: String
    public let worldName: String
    public let sensitivity: Double

    public init(contextId: String, myId: String, name: String, worldName: String, sensitivity: Double) {
        self.contextId = contextId
        self.myId = myId
        self.name = name
        self.worldName = worldName
        self.sensitivity = sensitivity
    }
}

/// Safe-area insets in CSS pixels (points), so the controls stay clear of the notch.
public struct GameInsets: Equatable, Sendable, Encodable {
    public let top: Double
    public let left: Double
    public let bottom: Double
    public let right: Double

    public init(top: Double, left: Double, bottom: Double, right: Double) {
        self.top = top
        self.left = left
        self.bottom = bottom
        self.right = right
    }

    public static let zero = GameInsets(top: 0, left: 0, bottom: 0, right: 0)
}

public enum BridgeCodec {
    /// Read one message from the page.
    public static func decode(_ text: String) throws -> BridgeRequest {
        guard let object = try? JSONSerialization.jsonObject(with: Data(text.utf8)),
            let fields = object as? [String: Any]
        else { throw BridgeError.malformed("not a JSON object") }
        guard let op = fields["op"] as? String else { throw BridgeError.malformed("no op") }
        switch op {
        case "query", "execute":
            guard let id = (fields["id"] as? NSNumber)?.intValue else { throw BridgeError.malformed("no id") }
            guard let method = fields["method"] as? String, !method.isEmpty else {
                throw BridgeError.malformed("no method")
            }
            let args = fields["args"] ?? [String: Any]()
            guard args is [String: Any] else { throw BridgeError.malformed("args is not an object") }
            let data = try JSONSerialization.data(withJSONObject: args, options: [.sortedKeys])
            return .call(id: id, op: op == "query" ? .query : .execute, method: method, argsJSON: data)
        case "ready": return .ready
        case "loaded": return .loaded
        case "menu": return .menu
        case "haptic": return .haptic(style: fields["style"] as? String ?? "light")
        case "fatal": return .fatal(message: fields["message"] as? String ?? "The world could not be opened.")
        default: throw BridgeError.malformed("unknown op \(op)")
        }
    }

    /// A call's answer: `result` is the method's return value as JSON text.
    public static func result(id: Int, json: Data) -> String {
        let value = json.isEmpty ? "null" : String(decoding: json, as: UTF8.self)
        return "{\"type\":\"result\",\"id\":\(id),\"ok\":true,\"result\":\(value)}"
    }

    public static func failure(id: Int, message: String) -> String {
        object(["type": "result", "id": id, "ok": false, "error": message])
    }

    public static func start(_ start: GameStart, insets: GameInsets) -> String {
        object([
            "type": "start", "contextId": start.contextId, "myId": start.myId, "name": start.name,
            "worldName": start.worldName, "sensitivity": start.sensitivity,
            "insets": ["top": insets.top, "left": insets.left, "bottom": insets.bottom, "right": insets.right],
        ])
    }

    public static func event(kind: String) -> String { object(["type": "event", "kind": kind]) }
    public static var pause: String { object(["type": "pause"]) }
    public static var resume: String { object(["type": "resume"]) }

    public static func insets(_ insets: GameInsets) -> String {
        object(["type": "insets", "top": insets.top, "left": insets.left, "bottom": insets.bottom, "right": insets.right])
    }

    public static func settings(sensitivity: Double) -> String {
        object(["type": "settings", "sensitivity": sensitivity])
    }

    /// The JavaScript that hands `message` to the page: the JSON passed as a string literal, so
    /// nothing in it is ever evaluated as code.
    public static func script(_ message: String) -> String {
        let literal = (try? JSONSerialization.data(withJSONObject: message, options: [.fragmentsAllowed]))
            .map { String(decoding: $0, as: UTF8.self) } ?? "\"\""
        return "window.meroBridge&&window.meroBridge.receive(\(literal));"
    }

    private static func object(_ fields: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys]) else { return "{}" }
        return String(decoding: data, as: UTF8.self)
    }
}

/// Runs the page's contract calls through ``BlocksClient`` on the component ABI: only the methods
/// the game uses, each on its own path (views `query`, mutations `execute`), with typed arguments.
/// `init` and anything else are refused.
///
/// The page speaks the bridge wire it always has (`game/src/bridge.ts`, `v1World.ts`): snake_case
/// names, `now` as a number, whole lists. This router puts each call on the component wire
/// (camelCase, u64 as decimal strings, pages followed) and answers in the page's shapes. The
/// camelCase names are accepted too, for a page built against the component ABI.
public struct BridgeRouter: Sendable {
    /// The page's name for each method -> the contract's.
    public static let names: [String: String] = [
        "world_meta": "worldMeta", "get_overrides": "getOverrides", "get_players": "getPlayers",
        "override_count": "overrideCount", "join": "join", "leave": "leave", "heartbeat": "heartbeat",
        "set_blocks": "setBlocks",
    ]
    public static let views: Set<String> = ["worldMeta", "getOverrides", "getPlayers", "overrideCount"]
    public static let mutations: Set<String> = ["join", "leave", "heartbeat", "setBlocks"]

    /// The contract stores any byte; the client only defines ids 0 to 15, and at most 512 a call.
    public static let maxEdits = 512
    public static let maxBlockId: UInt8 = 15

    public let client: BlocksClient

    public init(client: BlocksClient) {
        self.client = client
    }

    private struct NowArgs: Decodable { let now: UInt64 }
    private struct JoinArgs: Decodable {
        let name: String
        let now: UInt64
    }
    private struct HeartbeatArgs: Decodable {
        let t: Transform
        let now: UInt64
    }
    private struct SetBlocksArgs: Decodable {
        let edits: [Edit]
        let now: UInt64
    }
    /// `WorldMeta` as the page reads it: `seed` and `createdAt` as numbers, not the wire's decimal
    /// strings.
    private struct PageWorldMeta: Encodable {
        let name: String
        let seed: UInt64
        let createdAt: UInt64

        init(_ meta: WorldMeta) {
            name = meta.name
            seed = meta.seed
            createdAt = meta.createdAt
        }
    }

    /// The contract's name for what the page called, or nil when the game may not call it.
    public static func contractMethod(_ method: String) -> String? {
        if let mapped = names[method] { return mapped }
        return views.contains(method) || mutations.contains(method) ? method : nil
    }

    /// The method's return value as JSON text, in the shape the page reads.
    public func handle(op: BridgeOp, method: String, argsJSON: Data) async throws -> Data {
        guard let name = Self.contractMethod(method) else { throw BridgeError.unknownMethod(method) }
        let expected: BridgeOp = Self.views.contains(name) ? .query : .execute
        guard op == expected else { throw BridgeError.wrongPath(method: method, expected: expected) }

        func args<T: Decodable>(_ type: T.Type) throws -> T {
            do {
                return try JSONDecoder().decode(type, from: Self.numericNow(argsJSON))
            } catch {
                throw BridgeError.badArguments(method: method, detail: String(describing: error))
            }
        }
        let encoder = JSONEncoder()
        switch name {
        case "worldMeta": return try encoder.encode(PageWorldMeta(try await client.worldMeta()))
        case "getOverrides": return try encoder.encode(try await client.allOverrides())
        case "overrideCount": return try encoder.encode(try await client.overrideCount())
        case "getPlayers":
            return try encoder.encode(try await client.allPlayers(now: try args(NowArgs.self).now))
        case "join":
            let a = try args(JoinArgs.self)
            return try encoder.encode(try await client.join(name: a.name, now: a.now))
        case "leave":
            try await client.leave(now: try args(NowArgs.self).now)
        case "heartbeat":
            let a = try args(HeartbeatArgs.self)
            try await client.heartbeat(t: a.t, now: a.now)
        case "setBlocks":
            let a = try args(SetBlocksArgs.self)
            if a.edits.count > Self.maxEdits {
                throw BridgeError.badArguments(method: method, detail: "more than \(Self.maxEdits) edits")
            }
            if a.edits.contains(where: { $0.b > Self.maxBlockId }) {
                throw BridgeError.badArguments(method: method, detail: "block id outside 0 to 15")
            }
            return try encoder.encode(try await client.setBlocks(edits: a.edits, now: a.now))
        default:
            throw BridgeError.unknownMethod(method)
        }
        return Data("null".utf8)
    }

    /// The page's `now` is a number; a page on the component wire sends a decimal string. Either
    /// reads as a number here.
    static func numericNow(_ argsJSON: Data) -> Data {
        guard var object = (try? JSONSerialization.jsonObject(with: argsJSON)) as? [String: Any],
            let text = object["now"] as? String, let value = UInt64(text)
        else { return argsJSON }
        object["now"] = NSNumber(value: value)
        return (try? JSONSerialization.data(withJSONObject: object)) ?? argsJSON
    }
}
