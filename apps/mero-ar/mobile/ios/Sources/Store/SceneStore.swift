import Foundation
import MeroKit

/// Observable scene state. Hydrates from the contract, then reconciles live from the
/// room's event stream (re-reading whatever happened while the stream was down).
/// The AR layer observes `objects`/`presence` and mirrors them into RealityKit.
@MainActor
public final class SceneStore: ObservableObject {
    @Published public private(set) var objects: [String: SceneObject] = [:]
    /// Camera poses by DEVICE — one entry per installation in the room, so a
    /// member on two devices renders as two viewpoints. Keyed by
    /// `Presence.identity`; to ask whether a *person* is here use
    /// ``onlineMembers``.
    @Published public private(set) var presence: [String: Presence] = [:]
    @Published public private(set) var members: [Member] = []
    /// The room's 3D scan record, and the room model it names once downloaded.
    @Published public private(set) var roomScan: RoomScanRecord?
    @Published public private(set) var roomModel: RoomModel?
    @Published public private(set) var isPublishingScan = false
    @Published public private(set) var isUploadingPicture = false
    /// Notes pinned to points in the room, oldest first.
    @Published public private(set) var comments: [SpatialComment] = []
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
    private var presenceInFlight = false

    public init(service: MeroARService) { self.service = service }

    public var sortedObjects: [SceneObject] { objects.values.sorted { $0.createdAt < $1.createdAt } }

    /// Whether this device may change the scene. Viewers see the room live and
    /// appear in it, but the contract rejects their writes — so the UI hides the
    /// tools rather than letting every tap fail.
    public var canEdit: Bool { myRole == "admin" || myRole == "editor" }
    public var isAdmin: Bool { myRole == "admin" }
    public var memberId: String { service.memberId }

    /// The members with at least one device in the room. The roster keys on
    /// accounts, `presence` keys on devices, so this is the join between them.
    public var onlineMembers: Set<String> { Set(presence.values.map(\.member)) }

    public func bootstrap(username: String) async {
        do {
            try await service.join(username: username)
            await refresh()
            startListening()
        } catch { lastError = message(error) }
    }

    public func refresh() async {
        do {
            async let objs = service.getObjects()
            async let pres = service.getPresence()
            async let room = service.getRoom()
            self.objects = Dictionary(uniqueKeysWithValues: try await objs.map { ($0.id, $0) })
            self.presence = Dictionary(uniqueKeysWithValues: try await pres.map { ($0.identity, $0) })
            self.room = try await room
        } catch { lastError = message(error) }
        await refreshRole()
        await refreshRoster()
        await refreshComments()
        await refreshRoomScan()
    }

    /// Re-read the room's scan, and download its model when it changed.
    public func refreshRoomScan() async {
        guard let record = try? await service.getRoomScan() else {
            roomScan = nil
            roomModel = nil
            return
        }
        if record != roomScan || roomModel == nil {
            roomScan = record
            if let model = try? await service.loadRoomModel(record) { roomModel = model }
        }
    }

    public func clearRoomScan() async {
        do {
            try await service.clearRoomScan()
            roomScan = nil
            roomModel = nil
        } catch { lastError = message(error) }
    }

    /// Move an object to a floor position (from a drag), keeping its turn and size.
    public func move(id: String, to point: SIMD3<Float>) async {
        guard var transform = objects[id]?.transform else { return }
        transform.position = Vec3(Double(point.x), Double(point.y), Double(point.z))
        await updateTransform(id: id, transform: transform)
    }

    /// Share a room model (a scan, or the sample) as this room's 3D room.
    public func publishRoomScan(_ model: RoomModel, usdz: Data? = nil) async -> Bool {
        isPublishingScan = true
        defer { isPublishingScan = false }
        do {
            try await service.publishRoomScan(model, usdz: usdz)
            roomModel = model
            await refreshRoomScan()
            return true
        } catch {
            lastError = message(error)
            return false
        }
    }

    public func refreshComments() async {
        if let all = try? await service.getComments() { comments = all.sorted { $0.createdAt < $1.createdAt } }
    }

