import Foundation
import MeroKit

/// Where a list screen is.
public enum LoadState: Equatable, Sendable {
    case idle
    case loading
    case loaded
    case failed(String)
}

// MARK: - Teams

/// A team: a namespace running Mero PixArt.
public struct Team: Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let memberCount: Int
}

/// The teams this account is in.
@MainActor
public final class TeamsModel: ObservableObject {
    @Published public private(set) var teams: [Team] = []
    @Published public private(set) var state: LoadState = .idle
    let backend: any MeroAppBackend

    public init(backend: any MeroAppBackend) { self.backend = backend }

    public func load() async {
        if teams.isEmpty { state = .loading }
        do {
            teams = try await backend.listNamespaces()
                .map { Team(id: $0.id, name: Self.name($0), memberCount: $0.memberCount) }
                .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            state = .loaded
        } catch {
            state = .failed(PixartFormat.errorText(error))
        }
    }

    static func name(_ ns: AppNamespace) -> String {
        ns.name?.nilIfBlank ?? "Team \(PixartFormat.shortId(ns.id))"
    }
}

// MARK: - Projects

/// A project: a subgroup of the team with one context running the artwork.
public struct ProjectSummary: Identifiable, Equatable, Sendable {
    public var id: String { contextId }
    public let contextId: String
    public let groupId: String
    public var name: String
    public var description: String
    /// From the project's own `get_document`, once it answers.
    public var width: UInt32?
    public var height: UInt32?
    public var layerCount: Int?
}

/// A team's projects, with a small composite of each.
@MainActor
public final class ProjectsModel: ObservableObject {
    @Published public private(set) var projects: [ProjectSummary] = []
    @Published public private(set) var state: LoadState = .idle
    /// Thumbnails by context id.
    @Published public private(set) var thumbnails: [String: Bitmap] = [:]
    public let teamId: String
    let backend: any MeroAppBackend
    let blobs: BlobStore
    private var thumbing: Set<String> = []

    /// The longest side of a thumbnail, in pixels.
    public static let thumbSide = 360.0

    public init(backend: any MeroAppBackend, teamId: String, blobs: BlobStore) {
        self.backend = backend
        self.teamId = teamId
        self.blobs = blobs
    }

    public func load() async {
        if projects.isEmpty { state = .loading }
        do {
            let subgroups = try await backend.listSubgroups(namespaceId: teamId)
            projects = subgroups.compactMap { sg -> ProjectSummary? in
                guard let ctx = sg.contextIds.first else { return nil }
                if let known = projects.first(where: { $0.contextId == ctx }) { return known }
                return ProjectSummary(
                    contextId: ctx, groupId: sg.groupId,
                    name: sg.name?.nilIfBlank ?? "Project \(PixartFormat.shortId(ctx))", description: "")
            }
            state = .loaded
            await enrich()
        } catch {
            state = .failed(PixartFormat.errorText(error))
        }
    }

    /// The document's own name and size win over the listing's. A project
    /// this account cannot read yet keeps its listing.
    private func enrich() async {
        let backend = backend
        let docs = await withTaskGroup(of: (String, DocumentInfo?).self) { group in
            for p in projects {
                group.addTask { (p.contextId, try? await backend.pixartClient(p.contextId).getDocument()) }
            }
            var out: [String: DocumentInfo] = [:]
            for await (id, doc) in group { if let doc { out[id] = doc } }
            return out
        }
        projects = projects.map { p in
            guard let doc = docs[p.contextId] else { return p }
            var p = p
            if let n = doc.name.nilIfBlank { p.name = n }
            p.description = doc.description
            p.width = doc.width
            p.height = doc.height
            p.layerCount = Int(doc.layerCount)
            return p
        }
    }

    /// Draw a project's thumbnail once (a row asks when it appears).
    public func loadThumbnail(_ contextId: String) async {
        guard thumbnails[contextId] == nil, !thumbing.contains(contextId),
            let p = projects.first(where: { $0.contextId == contextId }), let w = p.width, let h = p.height, w > 0, h > 0
        else { return }
        thumbing.insert(contextId)
        defer { thumbing.remove(contextId) }
        let client = backend.pixartClient(contextId)
        guard let layers = try? await client.getLayers(), let doc = try? await client.getDocument() else { return }
        let ops = LayerStack.drawOps(layers)
        let images = await blobs.bitmaps(LayerStack.blobIds(ops), contextId: contextId)
        let scale = min(1, Self.thumbSide / Double(max(w, h)))
        let thumb = await Task.detached(priority: .utility) {
            Renderer.composite(
                width: Int(doc.width), height: Int(doc.height), background: doc.background, ops: ops, images: images,
                scale: scale)
        }.value
        if let thumb { thumbnails[contextId] = thumb }
    }

    /// A link that invites someone to this team, in the web's format.
    public func inviteLink(teamName: String) async throws -> String {
        let signed = try await backend.createInvitation(namespaceId: teamId)
        return try PixartInvitation(invitation: signed, teamName: teamName.nilIfBlank).link()
    }
}

// MARK: - Artwork

/// One project, view-only: the composite, the layer list, export.
@MainActor
public final class ArtworkModel: ObservableObject {
    public enum Phase: Equatable, Sendable {
        case loading
        case ready
        case failed(String)
    }

