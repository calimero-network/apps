import Foundation
import MeroKit

/// One forum in a space: an open subgroup with one context running the contract.
public struct ForumRow: Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    /// `nil` while the forum exists but its context has not replicated yet.
    public let contextId: String?
    public var joined: Bool

    public init(id: String, name: String, contextId: String?, joined: Bool) {
        self.id = id
        self.name = name
        self.contextId = contextId
        self.joined = joined
    }
}

/// The forums in one space: list, create, join, and invite people.
/// (Kotlin `ForumsModel`; the web app's `ForumsPage` + `lib/groups.ts`.)
@MainActor
public final class ForumsModel: ObservableObject {
    @Published public private(set) var forums: [ForumRow] = []
    @Published public private(set) var phase: LoadPhase = .loading
    @Published public private(set) var isCreating = false
    /// The forum being opened (joined first when needed).
    @Published public private(set) var entering: String?

    public let backend: any MeroAppBackend
    public let namespaceId: String
    public let spaceName: String
    public let applicationId: String

    public init(backend: any MeroAppBackend, namespaceId: String, spaceName: String, applicationId: String) {
        self.backend = backend
        self.namespaceId = namespaceId
        self.spaceName = spaceName
        self.applicationId = applicationId
    }

    public func load() async {
        if forums.isEmpty { phase = .loading }
        do {
            let subgroups = try await backend.listSubgroups(namespaceId: namespaceId)
            var rows: [ForumRow] = []
            for group in subgroups {
                let contextId = group.contextIds.first
                var joined = false
                if let contextId { joined = (try? await backend.isMember(contextId: contextId)) ?? false }
                rows.append(
                    ForumRow(
                        id: group.groupId,
                        name: group.name?.nilIfEmpty ?? "Forum \(group.groupId.prefix(6))",
                        contextId: contextId, joined: joined))
            }
            forums = rows.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            phase = .loaded
        } catch {
            phase = forums.isEmpty ? .failed(ForumErrorText.describe(error)) : .loaded
        }
    }

    /// Create a forum: an OPEN subgroup (so everyone in the space can join it)
    /// with a context running the contract, whose `init` takes no arguments.
    @discardableResult
    public func create(name: String) async throws -> ForumRef {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw ForumModelError.message("Give the forum a name.") }
        guard !applicationId.isEmpty else {
            throw ForumModelError.message("Still connecting to Calimero. Try again in a moment.")
        }
        isCreating = true
        defer { isCreating = false }
        do {
            let groupId = try await backend.createSubgroup(namespaceId: namespaceId, name: trimmed, isPublic: true)
            let contextId = try await backend.createContext(
                groupId: groupId, applicationId: applicationId, name: trimmed, initArgs: .object([:]))
            forums.append(ForumRow(id: groupId, name: trimmed, contextId: contextId, joined: true))
            forums.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            return ref(groupId: groupId, name: trimmed, contextId: contextId)
        } catch {
            throw ForumModelError.message(ForumErrorText.describe(error))
        }
    }

    /// Open a forum, joining its context first when this account is not in it yet.
    public func enter(_ forum: ForumRow) async throws -> ForumRef {
        guard let contextId = forum.contextId else {
            throw ForumModelError.message("This forum is still syncing. Try again in a moment.")
        }
        if forum.joined { return ref(groupId: forum.id, name: forum.name, contextId: contextId) }
        entering = forum.id
        defer { entering = nil }
        do {
            if !((try? await backend.isMember(contextId: contextId)) ?? false) {
                try await backend.joinContext(contextId: contextId)
            }
            if let index = forums.firstIndex(where: { $0.id == forum.id }) { forums[index].joined = true }
            return ref(groupId: forum.id, name: forum.name, contextId: contextId)
        } catch {
            throw ForumModelError.message(ForumErrorText.describe(error))
        }
    }

    /// An invitation link to the whole space.
    public func spaceInvite() async throws -> String {
        do {
            let signed = try await backend.createInvitation(namespaceId: namespaceId)
            return try ForumInvitation(invitation: signed, kind: .space, spaceName: spaceName).link()
        } catch {
            throw ForumModelError.message(ForumErrorText.describe(error))
        }
    }

    /// An invitation link that lands the person in one forum. It still grants
    /// the space: forum access is inherited from it.
    public func forumInvite(_ forum: ForumRow) async throws -> String {
        try await Self.forumInvite(
            backend: backend,
            ref: ForumRef(
                namespaceId: namespaceId, spaceName: spaceName, forumId: forum.id, forumName: forum.name,
                contextId: forum.contextId ?? ""))
    }

    public static func forumInvite(backend: any MeroAppBackend, ref: ForumRef) async throws -> String {
        do {
            let signed = try await backend.createInvitation(namespaceId: ref.namespaceId)
            return try ForumInvitation(
                invitation: signed, kind: .forum, spaceName: ref.spaceName, forumId: ref.forumId,
                forumName: ref.forumName, contextId: ref.contextId.nilIfEmpty
            ).link()
        } catch {
            throw ForumModelError.message(ForumErrorText.describe(error))
        }
    }

    private func ref(groupId: String, name: String, contextId: String) -> ForumRef {
        ForumRef(namespaceId: namespaceId, spaceName: spaceName, forumId: groupId, forumName: name, contextId: contextId)
    }
}
