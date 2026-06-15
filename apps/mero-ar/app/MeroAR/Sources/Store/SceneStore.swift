import Foundation
import MeroKit

/// Observable scene state. Hydrates from the contract, reconciles live via SSE.
/// The AR layer observes `objects`/`presence` and mirrors them into RealityKit.
@MainActor
public final class SceneStore: ObservableObject {
    @Published public private(set) var objects: [String: SceneObject] = [:]
    @Published public private(set) var presence: [String: Presence] = [:]
    @Published public private(set) var room: RoomInfo?
    @Published public var lastError: String?

    public let service: MeroARService
    private var eventTask: Task<Void, Never>?

    /// Object ids we just mutated locally — used to ignore our own SSE echoes.
    private var localEchoes: Set<String> = []

    public init(service: MeroARService) { self.service = service }

    public var sortedObjects: [SceneObject] { objects.values.sorted { $0.createdAt < $1.createdAt } }

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
    }

    private func startListening() {
        eventTask?.cancel()
        eventTask = Task { [weak self] in
            guard let self else { return }
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
                default:
                    break
                }
            }
        }
    }

    private func refreshObject(_ id: String) async {
        if let obj = try? await service.client.rpc.execute(
            contextId: service.contextId, method: "get_object",
            args: GetObjectArgs(id: id), as: SceneObject?.self) ?? nil {
            objects[id] = obj
        }
    }
    private struct GetObjectArgs: Encodable { let id: String }

    private func refreshPresence() async {
        if let p = try? await service.getPresence() {
            presence = Dictionary(uniqueKeysWithValues: p.map { ($0.identity, $0) })
        }
    }

    // ── Mutations (optimistic + echo-suppressed) ──────────────────────────────

    public func addObject(kind: String, transform: Transform, color: String) async {
        let obj = SceneObject(id: UUID().uuidString, data: ObjectData(kind: kind),
                              transform: transform, color: color, lockedBy: nil,
                              createdBy: service.memberId,
                              createdAt: now(), updatedAt: now(), version: 0)
        objects[obj.id] = obj
        localEchoes.insert(obj.id)
        do { try await service.addObject(obj) } catch { lastError = error.localizedDescription }
    }

    public func updateTransform(id: String, transform: Transform) async {
        objects[id]?.transform = transform
        localEchoes.insert(id)
        do { try await service.updateTransform(id: id, transform: transform) }
        catch { lastError = error.localizedDescription }
    }

    public func deleteObject(id: String) async {
        objects[id] = nil
        do { try await service.deleteObject(id: id) } catch { lastError = error.localizedDescription }
    }

    public func stop() { eventTask?.cancel(); eventTask = nil }

    private func now() -> UInt64 { UInt64(Date().timeIntervalSince1970 * 1000) }
}
