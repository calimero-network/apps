import Foundation

/// The game page's mode: the web engine's `Mode`.
public enum GameMode: String, Sendable, Equatable {
    /// Practice against the CPU: no contract, no presence.
    case cpu
    /// A real fight: this phone plays one corner.
    case net
    /// Both corners are someone else.
    case spectate
}

/// A message from the game page (`web/src/protocol.ts`, `ToNative`). (Kotlin `BridgeInbound`.)
public enum BridgeInbound: Equatable, Sendable {
    public enum CallKind: String, Sendable { case query, execute }

    /// The page has loaded and listens: send it `boot` (and the latest state).
    case ready
    /// `window.meroBridge.query/execute(method, args)`; answer with ``BridgeOutbound/result(id:valueJSON:)``.
    case call(id: Int, kind: CallKind, method: String, argsJSON: String)
    /// This fighter's presence slice, as JSON text: published as is.
    case presence(sliceJSON: String)
    /// Practice: the match ended (or restarted).
    case over(Bool)

    /// Decode one posted message; nil for anything that is not a version-1 message this app knows.
    public static func decode(_ body: String) -> BridgeInbound? {
        guard let data = body.data(using: .utf8),
            let object = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) as? [String: Any],
            (object["v"] as? NSNumber)?.intValue == 1,
            let op = object["op"] as? String
        else { return nil }
        switch op {
        case "ready":
            return .ready
        case "query", "execute":
            guard let id = (object["id"] as? NSNumber)?.intValue, let method = object["method"] as? String,
                !method.isEmpty
            else { return nil }
            let args = object["args"].flatMap(jsonText) ?? "{}"
            return .call(id: id, kind: op == "query" ? .query : .execute, method: method, argsJSON: args)
        case "presence":
            guard let slice = object["slice"], slice is [String: Any], let text = jsonText(slice) else { return nil }
            return .presence(sliceJSON: text)
        case "over":
            guard let over = object["over"] as? Bool else { return nil }
            return .over(over)
        default:
            return nil
        }
    }

    private static func jsonText(_ value: Any) -> String? {
        if value is NSNull { return "null" }
        guard JSONSerialization.isValidJSONObject(value) else { return nil }
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes])
        else { return nil }
        return String(decoding: data, as: UTF8.self)
    }
}

/// A message to the game page (`ToPage`), delivered as ``script``. (Kotlin `BridgeOutbound`.)
public enum BridgeOutbound: Equatable, Sendable {
    case boot(mode: GameMode, local: Int?, fighters: [String], muted: Bool)
    /// The contract's latest `arena()` read, as the generated client serialises `ArenaView`.
    case state(viewJSON: String)
    /// The opponent's presence slice, as it arrived.
    case slice(json: String)
    case press(PadButton, down: Bool)
    case result(id: Int, valueJSON: String)
    case failure(id: Int, message: String)
    case pause
    case resume
    case restart
    case mute(Bool)

    /// The message as JSON text.
    public var json: String {
        switch self {
        case .boot(let mode, let local, let fighters, let muted):
            let seat = local.map(String.init) ?? "null"
            let pair = fighters.map(Self.string).joined(separator: ",")
            return #"{"t":"boot","mode":"\#(mode.rawValue)","local":\#(seat),"fighters":[\#(pair)],"muted":\#(muted)}"#
        case .state(let view):
            return #"{"t":"state","view":\#(view)}"#
        case .slice(let slice):
            return #"{"t":"slice","slice":\#(slice)}"#
        case .press(let button, let down):
            return #"{"t":"press","b":"\#(button.rawValue)","d":\#(down)}"#
        case .result(let id, let value):
            return #"{"t":"result","id":\#(id),"ok":true,"value":\#(value)}"#
        case .failure(let id, let message):
            return #"{"t":"result","id":\#(id),"ok":false,"error":\#(Self.string(message))}"#
        case .pause:
            return #"{"t":"pause"}"#
        case .resume:
            return #"{"t":"resume"}"#
        case .restart:
            return #"{"t":"restart"}"#
        case .mute(let on):
            return #"{"t":"mute","on":\#(on)}"#
        }
    }

    /// The JavaScript that delivers it; a no-op until the page has defined `meroGame`.
    public var script: String { "window.meroGame&&window.meroGame.receive(\(json));" }

    /// A JSON string literal.
    static func string(_ text: String) -> String {
        let data = (try? JSONEncoder().encode(text)) ?? Data("\"\"".utf8)
        return String(decoding: data, as: UTF8.self)
    }
}

/// Where the game page's contract calls go: the generated client, method by method. Only what the
/// engine calls is open to it (`act`, and the two reads); anything else is refused, so a page can
/// never sit, stand or rematch on the player's behalf. (Kotlin `GameCalls`.)
public struct GameCalls: Sendable {
    public let client: KombatClient

    public init(client: KombatClient) { self.client = client }

    /// The `act` arguments as the web engine sends them (the ABI's snake_case).
    struct ActArgs: Decodable {
        let match_index: UInt32
        let round: UInt32
        let id: UInt32
        let kind: String
        let hit: Bool
        let blocked: Bool
        let now: UInt64?
    }

    struct ArenaArgs: Decodable {
        let now: UInt64?
    }

    /// Answer one `call`: a `result` with the method's return value, or a `failure`.
    public func handle(id: Int, kind: BridgeInbound.CallKind, method: String, argsJSON: String) async -> BridgeOutbound {
        do {
            let args = Data(argsJSON.utf8)
            switch (kind, method) {
            case (.execute, "act"):
                let a = try JSONDecoder().decode(ActArgs.self, from: args)
                try await client.act(
                    matchIndex: a.match_index, round: a.round, id: a.id, kind: a.kind, hit: a.hit, blocked: a.blocked,
                    now: a.now ?? nowMillis())
                return .result(id: id, valueJSON: "null")
            case (.query, "arena"):
                let a = try? JSONDecoder().decode(ArenaArgs.self, from: args)
                let view = try await client.arena(now: a?.now ?? nowMillis())
                return .result(id: id, valueJSON: try Self.encode(view))
            case (.query, "history"):
                return .result(id: id, valueJSON: try Self.encode(try await client.history()))
            default:
                return .failure(id: id, message: "\(method) is not open to the game page")
            }
        } catch {
            return .failure(id: id, message: KombatText.error(error))
        }
    }

    /// A generated type as the page reads it (the ABI's field names).
    public static func encode<T: Encodable>(_ value: T) throws -> String {
        String(decoding: try JSONEncoder().encode(value), as: UTF8.self)
    }
}
