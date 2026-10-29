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

/// A team: a namespace running Mero Design.
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
            let namespaces = try await backend.listNamespaces()
            teams = namespaces
                .map { Team(id: $0.id, name: Self.name($0), memberCount: $0.memberCount) }
                .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            state = .loaded
        } catch {
            state = .failed(DesignFormat.errorText(error))
        }
    }

    static func name(_ ns: AppNamespace) -> String {
        let trimmed = ns.name?.trimmingCharacters(in: .whitespaces) ?? ""
        return trimmed.isEmpty ? "Team \(DesignFormat.shortId(ns.id))" : trimmed
    }
}

// MARK: - Boards

/// A board: a subgroup of the team with one context in it.
public struct BoardSummary: Identifiable, Equatable, Sendable {
    public var id: String { contextId }
    public let contextId: String
    public let groupId: String
    public var name: String
    public var description: String
    /// From the board's own `get_board`, once it answers.
    public var elementCount: Int?
}

/// A team's boards.
@MainActor
public final class BoardsModel: ObservableObject {
    @Published public private(set) var boards: [BoardSummary] = []
    @Published public private(set) var state: LoadState = .idle
    public let teamId: String
    let backend: any MeroAppBackend

    public init(backend: any MeroAppBackend, teamId: String) {
        self.backend = backend
        self.teamId = teamId
    }

    public func load() async {
        if boards.isEmpty { state = .loading }
        do {
            let subgroups = try await backend.listSubgroups(namespaceId: teamId)
            let listed = subgroups.compactMap { sg -> BoardSummary? in
                guard let ctx = sg.contextIds.first else { return nil }
                let name = sg.name?.trimmingCharacters(in: .whitespaces) ?? ""
                let known = boards.first { $0.contextId == ctx }
                return BoardSummary(
                    contextId: ctx, groupId: sg.groupId,
                    name: known?.name ?? (name.isEmpty ? "Board \(DesignFormat.shortId(ctx))" : name),
                    description: known?.description ?? "", elementCount: known?.elementCount)
            }
            boards = listed
            state = .loaded
            await enrich()
        } catch {
            state = .failed(DesignFormat.errorText(error))
        }
    }

    /// The board's own name, description and size: the replicated name wins
    /// over the listing's. A board this account cannot read yet keeps its listing.
    private func enrich() async {
        let backend = backend
        let infos = await withTaskGroup(of: (String, BoardInfo?).self) { group in
            for b in boards {
                group.addTask { (b.contextId, try? await backend.designClient(b.contextId).getBoard()) }
            }
            var out: [String: BoardInfo] = [:]
            for await (id, info) in group { if let info { out[id] = info } }
            return out
        }
        boards = boards.map { b in
            guard let info = infos[b.contextId] else { return b }
            var b = b
            let name = info.name.trimmingCharacters(in: .whitespaces)
            if !name.isEmpty { b.name = name }
            b.description = info.description
            b.elementCount = Int(info.elementCount)
            return b
        }
    }
}

// MARK: - Board

/// Someone else looking at the board right now.
public struct Viewer: Identifiable, Equatable, Sendable {
    public var id: String { account }
    public let account: String
    public let name: String
    public let point: Point
}

/// One open board, read-only: the scene, comments, who else is here.
@MainActor
public final class BoardModel: ObservableObject {
    public enum Phase: Equatable, Sendable {
        case loading
        case ready
        case failed(String)
    }

    @Published public private(set) var phase: Phase = .loading
    @Published public private(set) var name: String
    @Published public private(set) var elements: [Element] = []
    @Published public private(set) var scene: BoardScene = .empty
    /// Oldest first, like the web's thread list.
    @Published public private(set) var comments: [Comment] = []
    @Published public private(set) var members: [Member] = []
    @Published public private(set) var viewers: [Viewer] = []
    /// `admin`, `editor` or `viewer`; `nil` until known.
    @Published public private(set) var role: String?
    /// Image bytes by blob id.
    @Published public private(set) var images: [String: Data] = [:]

