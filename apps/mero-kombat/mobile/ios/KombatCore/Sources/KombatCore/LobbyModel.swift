import Foundation
import MeroKit

/// An arena to open: its context and the namespace it lives in.
public struct ArenaRef: Hashable, Sendable, Identifiable {
    public let contextId: String
    public let namespaceId: String?
    public var id: String { contextId }

    public init(contextId: String, namespaceId: String?) {
        self.contextId = contextId
        self.namespaceId = namespaceId
    }
}

/// What the lobby row says about an arena, from one `arena()` read.
public struct ArenaSummary: Equatable, Sendable {
    public let title: String
    public let players: String
    public let state: String
    /// This account holds a corner here.
    public let mine: Bool
    /// A fight is under way.
    public let live: Bool
    /// Fighters for the row's two portraits, p1 then p2 ("" for an open corner).
    public let fighters: [String]
    public let totalActions: UInt64

    public init(_ view: ArenaView) {
        title = view.title.isEmpty ? KombatConstants.defaultTitle : view.title
        players = KombatText.players(view)
        mine = !view.mySeat.isEmpty
        live = view.status == "fighting"
        fighters = [view.p1.member.isEmpty ? "" : view.p1.fighter, view.p2.member.isEmpty ? "" : view.p2.fighter]
        totalActions = view.totalActions
        switch view.status {
        case "waiting": state = "Waiting for fighters"
        case "finished": state = KombatText.winner(view.winner, in: view).isEmpty ? "Match over" : KombatText.winner(view.winner, in: view)
        default: state = "Round \(view.round + 1)"
        }
    }
}

/// One row of the lobby.
public struct ArenaEntry: Identifiable, Equatable, Sendable {
    public let ref: ArenaRef
    public let namespaceName: String?
    public var summary: ArenaSummary?
    public var id: String { ref.contextId }
}

/// The lobby: every arena in every namespace this account belongs to, and making and joining
/// arenas. (Kotlin `LobbyModel`.)
///
/// An arena is one context created directly in its namespace, exactly as the web app's
/// `ContextPicker` does, so the namespace invitation an arena mints is the one that admits to it.
@MainActor
public final class LobbyModel: ObservableObject {
    @Published public private(set) var arenas: [ArenaEntry] = []
    @Published public private(set) var namespaces: [AppNamespace] = []
    @Published public private(set) var loading = false
    @Published public private(set) var loaded = false
    @Published public private(set) var error: String?

    private let backend: any MeroAppBackend
    private let applicationId: String?

    public init(backend: any MeroAppBackend, applicationId: String?) {
        self.backend = backend
        self.applicationId = applicationId
    }

    public var hasRelay: Bool { backend.hasRelay }

    public func load() async {
        guard backend.hasRelay else {
            arenas = []
            namespaces = []
            loaded = true
            return
        }
        loading = true
        defer {
            loading = false
            loaded = true
        }
        do {
            let found = try await backend.listNamespaces()
            let known = Dictionary(uniqueKeysWithValues: arenas.map { ($0.id, $0.summary) })
            var entries: [ArenaEntry] = []
            for namespace in found {
                for contextId in try await backend.listContexts(groupId: namespace.id) {
                    entries.append(
                        ArenaEntry(
                            ref: ArenaRef(contextId: contextId, namespaceId: namespace.id),
                            namespaceName: namespace.name, summary: known[contextId] ?? nil))
                }
            }
            namespaces = found
            arenas = entries
            error = nil
        } catch {
            self.error = KombatText.error(error)
            return
        }
        await loadSummaries()
    }

    /// Each row's title, corners and state. Best-effort: an arena still syncing keeps a plain row.
    private func loadSummaries() async {
        let backend = backend
        let refs = arenas.map(\.ref)
        let summaries = await withTaskGroup(of: (String, ArenaSummary?).self) { group in
            for ref in refs {
                group.addTask {
                    let view = try? await KombatClient.bound(backend, contextId: ref.contextId).arena(now: nowMillis())
                    return (ref.contextId, view.map(ArenaSummary.init))
                }
            }
            var out: [String: ArenaSummary] = [:]
            for await (id, summary) in group { if let summary { out[id] = summary } }
            return out
        }
        arenas = arenas.map { entry in
            var copy = entry
            if let summary = summaries[entry.id] { copy.summary = summary }
            return copy
        }
    }

    /// A new arena: in organization `namespaceId`, or in a new one named after the arena when nil.
    public func create(title: String, namespaceId: String?) async throws -> ArenaRef {
        guard backend.hasRelay else { throw KombatError.signedOut }
        guard let applicationId, !applicationId.isEmpty else { throw KombatError.noApplication }
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let name = trimmed.isEmpty ? KombatConstants.defaultTitle : String(trimmed.prefix(64))
        let target: String
        if let namespaceId {
            target = namespaceId
        } else {
            target = try await backend.foundNamespace(name: name).namespaceId
        }
        // The contract's `init(title, now)`, as the web app's `arenaInit()` sends it.
        let contextId = try await backend.createContext(
            groupId: target, applicationId: applicationId, name: name,
            initArgs: .object(["title": .string(name), "now": .number(Double(nowMillis()))]))
        let ref = ArenaRef(contextId: contextId, namespaceId: target)
        arenas.insert(ArenaEntry(ref: ref, namespaceName: namespaces.first { $0.id == target }?.name ?? name), at: 0)
        return ref
    }

    /// Redeem an invitation: redeem its token, joining the organization, which admits to every
    /// arena directly in it. `didJoin` runs after (the session re-reads what the account sees).
    /// The arena screen polls until it reads.
    public func join(_ invitation: KombatInvitation, didJoin: () async -> Void) async throws -> ArenaRef {
        _ = try await backend.joinNamespace(namespaceId: invitation.namespaceId, invitation: invitation.invitation)
        await didJoin()
        return ArenaRef(contextId: invitation.contextId, namespaceId: invitation.namespaceId)
    }

    /// A link that admits someone to `ref`'s namespace and opens that arena.
    public func inviteLink(_ ref: ArenaRef) async throws -> String {
        guard let namespaceId = ref.namespaceId else { throw KombatError.noNamespace }
        let invitation = try await backend.createInvitation(namespaceId: namespaceId)
        return try KombatInvitation(invitation: invitation, contextId: ref.contextId).link()
    }

    public func dismissError() { error = nil }
}
