import Foundation
import MeroChessGenerated
import MeroKit

/// A table to open: its context and the namespace ("club") it lives in.
public struct TableRef: Hashable, Sendable, Identifiable {
    public let contextId: String
    public let namespaceId: String?
    public var id: String { contextId }

    public init(contextId: String, namespaceId: String?) {
        self.contextId = contextId
        self.namespaceId = namespaceId
    }
}

/// What the lobby row says about a table, from one `table()` read.
public struct TableSummary: Equatable, Sendable {
    public let title: String
    public let players: String
    public let state: String
    public let myTurn: Bool
    public let finished: Bool

    public init(_ view: TableView) {
        let view = view.named
        title = view.title.isEmpty ? ChessConstants.defaultTitle : view.title
        let white = view.white.member.isEmpty ? "Open seat" : view.white.name
        let black = view.black.member.isEmpty ? "Open seat" : view.black.name
        players = "\(white) vs \(black)"
        myTurn = view.myTurn
        finished = view.status == "finished"
        switch view.status {
        case "finished": state = "Finished · \(ChessText.score(view.result))"
        case "awaitingPlayers": state = "Waiting for players"
        default:
            if view.myTurn {
                state = "Your move"
            } else if view.myColor.isEmpty {
                state = "In progress · move \(view.moves.count / 2 + 1)"
            } else {
                state = "Their move"
            }
        }
    }
}

/// One row of the lobby.
public struct TableEntry: Identifiable, Equatable, Sendable {
    public let ref: TableRef
    public let clubName: String?
    public var summary: TableSummary?
    public var id: String { ref.contextId }
}

/// The lobby: every table in every club this account belongs to, and making and joining tables.
///
/// A table is one context, created directly in its namespace (not a subgroup), exactly as the web
/// app's `ContextPicker` does, so the namespace invitation the table mints is the one that admits
/// to it.
@MainActor
public final class LobbyModel: ObservableObject {
    @Published public private(set) var tables: [TableEntry] = []
    @Published public private(set) var clubs: [AppNamespace] = []
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
            tables = []
            clubs = []
            loaded = true
            return
        }
        loading = true
        defer {
            loading = false
            loaded = true
        }
        do {
            let namespaces = try await backend.listNamespaces()
            var entries: [TableEntry] = []
            for namespace in namespaces {
                let contexts = try await backend.listContexts(groupId: namespace.id)
                let known = Dictionary(uniqueKeysWithValues: tables.map { ($0.id, $0.summary) })
                for contextId in contexts {
                    entries.append(
                        TableEntry(
                            ref: TableRef(contextId: contextId, namespaceId: namespace.id),
                            clubName: namespace.name, summary: known[contextId] ?? nil))
                }
            }
            clubs = namespaces
            tables = entries
            error = nil
        } catch {
            self.error = ChessText.error(error)
            return
        }
        await loadSummaries()
    }

    /// Each row's title, players and whose move it is. Best-effort: a table that cannot be read
    /// yet (still syncing after a join) keeps a plain row.
    private func loadSummaries() async {
        let backend = backend
        let refs = tables.map(\.ref)
        let summaries = await withTaskGroup(of: (String, TableSummary?).self) { group in
            for ref in refs {
                group.addTask {
                    let client = MeroChessClient.bound(backend, contextId: ref.contextId)
                    let view = try? await client.table(now: nowMillis())
                    return (ref.contextId, view.map(TableSummary.init))
                }
            }
            var out: [String: TableSummary] = [:]
            for await (id, summary) in group { if let summary { out[id] = summary } }
            return out
        }
        tables = tables.map { entry in
            var copy = entry
            if let summary = summaries[entry.id] { copy.summary = summary }
            return copy
        }
    }

    /// A new table: in `clubId`, or in a new club named after the table when nil.
    public func create(title: String, clubId: String?) async throws -> TableRef {
        guard backend.hasRelay else { throw ChessError.noRelay }
        guard let applicationId, !applicationId.isEmpty else { throw ChessError.noApplication }
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let name = trimmed.isEmpty ? ChessConstants.defaultTitle : String(trimmed.prefix(64))
        let namespaceId: String
        if let clubId {
            namespaceId = clubId
        } else {
            namespaceId = try await backend.foundNamespace(name: name).namespaceId
        }
        let contextId = try await backend.createContext(
            groupId: namespaceId, applicationId: applicationId, name: name,
            initArgs: .object(["title": .string(name), "now": .number(Double(nowMillis()))]))
        let ref = TableRef(contextId: contextId, namespaceId: namespaceId)
        tables.insert(TableEntry(ref: ref, clubName: clubs.first { $0.id == namespaceId }?.name ?? name), at: 0)
        return ref
    }

    /// Redeem an invitation: join its namespace, which admits to every table directly in it.
    /// `didJoin` runs after (the session reconnects to the admitting relay there when the account
    /// had none). The table may take a moment to sync; the table screen polls until it reads.
    public func join(_ invitation: ChessInvitation, didJoin: () async -> Void) async throws -> TableRef {
        _ = try await backend.joinNamespace(namespaceId: invitation.namespaceId, invitation: invitation.invitation)
        await didJoin()
        return TableRef(contextId: invitation.contextId, namespaceId: invitation.namespaceId)
    }

    /// A link that admits someone to `ref`'s club and opens that table.
    public func inviteLink(_ ref: TableRef) async throws -> String {
        guard let namespaceId = ref.namespaceId else { throw ChessError.noNamespace }
        let signed = try await backend.createInvitation(namespaceId: namespaceId)
        return try ChessInvitation(invitation: signed, namespaceId: namespaceId, contextId: ref.contextId).link()
    }

    public func dismissError() { error = nil }
}