    public let contextId: String
    public let teamId: String
    let backend: any MeroAppBackend
    let client: DesignClient
    let blobs: any BlobLoading
    let measure: MeasureFactory
    let now: () -> Date
    private var fetching: Set<String> = []
    /// What this phone wrote that a read has not shown yet: kept on screen
    /// until the relay's state catches up.
    private var pendingComments: [Comment] = []
    private var pendingReplies: [String: [CommentReply]] = [:]
    private var refreshing = false
    private var dirty = false

    /// A pointer counts as here for this long after it last moved (the web's window).
    public static let viewerWindowMs: UInt64 = 10_000
    /// How often to re-read when the relay cannot stream events.
    public static let pollInterval: UInt64 = 5_000_000_000

    public init(
        backend: any MeroAppBackend, teamId: String, contextId: String, name: String = "",
        blobs: any BlobLoading = NoBlobs(), measure: @escaping MeasureFactory = estimateMeasure,
        now: @escaping () -> Date = Date.init
    ) {
        self.backend = backend
        self.teamId = teamId
        self.contextId = contextId
        self.name = name
        self.client = backend.designClient(contextId)
        self.blobs = blobs
        self.measure = measure
        self.now = now
    }

    /// Whether this account may comment: editors and admins (the contract's rule).
    public var canComment: Bool { role == "admin" || role == "editor" }
    /// This account's name on the board's roster; `nil` until it has joined it.
    public var myName: String? {
        members.first { $0.id == backend.account }?.username.trimmingCharacters(in: .whitespaces).nonEmpty
    }
    public var shareLink: String { DesignFormat.boardLink(teamId: teamId, contextId: contextId) }
    public var account: String { backend.account }

    /// Join the board's context when this account is not in it yet (an open
    /// subgroup of the team), then read everything.
    public func open() async {
        phase = .loading
        if let member = try? await backend.isMember(contextId: contextId), !member {
            do {
                try await backend.joinContext(contextId: contextId)
            } catch {
                phase = .failed("Couldn't join this board: \(DesignFormat.errorText(error))")
                return
            }
        }
        do {
            try await loadElements()
            phase = .ready
        } catch {
            phase = .failed(DesignFormat.errorText(error))
            return
        }
        await loadRest()
    }

