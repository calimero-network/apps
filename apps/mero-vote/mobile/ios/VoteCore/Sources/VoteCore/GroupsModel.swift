import Foundation
import MeroKit

/// One voting group on the home screen, with what its polls look like.
public struct GroupRow: Identifiable, Hashable, Sendable {
    public let ref: GroupRef
    /// `nil` until its polls have been read (or when they could not be).
    public var polls: Int?
    public var open: Int
    /// The newest poll's question, as the row's subtitle.
    public var latest: String?

    public var id: String { ref.contextId }
}

/// A workspace (namespace) and the voting groups (contexts) directly in it.
public struct WorkspaceSection: Identifiable, Hashable, Sendable {
    public let namespace: AppNamespace
    public var groups: [GroupRow]

    public var id: String { namespace.id }
    public var name: String { GroupsModel.name(of: namespace) }
}

/// The home screen: every workspace this account is in and the voting groups
/// in each; creating either. (Kotlin `GroupsModel`; the web's `ContextPicker`.)
@MainActor
public final class GroupsModel: ObservableObject {
    @Published public private(set) var sections: [WorkspaceSection] = []
    @Published public private(set) var phase: LoadPhase = .loading
    @Published public private(set) var isCreating = false

    public let backend: any MeroAppBackend
    public let applicationId: String

    public init(backend: any MeroAppBackend, applicationId: String) {
        self.backend = backend
        self.applicationId = applicationId
    }

    public var hasRelay: Bool { backend.hasRelay }

    public func load() async {
        if sections.isEmpty { phase = .loading }
        do {
            let namespaces = try await backend.listNamespaces()
            var next: [WorkspaceSection] = []
            for ns in namespaces {
                let contexts = (try? await backend.listContexts(groupId: ns.id)) ?? []
                var rows: [GroupRow] = []
                for contextId in contexts {
                    let ref = GroupRef(namespaceId: ns.id, workspaceName: Self.name(of: ns), contextId: contextId)
                    rows.append(await summary(ref))
                }
                next.append(WorkspaceSection(namespace: ns, groups: rows))
            }
            sections = next.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            phase = .loaded
        } catch {
            phase = sections.isEmpty ? .failed(VoteErrorText.describe(error)) : .loaded
        }
    }

    private func summary(_ ref: GroupRef) async -> GroupRow {
        let client = VoteClient.make(contract: backend.contract, contextId: ref.contextId)
        guard let polls = try? await client.listPolls() else { return GroupRow(ref: ref, polls: nil, open: 0, latest: nil) }
        let newest = polls.max { $0.createdAt < $1.createdAt }
        return GroupRow(
            ref: ref, polls: polls.count, open: polls.filter { $0.phase == .voting }.count, latest: newest?.title)
    }

    /// A new workspace with its first voting group in it: the web's one-click
    /// "Create namespace + context".
    @discardableResult
    public func createWorkspace(name: String) async throws -> GroupRef {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw VoteModelError.message("Give the workspace a name.") }
        isCreating = true
        defer { isCreating = false }
        do {
            let founded = try await backend.foundNamespace(name: trimmed)
            var app = applicationId
            if app.isEmpty, let listed = try? await backend.listNamespaces() {
                app = listed.first { $0.id == founded.namespaceId }?.applicationId ?? ""
            }
            let contextId = try await createContext(in: founded.namespaceId, name: trimmed, applicationId: app)
            await load()
            return GroupRef(namespaceId: founded.namespaceId, workspaceName: trimmed, contextId: contextId)
        } catch let error as VoteModelError {
            throw error
        } catch {
            throw VoteModelError.message(VoteErrorText.describe(error))
        }
    }

    /// Another voting group in a workspace you are already in.
    @discardableResult
    public func createGroup(in section: WorkspaceSection) async throws -> GroupRef {
        isCreating = true
        defer { isCreating = false }
        do {
            let app = applicationId.isEmpty ? section.namespace.applicationId : applicationId
            let contextId = try await createContext(in: section.namespace.id, name: section.name, applicationId: app)
            await load()
            return GroupRef(namespaceId: section.namespace.id, workspaceName: section.name, contextId: contextId)
        } catch let error as VoteModelError {
            throw error
        } catch {
            throw VoteModelError.message(VoteErrorText.describe(error))
        }
    }

    /// Directly in the namespace, not in a subgroup: the web does the same, so
    /// a context's group IS its namespace and one invitation covers both.
    private func createContext(in namespaceId: String, name: String, applicationId: String) async throws -> String {
        guard !applicationId.isEmpty else {
            throw VoteModelError.message("Still connecting to Calimero. Try again in a moment.")
        }
        return try await backend.createContext(
            groupId: namespaceId, applicationId: applicationId, name: name, initArgs: .object([:]))
    }

    public nonisolated static func name(of space: AppNamespace) -> String {
        if let name = space.name?.nilIfEmpty { return name }
        return "Workspace \(space.id.prefix(6))"
    }
}
