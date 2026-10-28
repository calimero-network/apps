import Foundation
import MeroKit

// The bridge between the app and the bundled web game (`app/src/native/host.ts`, which documents
// the protocol). Both directions are one JSON object per message. Same messages, same spelling as
// the Android app's `GameBridge.kt`.

/// How the page asks for something: a contract view, a contract write, or its start-up config.
public enum BridgeOp: String, Sendable, Equatable {
    case query
    case execute
    case config
}

/// One hotbar slot as the game reports it.
public struct HudSlot: Equatable, Sendable, Identifiable {
    public let id: Int
    public let name: String
    /// `0xRRGGBB`
    public let color: UInt32
    public let count: Int

    public init(id: Int, name: String, color: UInt32, count: Int) {
        self.id = id
        self.name = name
        self.color = color
        self.count = count
    }
}

/// The page to the app.
public enum PageMessage: Equatable, Sendable {
    case request(id: Int, op: BridgeOp, method: String, argsJSON: Data)
    case hud(selected: Int, slots: [HudSlot])
    case connected
    case fatal(String)
    case left

    /// Decode a message posted by the page; nil for anything malformed or unknown.
    public static func decode(_ text: String) -> PageMessage? {
        guard let object = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
            let type = object["type"] as? String
        else { return nil }
        switch type {
        case "request":
            guard let id = (object["id"] as? NSNumber)?.intValue,
                let op = (object["op"] as? String).flatMap(BridgeOp.init(rawValue:))
            else { return nil }
            let method = object["method"] as? String ?? ""
            let args = object["args"] ?? [String: Any]()
            guard JSONSerialization.isValidJSONObject(args),
                let argsJSON = try? JSONSerialization.data(withJSONObject: args, options: [.sortedKeys])
            else { return nil }
            if op != .config && method.isEmpty { return nil }
            return .request(id: id, op: op, method: method, argsJSON: argsJSON)
        case "hud":
            let selected = (object["sel"] as? NSNumber)?.intValue ?? 0
            let slots = (object["slots"] as? [[String: Any]] ?? []).compactMap { slot -> HudSlot? in
                guard let id = (slot["id"] as? NSNumber)?.intValue, let name = slot["name"] as? String else {
                    return nil
                }
                return HudSlot(
                    id: id, name: name, color: parseColor(slot["color"] as? String),
                    count: (slot["count"] as? NSNumber)?.intValue ?? 0)
            }
            return .hud(selected: selected, slots: slots)
        case "status":
            return (object["state"] as? String) == "connected" ? .connected : nil
        case "fatal":
            return .fatal(object["message"] as? String ?? "The game stopped.")
        case "left":
            return .left
        default:
            return nil
        }
    }

    static func parseColor(_ text: String?) -> UInt32 {
        guard var text else { return 0x888888 }
        if text.hasPrefix("#") { text.removeFirst() }
        return UInt32(text, radix: 16) ?? 0x888888
    }
}

/// What the on-screen controls hold down, as the game reads it.
public struct GameInput: Equatable, Sendable {
    /// -1 left, 0 still, 1 right.
    public var move: Int
    public var jump: Bool
    /// The jump button went down since the last message (a jump is an edge, not a level).
    public var jumpPressed: Bool
    public var mine: Bool
    public var place: Bool

    public init(move: Int = 0, jump: Bool = false, jumpPressed: Bool = false, mine: Bool = false, place: Bool = false) {
        self.move = move
        self.jump = jump
        self.jumpPressed = jumpPressed
        self.mine = mine
        self.place = place
    }

    public static let idle = GameInput()
}

/// The app to the page.
public enum AppMessage: Equatable, Sendable {
    /// A request's answer: `value` is JSON text, or the reason it failed.
    case response(id: Int, result: Result<String, BridgeFailure>)
    case event(kind: String)
    case input(GameInput)
    /// A tap on the game, in CSS pixels (iOS points).
    case target(x: Double, y: Double)
    case select(slot: Int)
    case zoom(Double)
    case pause
    case leave

    /// The message as JSON.
    public var json: String {
        switch self {
        case .response(let id, .success(let value)):
            return #"{"type":"response","id":\#(id),"ok":true,"value":\#(Self.checkedJSON(value))}"#
        case .response(let id, .failure(let failure)):
            return #"{"type":"response","id":\#(id),"ok":false,"error":\#(Self.string(failure.message))}"#
        case .event(let kind):
            return #"{"type":"event","kind":\#(Self.string(kind))}"#
        case .input(let input):
            return #"{"type":"input","move":\#(input.move),"jump":\#(input.jump),"jumpPressed":\#(input.jumpPressed),"#
                + #""mine":\#(input.mine),"place":\#(input.place)}"#
        case .target(let x, let y):
            return #"{"type":"target","x":\#(Self.number(x)),"y":\#(Self.number(y))}"#
        case .select(let slot):
            return #"{"type":"select","slot":\#(slot)}"#
        case .zoom(let value):
            return #"{"type":"zoom","value":\#(Self.number(value))}"#
        case .pause:
            return #"{"type":"pause"}"#
        case .leave:
            return #"{"type":"leave"}"#
        }
    }

