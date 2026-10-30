import Foundation
import MeroKit

/// Where a list screen is.
public enum LoadState: Equatable, Sendable {
    case idle
    case loading
    case loaded
    case failed(String)
}

// MARK: - Studios

/// A studio: an organization running Mero Models. Everyone invited to it can open
/// every scene in it.
public struct Studio: Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let memberCount: Int
}

/// The studios this account is in. (Kotlin `StudiosModel`.)
@MainActor
public final class StudiosModel: ObservableObject {
    @Published public private(set) var studios: [Studio] = []
    @Published public private(set) var state: LoadState = .idle
    let backend: any MeroAppBackend

    public init(backend: any MeroAppBackend) { self.backend = backend }

    public func load() async {
        if studios.isEmpty { state = .loading }
        do {
            let namespaces = try await backend.listNamespaces()
            studios = namespaces
                .map { Studio(id: $0.id, name: Self.name($0), memberCount: $0.memberCount) }
                .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            state = .loaded
        } catch {
            state = .failed(ModelsFormat.errorText(error))
        }
    }

    static func name(_ ns: AppNamespace) -> String {
        let trimmed = ns.name?.trimmingCharacters(in: .whitespaces) ?? ""
        return trimmed.isEmpty ? "Studio \(ModelsFormat.shortId(ns.id))" : trimmed
    }
}

// MARK: - Scenes

/// A scene: one app instance in the studio, as the web's "New scene" makes it.
public struct SceneSummary: Identifiable, Equatable, Sendable {
    public var id: String { contextId }
    public let contextId: String
    public var name: String
    /// From the scene's own `get_scene`, once it answers.
    public var objectCount: Int?
    public var memberCount: Int?
    public var role: String?
}

/// A studio's scenes: the organization's own app instances (in no team), and
/// those in each of its teams. (Kotlin `ScenesModel`.)
@MainActor
public final class ScenesModel: ObservableObject {
    @Published public private(set) var scenes: [SceneSummary] = []
    @Published public private(set) var state: LoadState = .idle
    public let studioId: String
    let backend: any MeroAppBackend

    public init(backend: any MeroAppBackend, studioId: String) {
        self.backend = backend
        self.studioId = studioId
    }

    public func load() async {
        if scenes.isEmpty { state = .loading }
        do {
            var ids = try await backend.listContexts(groupId: studioId)
            if let subgroups = try? await backend.listSubgroups(namespaceId: studioId) {
                for sg in subgroups { ids += sg.contextIds.filter { !ids.contains($0) } }
            }
            let known = Dictionary(uniqueKeysWithValues: scenes.map { ($0.contextId, $0) })
            scenes = ids.enumerated().map { i, ctx in
                known[ctx] ?? SceneSummary(contextId: ctx, name: "Scene \(i + 1)")
            }
            state = .loaded
            await enrich()
        } catch {
            state = .failed(ModelsFormat.errorText(error))
        }
    }

    /// Each scene's own name and size. A scene this account cannot read yet
    /// keeps its placeholder.
    private func enrich() async {
        let backend = backend
        let infos = await withTaskGroup(of: (String, SceneInfo?).self) { group in
            for s in scenes {
                group.addTask { (s.contextId, try? await backend.modelsClient(s.contextId).getScene()) }
            }
            var out: [String: SceneInfo] = [:]
            for await (id, info) in group { if let info { out[id] = info } }
            return out
        }
        scenes = scenes.map { s in
            guard let info = infos[s.contextId] else { return s }
            var s = s
            let name = info.name.trimmingCharacters(in: .whitespaces)
            if !name.isEmpty { s.name = name }
            s.objectCount = Int(info.objectCount)
            s.memberCount = Int(info.memberCount)
            s.role = info.myRole
            return s
        }
    }

    /// A link to a scene: an invitation to this studio that opens the scene.
    public func shareLink(_ contextId: String) async throws -> String {
        try await ModelsInvitation.mint(backend: backend, namespaceId: studioId, contextId: contextId)
    }
}
