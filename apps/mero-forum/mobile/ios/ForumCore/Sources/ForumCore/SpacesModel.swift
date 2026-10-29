import Foundation
import MeroKit

/// The spaces (namespaces) this account is in, and founding a new one.
/// (Kotlin `SpacesModel`.)
@MainActor
public final class SpacesModel: ObservableObject {
    @Published public private(set) var spaces: [AppNamespace] = []
    @Published public private(set) var phase: LoadPhase = .loading
    @Published public private(set) var isCreating = false

    public let backend: any MeroAppBackend

    public init(backend: any MeroAppBackend) {
        self.backend = backend
    }

    /// Whether a relay serves the account. Without one only joining works.
    public var hasRelay: Bool { backend.hasRelay }

    public func load() async {
        if spaces.isEmpty { phase = .loading }
        do {
            let listed = try await backend.listNamespaces()
            spaces = listed.sorted { Self.name(of: $0).localizedCaseInsensitiveCompare(Self.name(of: $1)) == .orderedAscending }
            phase = .loaded
        } catch {
            phase = spaces.isEmpty ? .failed(ForumErrorText.describe(error)) : .loaded
        }
    }

    /// Found a space named `name`. Returns it, or throws with words to show.
    @discardableResult
    public func create(name: String) async throws -> AppNamespace {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw ForumModelError.message("Give the space a name.") }
        isCreating = true
        defer { isCreating = false }
        do {
            let founded = try await backend.foundNamespace(name: trimmed)
            let space = AppNamespace(
                id: founded.namespaceId, name: trimmed, applicationId: "", memberCount: 1)
            if !spaces.contains(where: { $0.id == space.id }) { spaces.append(space) }
            await load()
            return spaces.first { $0.id == space.id } ?? space
        } catch let error as ForumModelError {
            throw error
        } catch {
            throw ForumModelError.message(ForumErrorText.describe(error))
        }
    }

    /// A space's name, or a stand-in made from its id.
    public nonisolated static func name(of space: AppNamespace) -> String {
        if let name = space.name?.nilIfEmpty { return name }
        return "Space \(space.id.prefix(6))"
    }
}

/// An error already in words to show.
public enum ForumModelError: Error, LocalizedError, Equatable {
    case message(String)

    public var errorDescription: String? {
        switch self {
        case .message(let text): return text
        }
    }
}
