import Foundation
import MeroKit

/// One row of the outliner: an object at its depth in the hierarchy.
public struct OutlineRow: Identifiable, Equatable, Sendable {
    public var id: String { object.id }
    public let object: SceneObject
    public let depth: Int
    /// The live check-out on it, if any.
    public let lock: LockView?
}

/// A live check-out, ready to show.
public struct CheckOut: Identifiable, Equatable, Sendable {
    public var id: String { assetId }
    public let assetId: String
    /// The object's or texture's name, or a short id when it is gone.
    public let assetName: String
    /// The kind for an object (`cube`, `mesh`…), `texture` for a texture.
    public let assetKind: String
    public let holder: String
    public let holderName: String
    public let mine: Bool
    public let since: UInt64
    public let expiresAt: UInt64
}

/// What the viewport draws: the scene exactly as the contract returns it, in
/// the web app's field names (the generated types encode to them).
public struct ViewerScene: Encodable, Equatable, Sendable {
    public let environment: Environment
    public let objects: [SceneObject]
    public let meshes: [MeshRef]
    public let textures: [TextureRef]
}

/// One open scene, read-only: objects, check-outs, members, and the bytes the
/// viewport asks for. (Kotlin `SceneModel`.)
@MainActor
public final class SceneModel: ObservableObject {
    public enum Phase: Equatable, Sendable {
        case loading
        case ready
        case failed(String)
    }

    @Published public private(set) var phase: Phase = .loading
    @Published public private(set) var name: String
    @Published public private(set) var info: SceneInfo?
    @Published public private(set) var objects: [SceneObject] = []
    @Published public private(set) var meshes: [MeshRef] = []
    @Published public private(set) var textures: [TextureRef] = []
    @Published public private(set) var locks: [LockView] = []
    @Published public private(set) var members: [MemberView] = []
    /// What the viewport should draw; moves only when the scene changed.
    @Published public private(set) var viewerScene: ViewerScene?
    @Published public var selectedId: String?

    public let contextId: String
    public let studioId: String
    let backend: any MeroAppBackend
    let client: ModelsClient
    let blobs: any BlobLoading
    let now: () -> Date
    private var blobCache: [String: Data] = [:]
    private var blobLoads: [String: Task<Data?, Never>] = [:]
    private var refreshing = false
    private var dirty = false

    /// How often to re-read when the node cannot stream events (the web's poll).
    public static let pollInterval: UInt64 = 5_000_000_000

    public init(
        backend: any MeroAppBackend, studioId: String, contextId: String, name: String = "",
        blobs: any BlobLoading = NoBlobs(), now: @escaping () -> Date = Date.init
    ) {
        self.backend = backend
        self.studioId = studioId
        self.contextId = contextId
        self.name = name
        self.client = backend.modelsClient(contextId)
        self.blobs = blobs
        self.now = now
    }

    public var account: String { backend.account }
    public var role: String? { info?.myRole }
    public var totalTriangles: Int { meshes.reduce(0) { $0 + Int($1.triangleCount) } }

    /// Open the scene: make sure this account reaches its app instance (open
    /// teams' members inherit it), then read everything.
    public func open() async {
        phase = .loading
        if let member = try? await backend.isMember(contextId: contextId), !member {
            // A scene in the studio's root follows the studio's membership; a
            // failed join is not fatal, the read below says whether it worked.
            try? await backend.joinContext(contextId: contextId)
        }
        do {
            try await load()
            phase = .ready
        } catch {
            phase = .failed(ModelsFormat.errorText(error))
        }
    }

    /// Re-read, coalescing bursts of events into one read at a time.
    public func refresh() async {
        if refreshing {
            dirty = true
            return
        }
        refreshing = true
        defer { refreshing = false }
        repeat {
            dirty = false
            do {
                try await load()
                if phase != .ready { phase = .ready }
            } catch {
                if phase != .ready { phase = .failed(ModelsFormat.errorText(error)) }
            }
        } while dirty
    }

