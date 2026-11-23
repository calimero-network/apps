import Foundation
import MeroKit

/// One stream's rooms (the web's `/streams/:orgId`): listing them, creating
/// one (an app instance in the stream's organization, initialised with its
/// name), entering one, and minting room or stream links.
///
/// There is no per-room join any more: the organization grants every room in
/// it, and the contract's own `join` (in the call) records the display name.
@MainActor
public final class RoomsModel: ObservableObject {
    @Published public private(set) var rooms: [RoomSummary] = []
    /// Who is in each room, by room id, when the roster could be read.
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

    public init(stream: StreamSummary, backend: any MeroAppBackend, applicationId: String?) {
        self.stream = stream
        self.backend = backend
        self.applicationId = applicationId
    }

    public func load() async {
        isLoading = true
        defer {
            isLoading = false
            hasLoaded = true
        }
        do {
            rooms = try await backend.listContextEntries(groupId: stream.id)
                .map { RoomSummary(id: $0.id, namespaceId: stream.id, name: $0.name ?? "") }
                .sorted(by: Self.order)
            error = nil
            await loadRosters()
        } catch {
            self.error = ErrorText.describe(error)
        }
    }

    /// Each room's roster, read in parallel. Best effort.
    private func loadRosters() async {
        let backend = backend
        let ids = rooms.map(\.id)
        rosters = await withTaskGroup(of: (String, [Member]?).self) { group in
            for id in ids {
                group.addTask { (id, try? await StreamClient(backend: backend, contextId: id).getMembers()) }
            }
            var out: [String: [Member]] = [:]
            for await (id, members) in group { if let members { out[id] = members } }
            return out
        }
    }

    /// Create a room: its call's app instance, named and initialised with the name.
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
            let app = try resolveApplicationId()
            let appId = try await backend.createContext(
                groupId: stream.id, applicationId: app, name: trimmed, initArgs: .object(["name": .string(trimmed)]))
            let room = RoomSummary(id: appId, namespaceId: stream.id, name: trimmed)
            rooms = (rooms.filter { $0.id != appId } + [room]).sorted(by: Self.order)
            error = nil
            return room
        } catch {
            self.error = ErrorText.describe(error)
            return nil
        }
    }

    /// The room to open. The stream's organization already grants it.
    public func enter(_ room: RoomSummary) async -> RoomSummary? {
        error = nil
        return room
    }

    /// A link that drops someone straight into this room's call.
    public func inviteLink(for room: RoomSummary) async -> String? {
        await mint(key: "invite:\(room.id)") { minted in
            StreamInvitation(
                invitation: minted, kind: .room, namespaceName: stream.title, roomId: room.id, contextId: room.id,
                roomName: room.title)
        }
    }

    /// A link that joins the whole stream and lands on its rooms.
    public func streamInviteLink() async -> String? {
        await mint(key: "invite") { minted in
            StreamInvitation(invitation: minted, kind: .namespace, namespaceName: stream.title)
        }
    }

    private func mint(key: String, _ make: (OrgInvitation) -> StreamInvitation) async -> String? {
        pending = key
        defer { pending = nil }
        do {
            let minted = try await backend.createInvitation(namespaceId: stream.id)
            return try make(minted).link()
        } catch {
            self.error = ErrorText.describe(error)
            return nil
        }
    }

    private func resolveApplicationId() throws -> String {
        guard let applicationId, !applicationId.isEmpty else { throw StreamError.noApplication }
        return applicationId
    }

    private static func order(_ a: RoomSummary, _ b: RoomSummary) -> Bool {
        let byName = a.title.localizedCompare(b.title)
        return byName == .orderedSame ? a.id < b.id : byName == .orderedAscending
    }
}