    /// Re-read the board, coalescing bursts of events into one read at a time.
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
                try await loadElements()
                if phase != .ready { phase = .ready }
            } catch {
                if elements.isEmpty, phase != .ready { phase = .failed(DesignFormat.errorText(error)) }
            }
            await loadRest()
        } while dirty
    }

    /// Follow the board until the task is cancelled: the relay's events when it
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

    /// A display name for a member id: their roster name, else a short id.
    public func name(for member: String) -> String {
        if member == backend.account, let mine = myName { return mine }
        if let m = members.first(where: { $0.id == member }), let n = m.username.trimmingCharacters(in: .whitespaces).nonEmpty {
            return n
        }
        return DesignFormat.shortId(member)
    }

    /// Pin a comment at `point` (canvas pixels). A first comment on a board
    /// puts this account on its roster under `joinAs`, so others see a name.
    public func addComment(_ text: String, at point: Point, joinAs: String? = nil) async throws {
        let content = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else { return }
        try await joinRosterIfNeeded(joinAs)
        let id = UUID().uuidString.lowercased()
        let at = millis()
        try await client.addComment(
            id: id, x: Int64(point.x.rounded()), y: Int64(point.y.rounded()), content: content, createdAt: at)
        pendingComments.append(
            Comment(
                id: id, x: Int64(point.x.rounded()), y: Int64(point.y.rounded()), content: content,
                author: backend.account, createdAt: at, replies: []))
        await loadComments()
    }

    /// Answer a comment.
    public func reply(to commentId: String, _ text: String, joinAs: String? = nil) async throws {
        let content = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else { return }
        try await joinRosterIfNeeded(joinAs)
        let id = UUID().uuidString.lowercased()
        let at = millis()
        try await client.addReply(commentId: commentId, replyId: id, content: content, createdAt: at)
        pendingReplies[commentId, default: []].append(
            CommentReply(id: id, content: content, author: backend.account, createdAt: at))
        await loadComments()
    }

    /// Recompute the scene with the platform's text metrics.
    public func remeasure(_ measure: @escaping MeasureFactory) {
        scene = BoardScene(elements: elements, measure: measure)
    }

    // MARK: Reads

    private func loadElements() async throws {
        let els = try await client.getElements()
        if els != elements || scene == .empty {
            elements = els
            scene = BoardScene(elements: els, measure: measure)
        }
        fetchImages()
    }

    private func loadRest() async {
        async let info = try? client.getBoard()
        async let members = try? client.getMembers()
        async let role = try? client.myRole()
        async let cursors = try? client.getCursors()
        await loadComments()
        if let info = await info, let n = info.name.trimmingCharacters(in: .whitespaces).nonEmpty { name = n }
        if let members = await members { self.members = members }
        if let role = await role { self.role = role }
        if let cursors = await cursors { viewers = activeViewers(cursors) }
    }

    private func loadComments() async {
        let read = try? await client.getComments()
        var list = read ?? comments
        if read != nil {
            let ids = Set(list.map(\.id))
            pendingComments.removeAll { ids.contains($0.id) }
        }
        for c in pendingComments where !list.contains(where: { $0.id == c.id }) { list.append(c) }
        for (commentId, replies) in pendingReplies {
            guard let i = list.firstIndex(where: { $0.id == commentId }) else { continue }
            let have = Set(list[i].replies.map(\.id))
            if read != nil { pendingReplies[commentId] = replies.filter { !have.contains($0.id) } }
            list[i].replies += replies.filter { !have.contains($0.id) }
        }
        pendingReplies = pendingReplies.filter { !$0.value.isEmpty }
        comments = list.sorted { ($0.createdAt, $0.id) < ($1.createdAt, $1.id) }
    }

    func activeViewers(_ cursors: [CursorState]) -> [Viewer] {
        let nowMs = millis()
        var seen: Set<String> = []
        return cursors
            .sorted { $0.updatedAt > $1.updatedAt }
            .filter { c in
                c.account != backend.account && nowMs >= c.updatedAt && nowMs - c.updatedAt < Self.viewerWindowMs
                    && seen.insert(c.account).inserted
            }
            .map { Viewer(account: $0.account, name: name(for: $0.account), point: Point(Double($0.x), Double($0.y))) }
    }

    private func fetchImages() {
        for el in elements {
            guard case .image(let img) = el.data, images[img.blobId] == nil, !fetching.contains(img.blobId) else {
                continue
            }
            let blobId = img.blobId
            fetching.insert(blobId)
            let blobs = blobs
            let contextId = contextId
            Task { [weak self] in
                let data = try? await blobs.blob(id: blobId, contextId: contextId)
                guard let self else { return }
                if let data { self.images[blobId] = data } else { self.fetching.remove(blobId) }
            }
        }
    }

    private func joinRosterIfNeeded(_ name: String?) async throws {
        guard myName == nil, let name = name?.trimmingCharacters(in: .whitespaces).nonEmpty else { return }
        try await client.join(username: name, avatar: nil, timestamp: millis())
        if let list = try? await client.getMembers() { members = list }
        if myName == nil {
            members.append(Member(id: backend.account, username: name, avatar: nil, joinedAt: millis(), usernameUpdatedAt: millis()))
        }
    }

    private func millis() -> UInt64 { UInt64(max(0, now().timeIntervalSince1970 * 1000)) }
}

extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}
