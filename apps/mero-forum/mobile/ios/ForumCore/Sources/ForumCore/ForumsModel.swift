import Foundation
import MeroKit

/// One forum in a space: an app instance of Mero Forum in the space's org (the web
/// app's `createApp(name, source, { org })`). Its id is the app instance id.
public struct ForumRow: Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    /// The app instance (the same as ``id`` on 1.0; kept optional for the screens).
    public let contextId: String?
    public var joined: Bool

    public init(id: String, name: String, contextId: String?, joined: Bool) {
        self.id = id
        self.name = name
        self.contextId = contextId
        self.joined = joined
    }
}

/// The forums in one space: list, create, open, and invite people.
/// (Kotlin `ForumsModel`; the web app's `ForumsPage` + `lib/spaces.ts`.)
///
/// On Calimero 1.0 every member of the org reaches its app instances, so there
/// is nothing to join and nothing waits to sync.
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
            let entries = try await backend.listContextEntries(groupId: namespaceId)
            forums = entries.map { entry in
                ForumRow(
                    id: entry.id, name: entry.name?.nilIfEmpty ?? "Forum \(entry.id.prefix(6))", contextId: entry.id,
                    joined: true)
            }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            phase = .loaded
        } catch {
            phase = forums.isEmpty ? .failed(ForumErrorText.describe(error)) : .loaded
        }
    }

    /// Create a forum: an app instance of Mero Forum directly in the space's
    /// org, whose `init` takes no arguments.
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
            let contextId = try await backend.createContext(
                groupId: namespaceId, applicationId: applicationId, name: trimmed, initArgs: .object([:]))
            forums.append(ForumRow(id: contextId, name: trimmed, contextId: contextId, joined: true))
            forums.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            return ref(groupId: contextId, name: trimmed, contextId: contextId)
        } catch {
            throw ForumModelError.message(ForumErrorText.describe(error))
        }
    }

    /// Open a forum. Every member of the space reaches it on 1.0.
    public func enter(_ forum: ForumRow) async throws -> ForumRef {
        ref(groupId: forum.id, name: forum.name, contextId: forum.contextId ?? forum.id)
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
