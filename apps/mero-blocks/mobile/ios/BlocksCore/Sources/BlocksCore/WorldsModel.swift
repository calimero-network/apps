import Foundation
import MeroKit

/// A world to open: its context, the namespace it is the only world of, and its open subgroup.
public struct WorldRef: Hashable, Sendable, Identifiable {
    public let contextId: String
    public let namespaceId: String
    public let groupId: String?
    public let name: String
    public var id: String { contextId }

    public init(contextId: String, namespaceId: String, groupId: String?, name: String) {
        self.contextId = contextId
        self.namespaceId = namespaceId
        self.groupId = groupId
        self.name = name
    }
}

/// One row of the world list.
public struct WorldEntry: Identifiable, Equatable, Sendable {
    public let ref: WorldRef
    /// Players online now, once read (`get_players`).
    public var online: Int?
    public var id: String { ref.contextId }
}

/// The worlds this account is in, and making, joining, sharing and leaving them.
///
/// The web app's model (`app/src/net/admin.ts` `createWorld`): every world is its OWN namespace,
/// named after the world, with one open subgroup and the world's context in it. Invitations are
/// namespace invitations, so one link admits to exactly one world, and the open subgroup lets the
/// invitee join the context by inheritance.
@MainActor
public final class WorldsModel: ObservableObject {
    @Published public private(set) var worlds: [WorldEntry] = []
    @Published public private(set) var loading = false
    @Published public private(set) var loaded = false
    @Published public private(set) var error: String?
    /// Said once after creating a world the cloud would not host.
    @Published public private(set) var notice: String?

    private let backend: any MeroAppBackend
    private let applicationId: String?

    public init(backend: any MeroAppBackend, applicationId: String?) {
        self.backend = backend
        self.applicationId = applicationId
    }

    public var hasRelay: Bool { backend.hasRelay }

    public func load() async {
        guard backend.hasRelay else {
            worlds = []
            loaded = true
            return
        }
        loading = true
        defer {
            loading = false
            loaded = true
        }
        do {
            let known = Dictionary(uniqueKeysWithValues: worlds.map { ($0.id, $0.online) })
            var entries: [WorldEntry] = []
            for namespace in try await backend.listNamespaces() {
                for ref in try await refs(in: namespace) {
                    entries.append(WorldEntry(ref: ref, online: known[ref.contextId] ?? nil))
                }
            }
            worlds = entries
            error = nil
        } catch {
            self.error = BlocksText.error(error)
            return
        }
        await loadOnline()
    }

    /// The worlds in one namespace: the context of each subgroup, else any in its root (a
    /// curb-style namespace with no subgroup).
    private func refs(in namespace: AppNamespace) async throws -> [WorldRef] {
        var out: [WorldRef] = []
        for subgroup in try await backend.listSubgroups(namespaceId: namespace.id) {
            let name = subgroup.name ?? namespace.name ?? BlocksConstants.defaultWorldName
            for contextId in subgroup.contextIds {
                out.append(WorldRef(contextId: contextId, namespaceId: namespace.id, groupId: subgroup.groupId, name: name))
            }
        }
        if out.isEmpty {
            for contextId in try await backend.listContexts(groupId: namespace.id) {
                out.append(
                    WorldRef(
                        contextId: contextId, namespaceId: namespace.id, groupId: nil,
                        name: namespace.name ?? BlocksConstants.defaultWorldName))
            }
        }
        return out
    }

    /// Who is playing in each world. Best-effort: a world that cannot be read yet keeps its row.
    private func loadOnline() async {
        let backend = backend
        let refs = worlds.map(\.ref)
        let counts = await withTaskGroup(of: (String, Int?).self) { group in
            for ref in refs {
                group.addTask {
                    let client = BlocksClient(transport: backend.contract.bound(to: ref.contextId))
                    let players = try? await client.getPlayers(now: nowSeconds())
                    return (ref.contextId, players.map { $0.filter(\.online).count })
                }
            }
            var out: [String: Int] = [:]
            for await (id, count) in group { if let count { out[id] = count } }
            return out
        }
        worlds = worlds.map { entry in
            var copy = entry
            if let count = counts[entry.id] { copy.online = count }
            return copy
        }
    }

    /// A new world: its own namespace, an open subgroup, and the context with the contract's
    /// `init` arguments (`name`, `seed`, `now`).
    public func create(name rawName: String, seed: UInt64?) async throws -> WorldRef {
        guard backend.hasRelay else { throw BlocksError.noRelay }
        guard let applicationId, !applicationId.isEmpty else { throw BlocksError.noApplication }
        let name = BlocksText.worldName(rawName)
        let seed = seed ?? UInt64.random(in: BlocksConstants.seedRange)
        let founded = try await backend.foundNamespace(name: name)
        let groupId = try await backend.createSubgroup(namespaceId: founded.namespaceId, name: name, isPublic: true)
        let contextId = try await backend.createContext(
            groupId: groupId, applicationId: applicationId, name: name,
            initArgs: .object(["name": .string(name), "seed": .number(Double(seed)), "now": .number(Double(nowSeconds()))]))
        let ref = WorldRef(contextId: contextId, namespaceId: founded.namespaceId, groupId: groupId, name: name)
        worlds.insert(WorldEntry(ref: ref, online: 0), at: 0)
        if !founded.haEnabled {
            notice =
                "The cloud is not hosting this world yet\(founded.haError.map { " (\($0))" } ?? ""). You can play, but friends may not be able to join while you are offline."
        }
        return ref
    }

    /// Redeem an invitation: join the world's namespace. `didJoin` runs after (the session
    /// reconnects to the admitting relay there when the account had none). The world's context
    /// is joined when it is opened (``GameModel/prepare()``).
    public func join(_ invitation: BlocksInvitation, didJoin: () async -> Void) async throws -> WorldRef {
        let namespaceId = invitation.namespaceId
        _ = try await backend.joinNamespace(namespaceId: namespaceId, invitation: invitation.invitation)
        await didJoin()
        let name = invitation.name ?? BlocksConstants.defaultWorldName
        if let contextId = invitation.contextId {
            return WorldRef(contextId: contextId, namespaceId: namespaceId, groupId: invitation.groupId, name: name)
        }
        // A link without a pinned world: the namespace's first.
        let found = try await refs(in: AppNamespace(id: namespaceId, name: invitation.name, applicationId: applicationId ?? ""))
        guard let first = found.first else { throw BlocksError.noWorldInInvitation }
        return first
    }

    /// A link that admits someone to `ref`'s world.
    public func inviteLink(_ ref: WorldRef) async throws -> String {
        let signed = try await backend.createInvitation(namespaceId: ref.namespaceId)
        return try BlocksInvitation(invitation: signed, name: ref.name, contextId: ref.contextId, groupId: ref.groupId).link()
    }

    /// Leave a world: leave its namespace, which is that world alone.
    public func leave(_ ref: WorldRef) async throws {
        try await backend.leaveNamespace(namespaceId: ref.namespaceId)
        worlds.removeAll { $0.id == ref.contextId }
    }

    public func dismissError() { error = nil }
    public func dismissNotice() { notice = nil }
}