    /// Follow the scene until the task is cancelled: the node's events when it
    /// streams them, polling otherwise (and after a stream ends).
    public func live() async {
        if backend.canSubscribe {
            do {
                for try await _ in backend.events(contextId: contextId) {
                    if Task.isCancelled { return }
                    await refresh()
                }
            } catch {}
        }
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: Self.pollInterval)
            if Task.isCancelled { return }
            await refresh()
        }
    }

    private func load() async throws {
        let at = millis()
        async let scene = client.getScene()
        async let objects = client.getObjects()
        async let meshes = client.listMeshes()
        async let textures = client.listTextures()
        async let locks = try? client.listLocks(now: at)
        async let members = try? client.getMembers()
        let info = try await scene
        let objs = try await objects
        let refs = try await meshes
        let texs = try await textures
        self.info = info
        let trimmed = info.name.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty { name = trimmed }
        if objs != self.objects { self.objects = objs }
        if refs != self.meshes { self.meshes = refs }
        if texs != self.textures { self.textures = texs }
        if let l = await locks { self.locks = l.filter { $0.expiresAt > at } }
        if let m = await members { self.members = m }
        let next = ViewerScene(environment: info.environment, objects: objs, meshes: refs, textures: texs)
        if next != viewerScene { viewerScene = next }
        if let id = selectedId, !objs.contains(where: { $0.id == id }) { selectedId = nil }
    }

    // MARK: Derived

    /// The hierarchy, depth first, siblings in creation order (the web's
    /// outliner). A missing parent or a loop reads as a root, as the contract says.
    public var outline: [OutlineRow] {
        let byId = Dictionary(objects.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        func resolvedParent(_ o: SceneObject) -> String {
            var seen: Set<String> = [o.id]
            var at = o.parent
            while !at.isEmpty {
                guard let p = byId[at], !seen.contains(at) else { return "" }
                seen.insert(at)
                at = p.parent
            }
            return o.parent
        }
        var children: [String: [SceneObject]] = [:]
        for o in objects { children[resolvedParent(o), default: []].append(o) }
        for k in children.keys {
            children[k]?.sort { ($0.createdAt, $0.id) < ($1.createdAt, $1.id) }
        }
        let lockById = Dictionary(locks.map { ($0.assetId, $0) }, uniquingKeysWith: { a, _ in a })
        var rows: [OutlineRow] = []
        func walk(_ parent: String, _ depth: Int) {
            for o in children[parent] ?? [] {
                rows.append(OutlineRow(object: o, depth: depth, lock: lockById[o.id]))
                walk(o.id, depth + 1)
            }
        }
        walk("", 0)
        return rows
    }

    /// Live check-outs, newest first.
    public var checkOuts: [CheckOut] {
        locks.sorted { ($0.since, $0.assetId) > ($1.since, $1.assetId) }.map { l in
            let object = objects.first { $0.id == l.assetId }
            let texture = textures.first { $0.id == l.assetId }
            return CheckOut(
                assetId: l.assetId,
                assetName: object?.name ?? texture?.name ?? ModelsFormat.shortId(l.assetId),
                assetKind: object?.kind ?? (texture != nil ? "texture" : "object"),
                holder: l.holder, holderName: l.mine ? "You" : name(for: l.holder), mine: l.mine,
                since: l.since, expiresAt: l.expiresAt)
        }
    }

    public var selected: SceneObject? { selectedId.flatMap { id in objects.first { $0.id == id } } }
    public func mesh(for id: String) -> MeshRef? { meshes.first { $0.id == id } }
    public func lock(for id: String) -> LockView? { locks.first { $0.assetId == id } }

    /// A member's scene name, else a short form of their id.
    public func name(for member: String) -> String {
        if let m = members.first(where: { $0.id == member }), let n = ModelsFormat.chosenName(m.name) { return n }
        return ModelsFormat.shortId(member)
    }

    /// The viewport's scene as the JSON it reads.
    public func viewerJSON() -> String? {
        guard let viewerScene, let data = try? JSONEncoder().encode(viewerScene) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// A link to this scene: an invitation to its studio that opens it.
    public func shareLink() async throws -> String {
        try await ModelsInvitation.mint(backend: backend, namespaceId: studioId, contextId: contextId)
    }

    // MARK: Blobs

    /// A blob's bytes for the viewport, read once and kept (a blob id is the
    /// hash of its bytes, so it never changes). `nil` when it cannot be read.
    public func blob(_ id: String) async -> Data? {
        if let hit = blobCache[id] { return hit }
        if let running = blobLoads[id] { return await running.value }
        let blobs = blobs
        let contextId = contextId
        let task = Task<Data?, Never> { try? await blobs.blob(id: id, contextId: contextId) }
        blobLoads[id] = task
        let data = await task.value
        blobLoads[id] = nil
        if let data { blobCache[id] = data }
        return data
    }

    private func millis() -> UInt64 { UInt64(max(0, now().timeIntervalSince1970 * 1000)) }
}
