import Foundation
import GameGenerated
import LobbyGenerated
import MeroKit

/// Constants shared with the web app and the bundle. (Kotlin `Battleships`.)
public enum Battleships {
    /// The registry package and invitation-link slug (`APP_SLUG` on the web).
    public static let packageName = "com.calimero.battleships"
    /// The bundle's two services (`service_name` at context creation).
    public static let lobbyService = "lobby"
    public static let gameService = "game"
    /// How often an open lobby or match is re-read: the only refresh when the relay cannot
    /// stream, and a safety net when it can (a dropped event must not stall a match).
    public static let pollInterval: Duration = .seconds(5)
}

/// Why an action was refused before it reached the relay, in words a person can act on.
public enum BattleshipsError: Error, Equatable, LocalizedError {
    case invalid(String)

    public var errorDescription: String? {
        switch self {
        case .invalid(let message): return message
        }
    }
}

// MARK: - The backend

/// What the screens need beyond ``MeroAppBackend``: the bundle has two services, and the SDK's
/// `createContext` names none. The relay's admin does take a `serviceName` (as the web app's
/// `admin.createContext({ serviceName })`), so ``AdminBattleshipsBackend`` goes through it.
/// (Kotlin `BattleshipsBackend`.)
public protocol BattleshipsBackend: Sendable {
    var app: any MeroAppBackend { get }
    /// Create a context running `service` of the bundle in `groupId`, with its `init` arguments.
    func createServiceContext(
        groupId: String, applicationId: String, service: String, name: String, initArgs: JSONValue
    ) async throws -> String
    /// Which service a context runs (`Context.serviceName`), `nil` when the relay does not say.
    func serviceName(contextId: String) async throws -> String?
}

/// ``BattleshipsBackend`` over the session's backend and the account's admin
/// (`DelegatedAppBackend.admin`): a context is created as a delegated context intent carrying the
/// service name, and read back through the relay's caller-scoped `GET /contexts/{id}`.
public struct AdminBattleshipsBackend: BattleshipsBackend {
    public let app: any MeroAppBackend
    public let admin: any AdminSurface

    public init(app: any MeroAppBackend, admin: any AdminSurface) {
        self.app = app
        self.admin = admin
    }

    public func createServiceContext(
        groupId: String, applicationId: String, service: String, name: String, initArgs: JSONValue
    ) async throws -> String {
        let created = try await admin.createContext(
            CreateContextRequest(
                applicationId: applicationId, groupId: groupId, serviceName: service,
                initializationParams: CanonicalJSON.data(initArgs).map { Int($0) }, name: name))
        return created.contextId
    }

    public func serviceName(contextId: String) async throws -> String? {
        try await admin.getContext(contextId).serviceName
    }
}

// MARK: - Contract clients

/// MeroKit's bound contract as the lobby client's transport. The protocols match; they are
/// separate types only because the generated file declares its own.
struct LobbyTransport: LobbyGenerated.ContextContractCalling {
    let bound: BoundContextContract

    func query(method: String, argsJSON: Data) async throws -> Data {
        try await bound.query(method: method, argsJSON: argsJSON)
    }

    func execute(method: String, argsJSON: Data) async throws -> Data {
        try await bound.execute(method: method, argsJSON: argsJSON)
    }
}

/// As ``LobbyTransport``, for the game client.
struct GameTransport: GameGenerated.ContextContractCalling {
    let bound: BoundContextContract

    func query(method: String, argsJSON: Data) async throws -> Data {
        try await bound.query(method: method, argsJSON: argsJSON)
    }

    func execute(method: String, argsJSON: Data) async throws -> Data {
        try await bound.execute(method: method, argsJSON: argsJSON)
    }
}

extension LobbyClient {
    /// The lobby service's client in one context, over the account's relay.
    public static func make(_ contract: any ContextContract, contextId: String) -> LobbyClient {
        LobbyClient(transport: LobbyTransport(bound: contract.bound(to: contextId)))
    }
}

extension GameClient {
    /// The game service's client in one context, over the account's relay.
    public static func make(_ contract: any ContextContract, contextId: String) -> GameClient {
        GameClient(transport: GameTransport(bound: contract.bound(to: contextId)))
    }

    /// `reveal_board`, with the salt as the JSON array of 16 numbers the contract's `[u8; 16]`
    /// reads (what the web app's `CalimeroBytes` sends). The generated `revealBoard` types a
    /// fixed-size `bytes` as a `String`, which the contract refuses, so this one call is written
    /// out; every other call goes through the generated client.
    public func reveal(matchId: String, cells: [UInt8], salt: [UInt8]) async throws {
        struct Args: Encodable {
            let match_id: String
            let board_bytes: [UInt8]
            let salt: [UInt8]
        }
        let args = try JSONEncoder().encode(
            Args(match_id: matchId, board_bytes: Commitment.boardBytes(cells), salt: salt))
        _ = try await transport.execute(method: "reveal_board", argsJSON: args)
    }

    /// `get_current_turn`, `nil` once the match is over (the contract returns `None`, which the
    /// generated `String` decode refuses).
    public func currentTurn() async -> String? {
        try? await getCurrentTurn()
    }
}

// MARK: - Errors in words

