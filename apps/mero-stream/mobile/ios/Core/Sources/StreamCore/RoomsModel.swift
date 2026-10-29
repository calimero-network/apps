import Foundation
import MeroKit

/// One stream's rooms (the web's `/streams/:namespaceId`): listing them,
/// creating one (an open subgroup plus the context that is its call), entering
/// one, and minting room or stream links.
@MainActor
public final class RoomsModel: ObservableObject {
    @Published public private(set) var rooms: [RoomSummary] = []
    /// Who is in each room, by context id, when the roster could be read.
    @Published public private(set) var rosters: [String: [Member]] = [:]
    @Published public private(set) var isLoading = false
    @Published public private(set) var hasLoaded = false
    /// The action in flight: "create", "enter:<room>", "invite:<room>", "invite".
    @Published public private(set) var pending: String?
    @Published public var status: String?
    @Published public var error: String?

    public let stream: StreamSummary
    public let backend: any MeroAppBackend
    private let applicationId: String?
    private let sleep: @Sendable (UInt64) async -> Void

    public init(
        stream: StreamSummary, backend: any MeroAppBackend, applicationId: String?,
        sleep: @escaping @Sendable (UInt64) async -> Void = { try? await Task.sleep(nanoseconds: $0 * 1_000_000) }
    ) {
        self.stream = stream
        self.backend = backend
        self.applicationId = applicationId
        self.sleep = sleep
    }

    public func load() async {
        isLoading = true
        defer {
            isLoading = false
            hasLoaded = true
        }
        do {
            let subgroups = try await backend.listSubgroups(namespaceId: stream.id)
            rooms = subgroups.map {
                RoomSummary(id: $0.groupId, namespaceId: stream.id, name: $0.name ?? "", contextId: $0.contextIds.first)
            }
            .sorted { $0.title.localizedCompare($1.title) == .orderedAscending }
            error = nil
            await loadRosters()
        } catch {
            self.error = ErrorText.describe(error)
        }
    }

    /// Each room's roster, read in parallel. Best effort: a room we are not in
    /// may refuse the read.
    private func loadRosters() async {
        let backend = backend
        let contexts = rooms.compactMap(\.contextId)
        let found = await withTaskGroup(of: (String, [Member]?).self) { group in
            for contextId in contexts {
                group.addTask { (contextId, try? await StreamClient(backend: backend, contextId: contextId).getMembers()) }
            }
            var out: [String: [Member]] = [:]
            for await (id, members) in group { if let members { out[id] = members } }
            return out
        }
        rosters = found
    }

    /// Create a room and its call. Returns it, ready to enter.
    public func create(name: String) async -> RoomSummary? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        pending = "create"
        defer {
            pending = nil
            status = nil
        }
        do {
            status = "Creating the room…"
            let groupId = try await backend.createSubgroup(namespaceId: stream.id, name: trimmed, isPublic: true)
            status = "Creating the call context…"
            let app = try await resolveApplicationId()
            let contextId = try await backend.createContext(
                groupId: groupId, applicationId: app, name: trimmed, initArgs: .object(["name": .string(trimmed)]))
            let room = RoomSummary(id: groupId, namespaceId: stream.id, name: trimmed, contextId: contextId)
            rooms = (rooms + [room]).sorted { $0.title.localizedCompare($1.title) == .orderedAscending }
            error = nil
            return room
        } catch {
            self.error = ErrorText.describe(error)
            return nil
        }
    }

    /// Join the room's call context if needed. Returns the room to open.
    public func enter(_ room: RoomSummary) async -> RoomSummary? {
        guard let contextId = room.contextId else {
            error = StreamError.noRoomContext(room.title).errorDescription
            return nil
        }
        pending = "enter:\(room.id)"
        defer {
            pending = nil
            status = nil
        }
        status = "Checking your membership…"
        if (try? await backend.isMember(contextId: contextId)) == true { return room }
        status = "Joining the room…"
        var lastError: Error?
        // Membership of a stream you just joined can take a moment to reach
        // the relay; the web waits for it the same way.
        for attempt in 0..<4 {
            do {
                try await backend.joinContext(contextId: contextId)
                error = nil
                return room
            } catch {
                lastError = error
                if attempt == 0 { status = "Waiting for your membership to reach the room…" }
                await sleep(1_500)
            }
        }
        error = lastError.map(ErrorText.describe)
        return nil
    }

    /// A link that drops someone straight into this room's call.
    public func inviteLink(for room: RoomSummary) async -> String? {
        await mint(key: "invite:\(room.id)") { signed in
            StreamInvitation(
                invitation: signed, kind: .room, namespaceId: stream.id, namespaceName: stream.title, roomId: room.id,
                contextId: room.contextId, roomName: room.title)
        }
    }

    /// A link that joins the whole stream and lands on its rooms.
    public func streamInviteLink() async -> String? {
        await mint(key: "invite") { signed in
            StreamInvitation(invitation: signed, kind: .namespace, namespaceId: stream.id, namespaceName: stream.title)
        }
    }

    private func mint(key: String, _ make: (SignedGroupOpenInvitation) -> StreamInvitation) async -> String? {
        pending = key
        defer { pending = nil }
        do {
            let signed = try await backend.createInvitation(namespaceId: stream.id)
            return try make(signed).link()
        } catch {
            self.error = ErrorText.describe(error)
            return nil
        }
    }

    private func resolveApplicationId() async throws -> String {
        if let applicationId, !applicationId.isEmpty { return applicationId }
        let namespaces = try await backend.listNamespaces()
        guard let app = namespaces.first(where: { $0.id == stream.id })?.applicationId, !app.isEmpty else {
            throw StreamError.noApplication
        }
        return app
    }
}
