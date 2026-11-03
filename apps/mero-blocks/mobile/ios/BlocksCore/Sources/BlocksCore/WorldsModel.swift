import Foundation
import MeroKit

/// A world to open: its app instance and the organization it is the only world of. `groupId` is
/// kept for links from the earlier 1.0 build (a world's team); new worlds have none.
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
    /// Players online now, once read (`getPlayers`).
    public var online: Int?
    public var id: String { ref.contextId }
}

/// The worlds this account is in, and making, joining, sharing and leaving them.
///
/// The web app's model (`app/src/net/worlds.ts` `createWorld`): every world is its OWN
/// organization, named after the world, with the world's app instance in it. Invitations are org
/// invites, so one link admits to exactly one world, and the org grants its app instance.
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

    /// The worlds in one organization: its app instances (the web's), else those in its teams
    /// (worlds the earlier 1.0 build made).
    private func refs(in namespace: AppNamespace) async throws -> [WorldRef] {
        let fallback = namespace.name ?? BlocksConstants.defaultWorldName
        var out = try await backend.listContextEntries(groupId: namespace.id).map {
            WorldRef(contextId: $0.id, namespaceId: namespace.id, groupId: nil, name: $0.name ?? fallback)
        }
        if out.isEmpty {
            for subgroup in try await backend.listSubgroups(namespaceId: namespace.id) {
                for contextId in subgroup.contextIds {
                    out.append(
                        WorldRef(
                            contextId: contextId, namespaceId: namespace.id, groupId: subgroup.groupId,
                            name: subgroup.name ?? fallback))
                }
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

    /// A new world: its own organization and the app instance in it, with the contract's `init`
    /// arguments (`name`, `seed`, `now`; u64 as decimal strings), as the web's `createWorld`.
    public func create(name rawName: String, seed: UInt64?) async throws -> WorldRef {
        guard backend.hasRelay else { throw BlocksError.signedOut }
        guard let applicationId, !applicationId.isEmpty else { throw BlocksError.noApplication }
        let name = BlocksText.worldName(rawName)
        let seed = seed ?? UInt64.random(in: BlocksConstants.seedRange)
        let founded = try await backend.foundNamespace(name: name)
        let contextId = try await backend.createContext(
            groupId: founded.namespaceId, applicationId: applicationId, name: name,
            initArgs: .object([
                "name": .string(name), "seed": .string(String(seed % 4_294_967_296)), "now": .string(String(nowSeconds())),
            ]))
        let ref = WorldRef(contextId: contextId, namespaceId: founded.namespaceId, groupId: nil, name: name)
        worlds.insert(WorldEntry(ref: ref, online: 0), at: 0)
        return ref
    }

    /// Redeem an invitation: redeem its token, joining the world's organization. `didJoin` runs
    /// after (the session re-reads what the account sees). The world's app instance is entered
    /// when it is opened (``GameModel/prepare()``).
    public func join(_ invitation: BlocksInvitation, didJoin: () async -> Void) async throws -> WorldRef {
        let joined = try await backend.joinNamespace(namespaceId: invitation.namespaceId, invitation: invitation.invitation)
        // The node names the organization the token opened (a web link carries none).
        let namespaceId = joined.namespaceId.isEmpty ? invitation.namespaceId : joined.namespaceId
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

    /// A link that admits someone to `ref`'s world. Minting it asks for the passkey (the node's step-up).
    public func inviteLink(_ ref: WorldRef) async throws -> String {
        let invitation = try await backend.createInvitation(namespaceId: ref.namespaceId)
        return try BlocksInvitation(invitation: invitation, name: ref.name, contextId: ref.contextId, groupId: ref.groupId)
            .link()
    }

    /// Leave a world: leave its organization, which is that world alone.
    public func leave(_ ref: WorldRef) async throws {
        try await backend.leaveNamespace(namespaceId: ref.namespaceId)
        worlds.removeAll { $0.id == ref.contextId }
    }

    public func dismissError() { error = nil }
    public func dismissNotice() { notice = nil }
}
