import Foundation
import MeroKit

/// The app's fixed values, shared with the web app and the contract's bundle. (Kotlin `KombatConstants`.)
public enum KombatConstants {
    /// The bundle's package id (`logic/Cargo.toml`), which is also the invitation link slug.
    public static let packageName = "com.calimero.mero-kombat"
    /// What a new arena is called when the field is left empty (the web app's only title).
    public static let defaultTitle = "Arena"
    /// What a fighter is called when they gave no name (the web app's placeholder).
    public static let defaultName = "Fighter"
    /// The web app's fallback poll: events are the fast path.
    public static let pollSeconds: Double = 3
    /// The web app's floor between two contract reads when events arrive in a burst.
    public static let minReadGapSeconds: Double = 0.16
    /// A corner whose presence stopped this long ago is "away" (the web app's 4 s).
    public static let presenceStaleSeconds: Double = 4
}

/// Milliseconds since the epoch: every `now` the contract takes.
public func nowMillis() -> UInt64 { UInt64(Date().timeIntervalSince1970 * 1000) }

extension KombatClient {
    /// `KombatClient` for `contextId` in the account's backend: the SDK's bound contract is the
    /// generated client's transport as is (`--transport-import MeroKit`).
    public static func bound(_ backend: any MeroAppBackend, contextId: String) -> KombatClient {
        KombatClient(transport: backend.contract.bound(to: contextId))
    }
}

/// One of the four fighters. Must match `FIGHTERS` in logic/src/lib.rs and
/// `app/src/game/fighters.ts`: the contract refuses any other id.
public struct FighterInfo: Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let title: String
    public let special: String
    /// The costume's main colour, 0xRRGGBB.
    public let color: UInt32

    public static let roster: [FighterInfo] = [
        FighterInfo(id: "kinetic", name: "KINETIC", title: "Keeper of the Ledger", special: "Mero Bolt", color: 0x8FDC0A),
        FighterInfo(id: "cryo", name: "CRYO", title: "Frost of the North Node", special: "Ice Shard", color: 0x2F7DF0),
        FighterInfo(id: "inferno", name: "INFERNO", title: "Spectre of the Burned Fork", special: "Hellfire", color: 0xF2B01E),
        FighterInfo(id: "jinzo", name: "JINZO", title: "Monk of the Open Gossip", special: "Dragon Flame", color: 0xD42A2A),
    ]

    /// The web app's `fighterOf`: an unknown id is Kinetic.
    public static func of(_ id: String) -> FighterInfo { roster.first { $0.id == id } ?? roster[0] }

    /// The CPU in practice: the first fighter that is not yours (the web app's choice).
    public static func cpu(against id: String) -> FighterInfo { roster.first { $0.id != id } ?? roster[1] }
}

/// Where the player's name and fighter live between visits, under the web app's keys.
public protocol PlayerStore: AnyObject {
    var name: String { get set }
    var fighter: String { get set }
    var muted: Bool { get set }
}

public final class DefaultsPlayerStore: PlayerStore {
    private let defaults: UserDefaults
    public init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    public var name: String {
        get { defaults.string(forKey: "mero-kombat:name") ?? "" }
        set { defaults.set(newValue, forKey: "mero-kombat:name") }
    }

    public var fighter: String {
        get { defaults.string(forKey: "mero-kombat:fighter").flatMap { $0.isEmpty ? nil : $0 } ?? "kinetic" }
        set { defaults.set(newValue, forKey: "mero-kombat:fighter") }
    }

    public var muted: Bool {
        get { defaults.bool(forKey: "mero-kombat:muted") }
        set { defaults.set(newValue, forKey: "mero-kombat:muted") }
    }
}

/// For tests and previews.
public final class MemoryPlayerStore: PlayerStore {
    public var name: String
    public var fighter: String
    public var muted: Bool
    public init(name: String = "", fighter: String = "kinetic", muted: Bool = false) {
        self.name = name
        self.fighter = fighter
        self.muted = muted
    }
}

public enum KombatError: Error, LocalizedError, Equatable {
    case noNamespace
    case noApplication
    case notAnInvitation
    case noRelay

    public var errorDescription: String? {
        switch self {
        case .noNamespace: return "This arena's namespace is not known on this device yet. Open it from Arenas and try again."
        case .noApplication: return "Mero Kombat is still being looked up in the app registry. Try again in a moment."
        case .notAnInvitation: return "That is not a Mero Kombat invitation link."
        case .noRelay: return "Your account has no relay yet. Join an arena from an invitation link first."
        }
    }
}

/// Every sentence worked out from the contract's answers. Same words as the web app. (Kotlin `KombatText`.)
public enum KombatText {
    /// The status pill: the web app's `StatusPill`.
    public static func status(_ view: ArenaView, bothLive: Bool) -> String {
        switch view.status {
        case "waiting": return "Waiting for fighters"
        case "finished": return "Match over"
        default: return bothLive ? "Round \(view.round + 1) · live" : "Round \(view.round + 1)"
        }
    }

    /// "Kinetic wins", "Draw", for a match the contract decided.
    public static func winner(_ winner: String, in view: ArenaView) -> String {
        switch winner {
        case "p1": return "\(name(view.p1)) wins"
        case "p2": return "\(name(view.p2)) wins"
        case "draw": return "Draw"
        default: return ""
        }
    }

    /// A corner's name: the one given, else "Corner 1" / "Corner 2".
    public static func name(_ fighter: FighterView) -> String {
        if !fighter.name.trimmingCharacters(in: .whitespaces).isEmpty { return fighter.name }
        return fighter.seat == "p1" ? "Corner 1" : "Corner 2"
    }

    /// "Kinetic vs Open corner".
    public static func players(_ view: ArenaView) -> String {
        let one = view.p1.member.isEmpty ? "Open corner" : name(view.p1)
        let two = view.p2.member.isEmpty ? "Open corner" : name(view.p2)
        return "\(one) vs \(two)"
    }

    /// A readable short form of an id nobody named.
    public static func shortId(_ id: String) -> String {
        id.count > 12 ? "\(id.prefix(6))…\(id.suffix(4))" : id
    }

    /// An error as one sentence. A contract refusal is already written for a player, so it is
    /// shown as it came.
    public static func error(_ error: Error) -> String {
        if let described = (error as? LocalizedError)?.errorDescription, !described.isEmpty { return described }
        let text = String(describing: error)
        return text.isEmpty ? "Something went wrong talking to the relay." : text
    }
}