    /// The script that delivers it to the page.
    public var script: String { "window.meroBridge && window.meroBridge.receive(\(json));" }

    static func string(_ text: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: [text]),
            let array = String(data: data, encoding: .utf8)
        else { return "\"\"" }
        return String(array.dropFirst().dropLast())
    }

    static func number(_ value: Double) -> String {
        guard value.isFinite else { return "0" }
        if value == value.rounded(), abs(value) < 1e15 { return String(Int64(value)) }
        return String(value)
    }

    /// JSON text as it is, or as a string when it is not JSON; `null` when empty.
    static func checkedJSON(_ text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "null" }
        if (try? JSONSerialization.jsonObject(with: Data(trimmed.utf8), options: [.fragmentsAllowed])) != nil {
            return trimmed
        }
        return string(trimmed)
    }
}

/// Why a request failed, in words the page shows (and matches "world not ready yet" on).
public struct BridgeFailure: Error, Equatable, Sendable {
    public let message: String
    public init(_ message: String) { self.message = message }
}

/// The page's start-up config: the world, the player's name and zoom.
public struct GameConfig: Equatable, Sendable {
    public let contextId: String
    public let name: String
    public let zoom: Double

    public init(contextId: String, name: String, zoom: Double) {
        self.contextId = contextId
        self.name = name
        self.zoom = zoom
    }

    public var json: String {
        #"{"contextId":\#(AppMessage.string(contextId)),"name":\#(AppMessage.string(name)),"zoom":\#(AppMessage.number(zoom))}"#
    }
}

/// Answers the page's contract calls with the generated client, method by method: only the
/// contract's own methods, each by its own kind (a view as `query`, a write as `execute`), with
/// its arguments decoded into the contract's types. `init` is not the page's to call.
public struct BridgeDispatcher: Sendable {
    public let client: MerrariaClient

    public init(client: MerrariaClient) {
        self.client = client
    }

    public static let views: Set<String> = ["get_overrides", "get_players", "world_meta"]
    public static let writes: Set<String> = ["heartbeat", "join", "leave", "set_tiles"]

    /// The method's JSON result.
    public func run(op: BridgeOp, method: String, argsJSON: Data) async throws -> String {
        let isView = Self.views.contains(method)
        guard isView || Self.writes.contains(method) else {
            throw BridgeFailure("\(method) is not a Merraria method the game may call")
        }
        guard op == (isView ? .query : .execute) else {
            throw BridgeFailure("\(method) is a \(isView ? "view" : "write"): send it with \(isView ? "query" : "execute")")
        }
        switch method {
        case "get_overrides":
            return try encode(try await client.getOverrides())
        case "get_players":
            let args = try decode(NowArgs.self, argsJSON)
            return try encode(try await client.getPlayers(now: args.now))
        case "world_meta":
            return try encode(try await client.worldMeta())
        case "heartbeat":
            let args = try decode(HeartbeatArgs.self, argsJSON)
            try await client.heartbeat(t: args.t, now: args.now)
            return "null"
        case "join":
            let args = try decode(JoinArgs.self, argsJSON)
            return try encode(try await client.join(name: args.name, now: args.now))
        case "leave":
            let args = try decode(NowArgs.self, argsJSON)
            try await client.leave(now: args.now)
            return "null"
        default:  // set_tiles
            let args = try decode(SetTilesArgs.self, argsJSON)
            return try encode(try await client.setTiles(edits: args.edits, now: args.now))
        }
    }

    private struct NowArgs: Decodable { let now: UInt64 }
    private struct HeartbeatArgs: Decodable {
        let t: Transform
        let now: UInt64
    }
    private struct JoinArgs: Decodable {
        let name: String
        let now: UInt64
    }
    private struct SetTilesArgs: Decodable {
        let edits: [Edit]
        let now: UInt64
    }

    private func decode<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw BridgeFailure("bad arguments: \(error)")
        }
    }

    private func encode<T: Encodable>(_ value: T) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return String(decoding: try encoder.encode(value), as: UTF8.self)
    }
}
