import Foundation
import MeroKit

/// Where a list screen is.
public enum LoadState: Equatable, Sendable {
    case idle
    case loading
    case loaded
    case failed(String)
}

/// "You" for this account, a short id for anyone else: the relay has no
/// member-name call, so names the web reads from group metadata are not here.
public func personName(_ account: String, me: String) -> String {
    account.lowercased() == me.lowercased() ? "You" : DocsFormat.shortId(account)
}

// MARK: - Workspaces

/// A workspace: a namespace running Mero Docs.
public struct Workspace: Identifiable, Equatable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let memberCount: Int

    public init(id: String, name: String, memberCount: Int) {
        self.id = id
        self.name = name
        self.memberCount = memberCount
    }
}

/// The workspaces this account is in.
@MainActor
public final class WorkspacesModel: ObservableObject {
    @Published public private(set) var workspaces: [Workspace] = []
    @Published public private(set) var state: LoadState = .idle
    let backend: any MeroAppBackend

    public init(backend: any MeroAppBackend) { self.backend = backend }

    public func load() async {
        if workspaces.isEmpty { state = .loading }
        do {
            workspaces = try await backend.listNamespaces()
                .map { Workspace(id: $0.id, name: Self.name($0), memberCount: $0.memberCount) }
                .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            state = .loaded
        } catch {
            state = .failed(DocsFormat.errorText(error))
        }
    }

    static func name(_ ns: AppNamespace) -> String {
        ns.name?.trimmed.nonEmpty ?? "Workspace \(DocsFormat.shortId(ns.id))"
    }
}

// MARK: - Workspace index

/// A folder: a subgroup of the workspace, nested by core's tree, with one docs context.
public struct Folder: Identifiable, Equatable, Hashable, Sendable {
    /// The subgroup's group id: what a doc link names.
    public let id: String
    public let name: String
    /// The folder above; nil at the top.
    public let parentId: String?
    /// The folder's docs context; nil until one reaches the relay.
    public let contextId: String?

    public init(id: String, name: String, parentId: String?, contextId: String?) {
        self.id = id
        self.name = name
        self.parentId = parentId
        self.contextId = contextId
    }
}

/// One document in the workspace index.
public struct DocRow: Identifiable, Equatable, Hashable, Sendable {
    public var id: String { "\(folderId)/\(doc.id)" }
    public let folderId: String
    public let contextId: String
    public let folderName: String
    public let doc: DocDto

    public init(folderId: String, contextId: String, folderName: String, doc: DocDto) {
        self.folderId = folderId
        self.contextId = contextId
        self.folderName = folderName
        self.doc = doc
    }

    public var title: String { doc.title.trimmed.nonEmpty ?? "Untitled" }
}

extension DocDto: Hashable {
    public func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

/// A search hit: the doc, and the node's snippet around the match.
public struct SearchResult: Identifiable, Equatable, Sendable {
    public var id: String { row.id }
    public let row: DocRow
    /// The node's fragment with `<b>` around matched words; empty for a title match.
    public let snippet: String
}

/// Why a folder's documents are not listed.
public enum FolderIssue: Error, Equatable, Sendable {
    /// No docs context has reached the relay yet.
    case noContext
    /// The account is not in it and could not join.
    case noAccess(String)
    case failed(String)
}

/// The documents this device opened last in a workspace, newest first; on this
/// device only, as the web keeps them in `localStorage`.
public protocol RecentStore: AnyObject, Sendable {
    func recent(workspaceId: String) -> [RecentDoc]
    func touch(workspaceId: String, folderId: String, docId: String, at: Date)
}

public struct RecentDoc: Codable, Equatable, Sendable {
    public let folderId: String
    public let docId: String
    /// Unix milliseconds.
    public let openedAt: Int64
}

/// Recents in `UserDefaults`, one list per workspace, at most ``limit``.
public final class DefaultsRecentStore: RecentStore, @unchecked Sendable {
    public static let limit = 8
    private let defaults: UserDefaults
    private let lock = NSLock()

    public init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    public func recent(workspaceId: String) -> [RecentDoc] {
        lock.lock()
        defer { lock.unlock() }
        guard let data = defaults.data(forKey: key(workspaceId)) else { return [] }
        return (try? JSONDecoder().decode([RecentDoc].self, from: data)) ?? []
    }

    public func touch(workspaceId: String, folderId: String, docId: String, at: Date) {
        var list = recent(workspaceId: workspaceId).filter { !($0.folderId == folderId && $0.docId == docId) }
        list.insert(RecentDoc(folderId: folderId, docId: docId, openedAt: Int64(at.timeIntervalSince1970 * 1000)), at: 0)
        lock.lock()
        defer { lock.unlock() }
        defaults.set(try? JSONEncoder().encode(Array(list.prefix(Self.limit))), forKey: key(workspaceId))
    }

