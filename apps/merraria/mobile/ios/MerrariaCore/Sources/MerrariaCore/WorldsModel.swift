import Foundation
import MeroKit

/// A world to open: its context, and where it lives.
public struct WorldRef: Hashable, Sendable, Identifiable {
    public let contextId: String
    public let namespaceId: String
    /// The open subgroup the world is in (nil for a world directly in its namespace).
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
    public let players: Int
    public var id: String { ref.contextId }
}

/// The worlds: every world this account is in, and creating, joining and inviting to them.
///
/// As on the web (`app/src/net/admin.ts`), a world is its own namespace named after it, an open
/// subgroup inside that, and the context (the world state) in the subgroup. One namespace per
/// world keeps an invitation's scope to exactly one world, and the subgroup being open is what lets
/// an invited player join it.
@MainActor
public final class WorldsModel: ObservableObject {
    @Published public private(set) var worlds: [WorldEntry] = []
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
            var entries: [WorldEntry] = []
            for namespace in try await backend.listNamespaces() {
                let name = namespace.name?.trimmingCharacters(in: .whitespaces)
                var seen = Set<String>()
                for subgroup in try await backend.listSubgroups(namespaceId: namespace.id) {
                    for contextId in subgroup.contextIds where seen.insert(contextId).inserted {
                        let title = [name, subgroup.name].compactMap { $0 }.first { !$0.isEmpty }
                        entries.append(
                            WorldEntry(
                                ref: WorldRef(
                                    contextId: contextId, namespaceId: namespace.id, groupId: subgroup.groupId,
                                    name: title ?? MerrariaConstants.defaultWorldName),
                                players: namespace.memberCount))
                    }
                }
                for contextId in try await backend.listContexts(groupId: namespace.id)
                where seen.insert(contextId).inserted {
                    entries.append(
                        WorldEntry(
                            ref: WorldRef(
                                contextId: contextId, namespaceId: namespace.id, groupId: nil,
                                name: (name?.isEmpty == false ? name : nil) ?? MerrariaConstants.defaultWorldName),
                            players: namespace.memberCount))
                }
            }
            worlds = entries
            error = nil
        } catch {
            self.error = MerrariaText.error(error)
        }
    }

    /// A new world: its namespace, its open subgroup, and the context, initialised with
    /// `{name, seed, now}` (the contract's `init`).
    public func create(name: String, seed: UInt64) async throws -> WorldRef {
        guard backend.hasRelay else { throw MerrariaError.noRelay }
        guard let applicationId, !applicationId.isEmpty else { throw MerrariaError.noApplication }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let title = trimmed.isEmpty ? MerrariaConstants.defaultWorldName : String(trimmed.prefix(MerrariaConstants.maxWorldName))
        let namespaceId = try await backend.foundNamespace(name: title).namespaceId
        let groupId = try await backend.createSubgroup(namespaceId: namespaceId, name: title, isPublic: true)
        let contextId = try await backend.createContext(
            groupId: groupId, applicationId: applicationId, name: title,
            initArgs: .object([
                "name": .string(title), "seed": .number(Double(seed)), "now": .number(Double(nowSeconds())),
            ]))
        let ref = WorldRef(contextId: contextId, namespaceId: namespaceId, groupId: groupId, name: title)
        worlds.insert(WorldEntry(ref: ref, players: 1), at: 0)
        return ref
    }

    /// Redeem an invitation: join the namespace, then the world (its open subgroup's context).
    /// `didJoin` runs in between (the session reconnects to the admitting relay there when the
    /// account had none).
    public func join(_ invitation: WorldInvitation, didJoin: () async -> Void) async throws -> WorldRef {
        let namespaceId = invitation.namespaceId
        _ = try await backend.joinNamespace(namespaceId: namespaceId, invitation: invitation.invitation)
        await didJoin()
        var contextId = invitation.contextId
        var groupId = invitation.groupId
        if contextId == nil {
            let subgroups = try await backend.listSubgroups(namespaceId: namespaceId)
            if let first = subgroups.first(where: { !$0.contextIds.isEmpty }) {
                contextId = first.contextIds.first
                groupId = first.groupId
            } else {
                contextId = try await backend.listContexts(groupId: namespaceId).first
            }
        }
        guard let contextId else { throw MerrariaError.noWorld }
        try await ensureMember(contextId)
        return WorldRef(
            contextId: contextId, namespaceId: namespaceId, groupId: groupId,
            name: invitation.worldName ?? MerrariaConstants.defaultWorldName)
    }

    /// Join the world's context if this account is not in it yet (an invited player joins it
    /// through the open subgroup).
    public func ensureMember(_ contextId: String) async throws {
        if try await backend.isMember(contextId: contextId) { return }
        try await backend.joinContext(contextId: contextId)
    }

    /// A link that admits someone to `ref`'s namespace and opens that world.
    public func inviteLink(_ ref: WorldRef) async throws -> String {
        try await Self.inviteLink(backend: backend, ref: ref)
    }

    public static func inviteLink(backend: any MeroAppBackend, ref: WorldRef) async throws -> String {
        let signed = try await backend.createInvitation(namespaceId: ref.namespaceId)
        return try WorldInvitation(
            invitation: signed, worldName: ref.name, contextId: ref.contextId, groupId: ref.groupId
        ).link()
    }

    public func dismissError() { error = nil }
}
