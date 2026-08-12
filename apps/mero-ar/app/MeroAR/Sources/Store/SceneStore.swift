import Foundation
import MeroKit

/// Observable scene state. Hydrates from the contract, reconciles live via SSE.
/// The AR layer observes `objects`/`presence` and mirrors them into RealityKit.
@MainActor
public final class SceneStore: ObservableObject {
    @Published public private(set) var objects: [String: SceneObject] = [:]
    @Published public private(set) var presence: [String: Presence] = [:]
    @Published public private(set) var members: [Member] = []
    @Published public private(set) var roles: [MemberRole] = []
    @Published public private(set) var room: RoomInfo?
    /// The caller's effective role — "admin", "editor", or "viewer". Empty until
    /// `my_role` first resolves, so the UI can tell "not known yet" from
    /// "genuinely view-only" instead of flashing a false view-only banner at the
    /// room's own owner.
    @Published public private(set) var myRole = ""
    @Published public var lastError: String?

    public let service: MeroARService
    private var eventTask: Task<Void, Never>?

    /// Object ids we just mutated locally — used to ignore our own SSE echoes.
    private var localEchoes: Set<String> = []

    public init(service: MeroARService) { self.service = service }

    public var sortedObjects: [SceneObject] { objects.values.sorted { $0.createdAt < $1.createdAt } }

    /// Whether this device may change the scene. Viewers see the room live and
    /// appear in it, but the contract rejects their writes — so the UI hides the
    /// tools rather than letting every tap fail.
    public var canEdit: Bool { myRole == "admin" || myRole == "editor" }
    public var isAdmin: Bool { myRole == "admin" }
    public var memberId: String { service.memberId }

    public func bootstrap(username: String) async {
        do {
            try await service.join(username: username)
            await refresh()
            startListening()
        } catch { lastError = error.localizedDescription }
    }

    public func refresh() async {
        do {
            async let objs = service.getObjects()
            async let pres = service.getPresence()
            async let room = service.getRoom()
            self.objects = Dictionary(uniqueKeysWithValues: try await objs.map { ($0.id, $0) })
            self.presence = Dictionary(uniqueKeysWithValues: try await pres.map { ($0.identity, $0) })
            self.room = try await room
        } catch { lastError = error.localizedDescription }
        await refreshRole()
        await refreshRoster()
    }

    /// Re-resolve our own role. Fails **closed**: if the call errors we drop to
    /// viewer rather than keeping edit affordances a revoke may have removed.
    public func refreshRole() async {
        do { myRole = try await service.myRole() } catch { myRole = "viewer" }
    }

    public func refreshRoster() async {
        members = (try? await service.getMembers()) ?? members
        roles = (try? await service.listRoles()) ?? roles
    }

    private func startListening() {
        eventTask?.cancel()
        eventTask = Task { [weak self] in
            guard let self else { return }
            // The SDK's SSE client reconnects internally, but its stream still
            // *ends* once it gives up. Without this outer loop the room would go
            // quiet for the rest of the session with no sign anything was wrong.
            while !Task.isCancelled {
                await self.consumeEvents()
                if Task.isCancelled { break }
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                // Re-read state: whatever happened while the stream was down was
                // never delivered as an event.
                await self.refresh()
            }
        }
    }

    private func consumeEvents() async {
        for await event in service.events() {
            if Task.isCancelled { break }
            switch event {
            case .objectAdded(let id), .objectUpdated(let id),
                 .objectLocked(let id), .objectUnlocked(let id):
                if self.localEchoes.remove(id) != nil { continue } // ignore our echo
                await self.refreshObject(id)
            case .objectDeleted(let id):
                self.objects[id] = nil
            case .presenceUpdated:
                await self.refreshPresence()
            case .memberJoined:
                await self.refreshRoster()
            case .roleUpdated, .ownerTransferred:
                // A grant/revoke/transfer may have flipped OUR role — resolve
                // it now instead of waiting for the next refresh.
                await self.refreshRole()
                await self.refreshRoster()
                self.room = (try? await self.service.getRoom()) ?? self.room
            case .roomUpdated, .anchorsUpdated:
                self.room = (try? await self.service.getRoom()) ?? self.room
            default:
                break
            }
        }
    }

    private func refreshObject(_ id: String) async {
        // `try?` flattens the contract's `Option<SceneObject>` into one optional:
        // both a failed call and a since-deleted object arrive as nil.
        if let object = try? await service.getObject(id: id) {
            objects[id] = object
        }
    }

    private func refreshPresence() async {
        if let p = try? await service.getPresence() {
            presence = Dictionary(uniqueKeysWithValues: p.map { ($0.identity, $0) })
        }
    }

    // ── Mutations (optimistic + echo-suppressed) ──────────────────────────────

    public func addObject(kind: String, transform: Transform, color: String) async {
        let object = SceneObject(id: UUID().uuidString, data: ObjectData(kind: kind),
                                 transform: transform, color: color, lockedBy: nil,
                                 createdBy: service.memberId,
                                 createdAt: now(), updatedAt: now(), version: 0)
        objects[object.id] = object
        localEchoes.insert(object.id)
        do { try await service.addObject(object) } catch { await revert(object.id, error) }
    }

    public func updateTransform(id: String, transform: Transform) async {
        let previous = objects[id]
        objects[id]?.transform = transform
        localEchoes.insert(id)
        do { try await service.updateTransform(id: id, transform: transform) }
        catch {
            objects[id] = previous
            lastError = message(error)
        }
    }

    public func deleteObject(id: String) async {
        let previous = objects[id]
        objects[id] = nil
        do { try await service.deleteObject(id: id) }
        catch {
            objects[id] = previous
            lastError = message(error)
        }
    }

    public func addComment(text: String, position: Vec3) async {
        do { try await service.addComment(text: text, position: position) }
        catch { lastError = message(error) }
    }

    // ── Roles (admin only; the contract enforces it either way) ───────────────

    public func setEditor(_ member: String, enabled: Bool) async {
        do {
            if enabled { try await service.grantEditor(member: member) }
            else { try await service.revokeEditor(member: member) }
            await refreshRoster()
            if member == service.memberId { await refreshRole() }
        } catch { lastError = message(error) }
    }

    public func publishWorldMap(_ data: Data) async -> Bool {
        do {
            try await service.publishWorldMap(data)
            room = (try? await service.getRoom()) ?? room
            return true
        } catch {
            lastError = message(error)
            return false
        }
    }

    public func stop() { eventTask?.cancel(); eventTask = nil }

    /// A rejected placement must not leave a ghost object floating in the room.
    private func revert(_ id: String, _ error: Error) async {
        objects[id] = nil
        localEchoes.remove(id)
        lastError = message(error)
    }

    /// Contract rejections arrive as JSON-RPC errors; surface the contract's own
    /// sentence ("view-only: …") rather than a generic failure.
    private func message(_ error: Error) -> String {
        if case MeroError.rpc(let rpcError) = error { return rpcError.message }
        return (error as? LocalizedError)?.errorDescription ?? "\(error)"
    }

    private func now() -> UInt64 { UInt64(Date().timeIntervalSince1970 * 1000) }
}