    private func key(_ ws: String) -> String { "mero-docs:recent:\(ws)" }
}

/// A workspace's folders and documents, searched and browsed.
@MainActor
public final class WorkspaceModel: ObservableObject {
    @Published public private(set) var folders: [Folder] = []
    @Published public private(set) var docs: [DocRow] = []
    @Published public private(set) var issues: [String: FolderIssue] = [:]
    @Published public private(set) var state: LoadState = .idle
    @Published public private(set) var results: [SearchResult] = []
    @Published public private(set) var searching = false
    @Published public private(set) var query = ""

    public let workspace: Workspace
    let backend: any MeroAppBackend
    let recents: any RecentStore

    /// How deep the folder tree is walked.
    public static let maxDepth = 8

    public init(backend: any MeroAppBackend, workspace: Workspace, recents: any RecentStore) {
        self.backend = backend
        self.workspace = workspace
        self.recents = recents
    }

    public var account: String { backend.account }

    /// Folders at the top, or under `parentId`, by name.
    public func folders(in parentId: String?) -> [Folder] {
        folders.filter { $0.parentId == parentId }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    /// A folder's documents, last changed first.
    public func docs(in folderId: String) -> [DocRow] {
        docs.filter { $0.folderId == folderId }.sorted(by: Self.newestFirst)
    }

    /// Every document, last changed first.
    public var recentlyUpdated: [DocRow] { docs.sorted(by: Self.newestFirst) }

    /// What this device opened last here, that is still in the index.
    public var recent: [DocRow] {
        recents.recent(workspaceId: workspace.id).compactMap { r in
            docs.first { $0.folderId == r.folderId && $0.doc.id == r.docId }
        }
    }

    public func folder(_ id: String) -> Folder? { folders.first { $0.id == id } }

    /// Folders and documents, read again.
    public func load() async {
        if docs.isEmpty && folders.isEmpty { state = .loading }
        do {
            let tree = try await walk()
            folders = tree
            await readDocs(tree)
            state = .loaded
        } catch {
            state = .failed(DocsFormat.errorText(error))
        }
    }

    /// The tree, one level at a time from the workspace's root group. A level
    /// that cannot be read is left empty; only the root failing fails the load.
    private func walk() async throws -> [Folder] {
        let backend = backend
        var found: [Folder] = []
        var seen: Set<String> = [workspace.id]
        let top = try await backend.listSubgroups(namespaceId: workspace.id)
        var level: [(AppSubgroup, String?)] = top.map { ($0, nil) }
        var depth = 0
        while !level.isEmpty && depth < Self.maxDepth {
            var next: [String] = []
            for (sg, parent) in level where seen.insert(sg.groupId).inserted {
                found.append(
                    Folder(
                        id: sg.groupId, name: sg.name?.trimmed.nonEmpty ?? "Untitled folder", parentId: parent,
                        contextId: sg.contextIds.first))
                next.append(sg.groupId)
            }
            let children = await withTaskGroup(of: [(AppSubgroup, String?)].self) { group in
                for id in next {
                    group.addTask { ((try? await backend.listSubgroups(namespaceId: id)) ?? []).map { ($0, id) } }
                }
                var out: [(AppSubgroup, String?)] = []
                for await list in group { out += list }
                return out
            }
            level = children.sorted { $0.0.groupId < $1.0.groupId }
            depth += 1
        }
        return found
    }

    private func readDocs(_ tree: [Folder]) async {
        let backend = backend
        let outcomes = await withTaskGroup(of: (String, Result<[DocRow], FolderIssue>).self) { group in
            for folder in tree {
                group.addTask {
                    guard let ctx = folder.contextId else { return (folder.id, .failure(.noContext)) }
                    if let member = try? await backend.isMember(contextId: ctx), !member {
                        do {
                            try await backend.joinContext(contextId: ctx)
                        } catch {
                            return (folder.id, .failure(.noAccess(DocsFormat.errorText(error))))
                        }
                    }
                    do {
                        let list = try await backend.docs(ctx).client.listDocs(includeArchived: false)
                        return (
                            folder.id,
                            .success(
                                list.map { DocRow(folderId: folder.id, contextId: ctx, folderName: folder.name, doc: $0) })
                        )
                    } catch {
                        return (folder.id, .failure(.failed(DocsFormat.errorText(error))))
                    }
                }
            }
            var out: [(String, Result<[DocRow], FolderIssue>)] = []
            for await o in group { out.append(o) }
            return out
        }
        var rows: [DocRow] = []
        var problems: [String: FolderIssue] = [:]
        for (folderId, outcome) in outcomes {
            switch outcome {
            case .success(let list): rows += list
            case .failure(let issue):
                problems[folderId] = issue
                // A folder that fails a re-read keeps what it showed.
                rows += docs.filter { $0.folderId == folderId }
            }
        }
        docs = rows
        issues = problems
    }

    /// Titles that match at once, then every folder's full-text index
    /// (`search_docs`: title and body, best match first).
    public func search(_ text: String) async {
        let q = text.trimmed
        query = q
        guard !q.isEmpty else {
            results = []
            searching = false
            return
        }
        let titleHits = docs.filter { $0.title.localizedCaseInsensitiveContains(q) }.sorted(by: Self.newestFirst)
        results = titleHits.map { SearchResult(row: $0, snippet: "") }
        searching = true
        let backend = backend
        let byContext = Dictionary(grouping: docs, by: \.contextId)
        let targets = folders.compactMap { f in f.contextId.map { (f, $0) } }.filter { issues[$0.0.id] == nil }
        let hits = await withTaskGroup(of: [(DocRow, String, Float)].self) { group in
            for (folder, ctx) in targets {
                group.addTask {
                    guard let page = try? await backend.docs(ctx).client.searchDocs(
                        query: q, includeArchived: false, cursor: nil, limit: 20)
                    else { return [] }
                    return page.hits.compactMap { hit in
                        let row =
                            byContext[ctx]?.first { $0.doc.id == hit.id }
                            ?? DocRow(
                                folderId: folder.id, contextId: ctx, folderName: folder.name,
                                doc: DocDto(
                                    id: hit.id, title: hit.title, tags: [], archived: hit.archived, createdAt: 0,
                                    updatedAt: 0, createdBy: "", updatedBy: "", canDelete: false))
                        return hit.archived ? nil : (row, hit.snippet, hit.score)
                    }
                }
            }
            var out: [(DocRow, String, Float)] = []
            for await list in group { out += list }
            return out
        }
        // A newer query owns the list now.
        guard query == q else { return }
        let ranked = hits.sorted { $0.2 != $1.2 ? $0.2 > $1.2 : $0.0.id < $1.0.id }
        var seen = Set<String>()
        var merged: [SearchResult] = []
        for (row, snippet, _) in ranked where seen.insert(row.id).inserted {
            merged.append(SearchResult(row: row, snippet: snippet))
        }
        for row in titleHits where seen.insert(row.id).inserted {
            merged.append(SearchResult(row: row, snippet: ""))
        }
        results = merged
        searching = false
    }

    nonisolated static func newestFirst(_ a: DocRow, _ b: DocRow) -> Bool {
        a.doc.updatedAt != b.doc.updatedAt ? a.doc.updatedAt > b.doc.updatedAt : a.id < b.id
    }
}

// MARK: - Document

/// One open document, read-only, with its comments.
@MainActor
public final class DocumentModel: ObservableObject {
    public enum Phase: Equatable, Sendable {
        case loading
        case ready
        case failed(String)
    }

