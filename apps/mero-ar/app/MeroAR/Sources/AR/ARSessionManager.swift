#if canImport(ARKit)
import Foundation
import ARKit
import RealityKit
import Combine
import simd

/// Owns the ARView + ARSession, mirrors the shared scene graph into RealityKit
/// entities, raycasts for placement, publishes the local camera pose for
/// presence, and saves/loads the shared `ARWorldMap` for cross-device
/// relocalization (the approach chosen in merointerier.md P4.1).
@MainActor
public final class ARSessionManager: NSObject, ObservableObject, ARSessionDelegate {
    public let arView = ARView(frame: .zero)

    /// All synced objects are children of this anchor (the shared world origin).
    private let rootAnchor = AnchorEntity(world: .zero)
    private var entities: [String: ModelEntity] = [:]

    /// Throttle presence to ~10 Hz.
    private var lastPoseSentAt: TimeInterval = 0
    public var onCameraPose: ((Vec3, Quat) -> Void)?

    /// Called when the user taps an entity (object id) — for selection/locking.
    public var onSelect: ((String) -> Void)?

    public override init() {
        super.init()
        arView.scene.addAnchor(rootAnchor)
        arView.session.delegate = self
    }

    // ── Session lifecycle ─────────────────────────────────────────────────────

    public func start(worldMap: ARWorldMap? = nil) {
        let config = ARWorldTrackingConfiguration()
        config.planeDetection = [.horizontal, .vertical]
        if ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
            config.sceneReconstruction = .mesh
        }
        if let worldMap { config.initialWorldMap = worldMap } // relocalize into shared room
        config.environmentTexturing = .automatic
        arView.session.run(config, options: [.resetTracking, .removeExistingAnchors])
    }

    public func pause() { arView.session.pause() }

    /// Serialize the current world map for upload (publish the shared room).
    public func saveWorldMap() async throws -> Data {
        try await withCheckedThrowingContinuation { cont in
            arView.session.getCurrentWorldMap { map, error in
                if let map {
                    do { cont.resume(returning: try NSKeyedArchiver.archivedData(withRootObject: map, requiringSecureCoding: true)) }
                    catch { cont.resume(throwing: error) }
                } else {
                    cont.resume(throwing: error ?? NSError(domain: "MeroAR", code: -1))
                }
            }
        }
    }

    public static func decodeWorldMap(_ data: Data) -> ARWorldMap? {
        try? NSKeyedUnarchiver.unarchivedObject(ofClass: ARWorldMap.self, from: data)
    }

    // ── Scene sync ──────────────────────────────────────────────────────────────

    /// Reconcile RealityKit entities against the authoritative object set.
    public func sync(_ objects: [SceneObject]) {
        let want = Set(objects.map(\.id))
        // Remove deleted.
        for (id, entity) in entities where !want.contains(id) {
            entity.removeFromParent()
            entities[id] = nil
        }
        // Add / update.
        for obj in objects {
            if let entity = entities[obj.id] {
                entity.transform = RealityKit.Transform(matrix: obj.transform.matrix)
            } else {
                let entity = makeEntity(for: obj)
                entities[obj.id] = entity
                rootAnchor.addChild(entity)
            }
        }
    }

    private func makeEntity(for obj: SceneObject) -> ModelEntity {
        let mesh: MeshResource
        switch obj.data.kind {
        case "sphere": mesh = .generateSphere(radius: 0.05)
        case "marker": mesh = .generateSphere(radius: 0.02)
        case "arrow":  mesh = .generateBox(width: 0.02, height: 0.02, depth: 0.12)
        case "text":   mesh = .generateText(obj.data.content ?? "", extrusionDepth: 0.005,
                                            font: .systemFont(ofSize: 0.05))
        default:       mesh = .generateBox(size: 0.1) // cube + image placeholder
        }
        let material = SimpleMaterial(color: Self.color(from: obj.color), isMetallic: false)
        let entity = ModelEntity(mesh: mesh, materials: [material])
        entity.transform = RealityKit.Transform(matrix: obj.transform.matrix)
        entity.generateCollisionShapes(recursive: true)
        entity.name = obj.id
        return entity
    }

    private static func color(from hex: String) -> UIColor {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard let v = UInt32(s, radix: 16), s.count == 6 else { return .systemBlue }
        return UIColor(red: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255,
                       blue: CGFloat(v & 0xff) / 255, alpha: 1)
    }

    // ── Placement & hit-testing ───────────────────────────────────────────────

    /// Raycast from the screen centre onto detected geometry; returns the world
    /// transform to place a new object, or nil if nothing was hit.
    public func placementTransform() -> Transform? {
        let center = CGPoint(x: arView.bounds.midX, y: arView.bounds.midY)
        let results = arView.raycast(from: center, allowing: .estimatedPlane, alignment: .any)
        guard let first = results.first else { return nil }
        return Transform(matrix: first.worldTransform)
    }

    public func entityID(at point: CGPoint) -> String? {
        arView.entity(at: point)?.name
    }

    // ── ARSessionDelegate: publish camera pose for presence ────────────────────

    public func session(_ session: ARSession, didUpdate frame: ARFrame) {
        let now = frame.timestamp
        guard now - lastPoseSentAt > 0.1 else { return } // ~10 Hz
        lastPoseSentAt = now
        let t = frame.camera.transform
        let pos = SIMD3(t.columns.3.x, t.columns.3.y, t.columns.3.z)
        var r = t
        r.columns.3 = SIMD4(0, 0, 0, 1)
        onCameraPose?(Vec3(pos), Quat(simd_quatf(r)))
    }
}
#endif