    @Published public private(set) var phase: Phase = .loading
    @Published public private(set) var document: DocumentInfo?
    @Published public private(set) var layers: [Layer] = []
    /// This phone's own show/hide choices, by layer id. Never written to the contract.
    @Published public private(set) var overrides: [String: Bool] = [:]
    /// The composite at view resolution.
    @Published public private(set) var image: Bitmap?
    @Published public private(set) var rendering = false
    /// Layers whose pixels could not be read.
    @Published public private(set) var missing = 0
    @Published public private(set) var members: [Member] = []
    @Published public private(set) var role: String?
    @Published public private(set) var name: String

    public let teamId: String
    public let contextId: String
    let backend: any MeroAppBackend
    let client: PixartClient
    let blobs: BlobStore
    private var images: [String: Bitmap] = [:]
    private var renderToken = 0
    private var refreshing = false
    private var dirty = false

    /// The composite shown on screen is at most this many pixels on its longest side.
    public static let viewSide = 3072.0
    /// An export is at most this many.
    public static let exportSide = 8192.0
    /// How often to re-read when the relay cannot stream events.
    public static let pollInterval: UInt64 = 5_000_000_000

    public init(backend: any MeroAppBackend, teamId: String, contextId: String, name: String = "", blobs: BlobStore) {
        self.backend = backend
        self.teamId = teamId
        self.contextId = contextId
        self.name = name
        self.blobs = blobs
        self.client = backend.pixartClient(contextId)
    }

    public var rows: [LayerRow] { LayerTree.rows(layers, overrides: overrides) }
    public var shareLink: String { PixartFormat.projectLink(teamId: teamId, contextId: contextId) }
    public var account: String { backend.account }
    public var hasOverrides: Bool { !overrides.isEmpty }

    /// Join the project's context when this account is not in it yet (an open
    /// subgroup of the team), then read and draw it.
    public func open() async {
        phase = .loading
        if let member = try? await backend.isMember(contextId: contextId), !member {
            do {
                try await backend.joinContext(contextId: contextId)
            } catch {
                phase = .failed("Couldn't join this project: \(PixartFormat.errorText(error))")
                return
            }
        }
        do {
            try await read()
            phase = .ready
        } catch {
            phase = .failed(PixartFormat.errorText(error))
            return
        }
        await render()
        await readRest()
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
                if try await read() { await render() }
                if phase != .ready { phase = .ready }
            } catch {
                if document == nil { phase = .failed(PixartFormat.errorText(error)) }
            }
            await readRest()
        } while dirty
    }

    /// Follow the project until the task is cancelled: the relay's events
    /// when it streams them, polling otherwise (and after a stream ends).
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

    /// Show or hide a layer on this phone only.
    public func toggle(_ layerId: String) async {
        guard let layer = layers.first(where: { $0.id == layerId }) else { return }
        let next = !LayerStack.visible(layer, overrides: overrides)
        if next == layer.visible { overrides.removeValue(forKey: layerId) } else { overrides[layerId] = next }
        await render()
    }

    /// Back to the document's own visibility.
    public func resetVisibility() async {
        guard !overrides.isEmpty else { return }
        overrides = [:]
        await render()
    }

    /// The composite as PNG at full size (capped), as this phone shows it.
    public func exportPNG() async -> Data? {
        guard let doc = document else { return nil }
        let ops = LayerStack.drawOps(layers, overrides: overrides)
        let images = images
        let scale = min(1, Self.exportSide / Double(max(1, max(doc.width, doc.height))))
        return await Task.detached(priority: .userInitiated) {
            Renderer.composite(
                width: Int(doc.width), height: Int(doc.height), background: doc.background, ops: ops, images: images,
                scale: scale
            ).flatMap(Renderer.png)
        }.value
    }

    /// A display name for a member id: their roster name, else a short id.
    public func name(for member: String) -> String {
        members.first { $0.id == member }?.username.nilIfBlank ?? PixartFormat.shortId(member)
    }

    // MARK: Reads

    /// Read the document and layers; `true` when either changed.
    @discardableResult
    private func read() async throws -> Bool {
        async let doc = client.getDocument()
        async let list = client.getLayers()
        let (d, l) = try await (doc, list)
        let changed = d != document || l != layers
        document = d
        layers = l
        if let n = d.name.nilIfBlank { name = n }
        overrides = overrides.filter { id, _ in l.contains { $0.id == id } }
        return changed
    }

    private func readRest() async {
        async let members = try? client.getMembers()
        async let role = try? client.myRole()
        if let m = await members { self.members = m }
        if let r = await role { self.role = r }
    }

    private func render() async {
        guard let doc = document else { return }
        renderToken += 1
        let token = renderToken
        rendering = true
        let ops = LayerStack.drawOps(layers, overrides: overrides)
        let need = LayerStack.blobIds(ops).filter { images[$0] == nil }
        if !need.isEmpty {
            let got = await blobs.bitmaps(need, contextId: contextId)
            images.merge(got) { a, _ in a }
        }
        missing = LayerStack.blobIds(ops).filter { images[$0] == nil }.count
        let images = images
        let scale = min(1, Self.viewSide / Double(max(1, max(doc.width, doc.height))))
        let out = await Task.detached(priority: .userInitiated) {
            Renderer.composite(
                width: Int(doc.width), height: Int(doc.height), background: doc.background, ops: ops, images: images,
                scale: scale)
        }.value
        guard token == renderToken else { return }
        image = out
        rendering = false
    }
}