    /// An image block's picture.
    public enum ImageState: Equatable, Sendable {
        case loading
        case loaded(Data)
        /// No peer served it, or not in time; asking again can work.
        case unavailable
    }

    @Published public private(set) var phase: Phase = .loading
    @Published public private(set) var doc: DocDto?
    @Published public private(set) var blocks: [DocBlock] = []
    @Published public private(set) var threads: [CommentThread] = []
    @Published public private(set) var images: [String: ImageState] = [:]
    @Published public private(set) var contextId: String?

    public let workspaceId: String
    public let folderId: String
    public let docId: String
    public let folderName: String
    let backend: any MeroAppBackend
    let blobs: any BlobLoading
    let recents: (any RecentStore)?
    let now: () -> Date
    private var pending: [DocComment] = []
    private var refreshing = false
    private var dirty = false

    /// How often to re-read when the relay cannot stream events.
    public static let pollInterval: UInt64 = 5_000_000_000

    public init(
        backend: any MeroAppBackend, workspaceId: String, folderId: String, docId: String, contextId: String? = nil,
        folderName: String = "", title: String? = nil, blobs: any BlobLoading = NoBlobs(),
        recents: (any RecentStore)? = nil, now: @escaping () -> Date = Date.init
    ) {
        self.backend = backend
        self.workspaceId = workspaceId
        self.folderId = folderId
        self.docId = docId
        self.contextId = contextId
        self.folderName = folderName
        self.blobs = blobs
        self.recents = recents
        self.now = now
        if let title {
            doc = DocDto(
                id: docId, title: title, tags: [], archived: false, createdAt: 0, updatedAt: 0, createdBy: "",
                updatedBy: "", canDelete: false)
        }
    }

    public var account: String { backend.account }
    public var title: String { doc?.title.trimmed.nonEmpty ?? "Untitled" }
    public var commentCount: Int { threads.reduce(0) { $0 + 1 + $1.replies.count } }
    public var countsByBlock: [String: Int] { CommentBody.countsByBlock(threads) }
    public var wordCount: Int { DocumentReader.wordCount(blocks) }