    /// The display name for a member id, else a short id.
    public func name(of member: String) -> String {
        if let known = members.first(where: { $0.id == member })?.username, !known.isEmpty { return known }
        return member.isEmpty ? "Someone" : "Member \(member.prefix(4))"
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

    /// Whether the room's event stream is connected; while it is down the
    /// store re-reads the room every few seconds instead.
    @Published public private(set) var isLive = true

    private func startListening() {
        eventTask?.cancel()
        eventTask = Task { [weak self] in
            guard let self else { return }
            // The stream ends when the connection drops (or a leader moves).
            // Without this outer loop the room would go quiet for the rest of
            // the session with no sign anything was wrong.
            while !Task.isCancelled {
                self.isLive = true
                await self.consumeEvents()
                if Task.isCancelled { break }
                self.isLive = false
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
            case .commentAdded, .commentDeleted:
                await self.refreshComments()
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
            case .roomScanUpdated:
                await self.refreshRoomScan()
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

    public func addObject(kind: String, content: String? = nil, transform: Transform, color: String) async {
        await addObject(data: ObjectData(kind: kind, content: content), transform: transform, color: color)
    }

    @discardableResult
    public func addObject(data: ObjectData, transform: Transform, color: String) async -> Bool {
        let object = SceneObject(id: UUID().uuidString, data: data,
                                 transform: transform, color: color, lockedBy: nil,
                                 createdBy: service.memberId,
                                 createdAt: now(), updatedAt: now(), version: 0)
        objects[object.id] = object
        localEchoes.insert(object.id)
        do {
            try await service.addObject(object)
            return true
        } catch {
            await revert(object.id, error)
            return false
        }
    }

    /// Hang a photo in the room: upload the JPEG to the room's blobs, then add
    /// an `image` object naming it.
    public func addPicture(jpeg: Data, width: Int, height: Int, transform: Transform) async {
        isUploadingPicture = true
        defer { isUploadingPicture = false }
        do {
            let blobId = try await service.uploadBlob(jpeg)
            PictureCache.shared.seed(blobId: blobId, data: jpeg)
            await addObject(
                data: ObjectData(kind: "image", blobId: blobId, naturalWidth: width, naturalHeight: height),
                transform: transform, color: FurnitureItem.picture.defaultColor)
        } catch {
            lastError = message(error)
        }
    }

    /// Turn the scan's detected furniture into movable scene objects, then
    /// share the room again without those static boxes, so everyone sees
    /// pieces they can drag, turn and repaint. Fixtures with no catalogue piece
    /// (a sink, stairs) stay part of the room. Returns how many were converted.
    @discardableResult
    public func makeScannedFurnitureMovable() async -> Int {
        guard var model = roomModel else { return 0 }
        var converted: Set<String> = []
        for item in model.objects {
            guard let (data, transform) = FurnitureItem.sceneData(fromScanned: item),
                let piece = data.furniture
            else { continue }
            guard await addObject(data: data, transform: transform, color: piece.defaultColor) else { break }
            converted.insert(item.id)
        }
        guard !converted.isEmpty else {
            if lastError == nil { lastError = "Nothing in this scan can be made movable." }
            return 0
        }
        model.objects.removeAll { converted.contains($0.id) }
        _ = await publishRoomScan(model)
        return converted.count
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

    public func updateColor(id: String, color: String) async {
        let previous = objects[id]
        objects[id]?.color = color
        localEchoes.insert(id)
        do { try await service.updateColor(id: id, color: color) } catch {
            objects[id] = previous
            lastError = message(error)
        }
    }

    /// Lock an object so only you can move it, or release it.
    public func setLocked(id: String, _ locked: Bool) async {
        let previous = objects[id]
        objects[id]?.lockedBy = locked ? service.memberId : nil
        localEchoes.insert(id)
        do {
            if locked { try await service.lock(id: id) } else { try await service.unlock(id: id) }
        } catch {
            objects[id] = previous
            lastError = message(error)
        }
    }

    /// Whether someone else holds the lock on `id`.
    public func isLockedByOther(_ id: String) -> Bool {
        guard let holder = objects[id]?.lockedBy, !holder.isEmpty else { return false }
        return holder != service.memberId
    }

    public func deleteComment(id: String) async {
        comments.removeAll { $0.id == id }
        do { try await service.deleteComment(id: id) } catch { lastError = message(error) }
        await refreshComments()
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
        await refreshComments()
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

    /// Publish this device's camera pose. Each pose is a warranted write, so a
    /// pose is dropped while the previous one is still in flight rather than
    /// queueing a backlog behind a slow uplink.
    public func sendPresence(position: Vec3, rotation: Quat) {
        guard !presenceInFlight else { return }
        presenceInFlight = true
        Task {
            defer { presenceInFlight = false }
            try? await service.updatePresence(position: position, rotation: rotation)
        }
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

    /// Surface the contract's own sentence ("view-only: …") for a refused
    /// intent rather than a generic failure.
    private func message(_ error: Error) -> String { userMessage(error) }

    private func now() -> UInt64 { UInt64(Date().timeIntervalSince1970 * 1000) }
}
