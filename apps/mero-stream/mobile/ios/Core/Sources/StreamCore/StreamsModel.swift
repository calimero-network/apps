import Foundation
import MeroKit

/// A stream: a namespace you invite people to. Each room in it is one call.
public struct StreamSummary: Identifiable, Hashable, Sendable {
    public let id: String
    public var name: String
    public var memberCount: Int
    public var roomCount: Int?

    public init(id: String, name: String, memberCount: Int = 0, roomCount: Int? = nil) {
        self.id = id
        self.name = name
        self.memberCount = memberCount
        self.roomCount = roomCount
    }

    /// The web's fallback for an unnamed namespace.
    public var title: String {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty ? "Stream \(id.prefix(6))" : trimmed
    }
}

/// A room: a subgroup of the stream, and the context that is its call.
public struct RoomSummary: Identifiable, Hashable, Sendable {
    public let id: String
    public let namespaceId: String
    public var name: String
    public var contextId: String?

    public init(id: String, namespaceId: String, name: String, contextId: String?) {
        self.id = id
        self.namespaceId = namespaceId
        self.name = name
        self.contextId = contextId
    }

    public var title: String {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty ? "Room \(id.prefix(6))" : trimmed
    }
}

/// Where redeeming an invitation lands: a stream's rooms, or straight into a call.
public enum InvitationLanding: Equatable, Sendable {
    case stream(StreamSummary)
    case room(StreamSummary, RoomSummary)
}

/// The stream list (the web's `/streams`): the account's namespaces for this
/// app, creating one, inviting to one, and joining one from a link.
@MainActor
public final class StreamsModel: ObservableObject {
    @Published public private(set) var streams: [StreamSummary] = []
    @Published public private(set) var isLoading = false
    @Published public private(set) var hasLoaded = false
    @Published public private(set) var isWorking = false
    @Published public var error: String?
    /// Something to point out that is not an error.
    @Published public var notice: String?

    public let backend: any MeroAppBackend

    public init(backend: any MeroAppBackend) {
        self.backend = backend
    }

    public func load() async {
        isLoading = true
        defer {
            isLoading = false
            hasLoaded = true
        }
        do {
            let namespaces = try await backend.listNamespaces()
            let backend = backend
            let counts = await withTaskGroup(of: (String, Int?).self) { group in
                for ns in namespaces {
                    group.addTask { (ns.id, try? await backend.listSubgroups(namespaceId: ns.id).count) }
                }
                var out: [String: Int] = [:]
                for await (id, count) in group { if let count { out[id] = count } }
                return out
            }
            streams = namespaces.map {
                StreamSummary(id: $0.id, name: $0.name ?? "", memberCount: $0.memberCount, roomCount: counts[$0.id])
            }
            .sorted { $0.title.localizedCompare($1.title) == .orderedAscending }
            error = nil
        } catch {
            self.error = ErrorText.describe(error)
        }
    }

    /// Found a stream. Returns it, or nil with ``error`` set.
    public func create(name: String) async -> StreamSummary? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        isWorking = true
        defer { isWorking = false }
        do {
            let founded = try await backend.foundNamespace(name: trimmed)
            let stream = StreamSummary(id: founded.namespaceId, name: trimmed, memberCount: 1, roomCount: 0)
            streams = (streams.filter { $0.id != stream.id } + [stream])
                .sorted { $0.title.localizedCompare($1.title) == .orderedAscending }
            error = nil
            return stream
        } catch {
            self.error = ErrorText.describe(error)
            return nil
        }
    }

    /// A link that joins the whole stream and lands on its rooms.
    public func inviteLink(for stream: StreamSummary) async -> String? {
        isWorking = true
        defer { isWorking = false }
        do {
            let invitation = try await backend.createInvitation(namespaceId: stream.id)
            return try StreamInvitation(invitation: invitation, kind: .namespace, namespaceName: stream.title).link()
        } catch {
            self.error = ErrorText.describe(error)
            return nil
        }
    }

    /// Redeem an invitation. Nil with ``error`` set when the node refused.
    public func join(_ invitation: StreamInvitation) async -> InvitationLanding? {
        isWorking = true
        defer { isWorking = false }
        do {
            _ = try await backend.joinNamespace(namespaceId: invitation.namespaceId, invitation: invitation.invitation)
            let stream = StreamSummary(id: invitation.namespaceId, name: invitation.namespaceName ?? "")
            if !streams.contains(where: { $0.id == stream.id }) { streams.append(stream) }
            error = nil
            if invitation.opensRoom, let roomId = invitation.roomId {
                let room = RoomSummary(
                    id: roomId, namespaceId: invitation.namespaceId, name: invitation.roomName ?? "",
                    contextId: invitation.contextId)
                return .room(stream, room)
            }
            return .stream(stream)
        } catch {
            self.error = ErrorText.describe(error)
            return nil
        }
    }
}