    public var shareLink: String {
        DocsFormat.docLink(DocTarget(workspaceId: workspaceId, folderId: folderId, docId: docId))
    }

    public func blockLink(_ blockId: String) -> String {
        DocsFormat.docLink(DocTarget(workspaceId: workspaceId, folderId: folderId, docId: docId, blockId: blockId))
    }

    public func block(_ id: String) -> DocBlock? { blocks.first { $0.id == id } }

    /// Find the folder's context when a link did not carry it, join it when
    /// this account is not in it yet (an open folder), then read everything.
    public func open() async {
        phase = .loading
        do {
            let ctx = try await resolveContext()
            if let member = try? await backend.isMember(contextId: ctx), !member {
                do {
                    try await backend.joinContext(contextId: ctx)
                } catch {
                    phase = .failed("You don't have access to this folder. \(DocsFormat.errorText(error))")
                    return
                }
            }
            try await read(ctx)
            phase = .ready
            recents?.touch(workspaceId: workspaceId, folderId: folderId, docId: docId, at: now())
        } catch {
            phase = .failed(DocsFormat.errorText(error))
        }
    }

    /// Re-read, coalescing bursts of events into one read at a time.
    public func refresh() async {
        guard let ctx = contextId else { return await open() }
        if refreshing {
            dirty = true
            return
        }
        refreshing = true
        defer { refreshing = false }
        repeat {
            dirty = false
            do {
                try await read(ctx)
                if phase != .ready { phase = .ready }
            } catch {
                if blocks.isEmpty, phase != .ready { phase = .failed(DocsFormat.errorText(error)) }
            }
        } while dirty
    }

    /// Follow the document until the task is cancelled: the relay's events
    /// when it streams them, polling otherwise (and after a stream ends).
    public func live() async {
        guard let ctx = contextId else { return }
        if backend.canSubscribe {
            do {
                for try await _ in backend.events(contextId: ctx) {
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

    /// Comment on the document, or on one block of it.
    public func addComment(_ text: String, blockId: String? = nil) async throws {
        try await send(text, blockId: blockId, replyTo: nil)
    }

    /// Answer a comment.
    public func reply(to commentId: String, _ text: String) async throws {
        try await send(text, blockId: nil, replyTo: commentId)
    }

    /// The picture of an image block, read once and kept.
    public func loadImage(_ blobId: String, retry: Bool = false) async {
        guard let ctx = contextId else { return }
        if let state = images[blobId], !(retry && state == .unavailable) { return }
        images[blobId] = .loading
        do {
            images[blobId] = .loaded(try await blobs.blob(id: blobId, contextId: ctx))
        } catch {
            images[blobId] = .unavailable
        }
    }

    // MARK: Reads

    private func resolveContext() async throws -> String {
        if let contextId { return contextId }
        guard let ctx = try await backend.listContexts(groupId: folderId).first else {
            throw DocsError.folderNotReady
        }
        contextId = ctx
        return ctx
    }

    private func read(_ ctx: String) async throws {
        let api = backend.docs(ctx)
        async let info = api.client.getDoc(id: docId)
        async let rows = api.readDocument(docId)
        let (d, r) = try await (info, rows)
        doc = d
        let next = DocumentReader.blocks(r)
        if next != blocks { blocks = next }
        await readComments(api)
    }

    private func readComments(_ api: DocsAPI) async {
        let read = try? await api.client.listComments(docId: docId)
        var list = read.map { $0.map(DocComment.init) } ?? threads.flatMap { [$0.root] + $0.replies }
        if read != nil {
            let ids = Set(list.map(\.id))
            pending.removeAll { ids.contains($0.id) }
        }
        list += pending.filter { p in !list.contains { $0.id == p.id } }
        threads = CommentBody.threads(list)
    }

    private func send(_ text: String, blockId: String?, replyTo: String?) async throws {
        let words = text.trimmed
        guard !words.isEmpty, let ctx = contextId else { return }
        let api = backend.docs(ctx)
        let id = try await api.client.addComment(
            docId: docId, body: CommentBody.encode(words, blockId: blockId, replyTo: replyTo))
        // Shown at once; kept until a read has it.
        pending.append(
            DocComment(
                id: id, author: backend.account, createdAt: UInt64(max(0, now().timeIntervalSince1970)) * 1_000_000_000,
                text: words, blockId: replyTo == nil ? blockId : nil, replyTo: replyTo))
        await readComments(api)
    }
}

public enum DocsError: LocalizedError, Equatable {
    case folderNotReady

    public var errorDescription: String? {
        switch self {
        case .folderNotReady: return "This folder isn't ready yet. Try again in a moment."
        }
    }
}