/// Errors as a person reads them: offline, no relay, or what the contract said, humanised as the
/// web app's `friendlyContractMessage`. (Kotlin `ErrorText`.)
public enum ErrorText {
    public static func describe(_ error: Error, fallback: String = "Something went wrong. Try again.") -> String {
        if let error = error as? BattleshipsError { return error.errorDescription ?? fallback }
        if let error = error as? URLError {
            switch error.code {
            case .notConnectedToInternet, .networkConnectionLost, .cannotFindHost, .cannotConnectToHost, .timedOut:
                return "You're offline. Check your connection and try again."
            default: break
            }
        }
        if let error = error as? AccountError, case .noRelay = error {
            return "No relay serves your account yet. Join a lobby from an invitation first."
        }
        let raw = "\(error)"
        if let contract = contractMessage(raw) { return humanise(contract) }
        let lowered = raw.lowercased()
        if lowered.contains("offline") || lowered.contains("timed out") {
            return "You're offline. Check your connection and try again."
        }
        let humane = humanise(raw)
        return humane == raw ? fallback : humane
    }

    /// Whether the contract refused because the match is over.
    public static func isFinished(_ error: Error) -> Bool {
        let raw = contractMessage("\(error)")?.lowercased() ?? ""
        return raw.contains("finished")
    }

    /// Whether a shot was refused because the opponent has not placed a fleet yet.
    public static func isOpponentNotReady(_ error: Error) -> Bool {
        let raw = (contractMessage("\(error)") ?? "\(error)").lowercased()
        return raw.contains("place ships") || raw.contains("not committed") || raw.contains("no commitment")
    }

    private static let humanised: [(String, String)] = [
        ("player2 is not a valid hex key", "That is not a valid player key."),
        ("cannot create match against self", "You cannot challenge yourself."),
        ("unknown match_id", "That match no longer exists in this lobby."),
        ("match not in pending state", "That match has already started."),
        ("not a player", "You are not a player in this match."),
        ("not your turn", "It is not your turn yet."),
        ("a shot is already pending", "Your last shot is still being answered."),
        ("already shot", "You have already fired at that square."),
        ("out of bounds", "That square is off the board."),
        ("finished", "This match is already finished."),
    ]

    static func humanise(_ message: String) -> String {
        let lowered = message.lowercased()
        for (pattern, text) in humanised where lowered.contains(pattern) { return text }
        return message
    }

    /// The contract's `{"kind": …, "data": …}` error, wherever it sits in `raw`: as JSON, or as
    /// the decimal UTF-8 bytes of that JSON (what a node puts in an error body).
    static func contractMessage(_ raw: String) -> String? {
        for candidate in [raw] + decodedByteRuns(raw) {
            for run in balancedObjects(candidate) {
                guard let data = run.data(using: .utf8),
                    let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                    let kind = object["kind"] as? String, !kind.isEmpty
                else { continue }
                if let text = object["data"] as? String, !text.isEmpty { return text }
                return kind == "Finished" ? "This match is already finished." : kind
            }
        }
        return nil
    }

    private static func balancedObjects(_ text: String) -> [String] {
        var out: [String] = []
        let chars = Array(text)
        var i = 0
        while i < chars.count {
            if chars[i] == "{" {
                var depth = 0
                var inString = false
                var escaped = false
                var j = i
                while j < chars.count {
                    let c = chars[j]
                    if escaped {
                        escaped = false
                    } else if c == "\\" {
                        escaped = true
                    } else if c == "\"" {
                        inString.toggle()
                    } else if !inString {
                        if c == "{" { depth += 1 }
                        if c == "}" {
                            depth -= 1
                            if depth == 0 {
                                out.append(String(chars[i...j]))
                                break
                            }
                        }
                    }
                    j += 1
                }
            }
            i += 1
        }
        return out
    }

    private static func decodedByteRuns(_ text: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: "\\[(\\s*\\d{1,3}\\s*,){3,}\\s*\\d{1,3}\\s*\\]") else {
            return []
        }
        let range = NSRange(text.startIndex..., in: text)
        return regex.matches(in: text, range: range).compactMap { match in
            guard let r = Range(match.range, in: text) else { return nil }
            let bytes = text[r].dropFirst().dropLast().split(separator: ",").compactMap {
                UInt8($0.trimmingCharacters(in: .whitespaces))
            }
            return String(bytes: bytes, encoding: .utf8)
        }
    }
}

/// How a person is shown: a short handle from their key, until a name is known. (Kotlin `Names`.)
public enum Names {
    public static func short(_ key: String) -> String {
        guard key.count > 10 else { return key }
        return "\(key.prefix(6))…\(key.suffix(4))"
    }

    /// "You", or "Player 3fa2c1".
    public static func player(_ key: String, me: String?) -> String {
        if let me, key.lowercased() == me.lowercased() { return "You" }
        return "Player \(key.prefix(6))"
    }

    public static func lobby(_ namespace: AppNamespace) -> String {
        if let name = namespace.name?.trimmingCharacters(in: .whitespaces), !name.isEmpty { return name }
        return "Lobby \(namespace.id.prefix(6))"
    }
}

/// Where a screen's first load stands.
public enum LoadPhase: Equatable, Sendable {
    case loading
    case loaded
    case failed(String)
}

/// A match as the lobby lists it and the match screen opens it. (Kotlin `MatchRef`.)
public struct MatchRef: Hashable, Sendable {
    public let namespaceId: String
    public let lobbyContextId: String
    public let matchId: String
    public let contextId: String
    public let opponent: String

    public init(namespaceId: String, lobbyContextId: String, matchId: String, contextId: String, opponent: String) {
        self.namespaceId = namespaceId
        self.lobbyContextId = lobbyContextId
        self.matchId = matchId
        self.contextId = contextId
        self.opponent = opponent
    }
}

/// Sleep that a cancelled task wakes from.
func pause(_ duration: Duration) async {
    try? await Task.sleep(for: duration)
}
