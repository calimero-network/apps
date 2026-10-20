#if canImport(ARKit) && os(iOS)
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
public final class ARSessionManager: NSObject, ObservableObject, @preconcurrency ARSessionDelegate, RoomCanvas {
    public let arView = ARView(frame: .zero)

    /// All synced objects are children of this anchor (the shared world origin).
    private let rootAnchor = AnchorEntity(world: .zero)
    private var entities: [String: ModelEntity] = [:]
    /// What each entity was built from, so a colour or label change rebuilds it.
    private var signatures: [String: String] = [:]
    /// Other people's viewpoints and note pins.
    private let overlayAnchor = AnchorEntity(world: .zero)

    /// Throttle presence to ~2 Hz. Each pose is a contract mutation that the node
    /// stores and fans out over SSE to every peer, so the old 10 Hz meant ten
    /// state writes per second per device — enough to drown a room in CRDT
    /// deltas. Nothing renders other people's poses yet, and 2 Hz is plenty for
    /// the "who's here" count.
    private static let poseInterval: TimeInterval = 0.5
    private var lastPoseSentAt: TimeInterval = 0
    public var onCameraPose: ((Vec3, Quat) -> Void)?

    /// Called when the user taps an entity (its object id), or empty space (nil).
    var onSelect: ((String?) -> Void)?
    /// Dragging isn't offered in live AR (objects are moved with the inspector).
    var onMove: ((String, SIMD3<Float>) -> Void)?

    /// The live camera shows the real room; the 3D room view draws the scan.
    func showRoom(_ model: RoomModel?) {}
    func setFloorPlan(_ on: Bool) {}

    public override init() {
        super.init()
        arView.scene.addAnchor(rootAnchor)
        arView.scene.addAnchor(overlayAnchor)
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
    func sync(objects: [SceneObject], selected: String?, presence: [Presence], comments: [SpatialComment], me: String) {
        let want = Set(objects.map(\.id))
        for (id, entity) in entities where !want.contains(id) {
            entity.removeFromParent()
            entities[id] = nil
            signatures[id] = nil
        }
        for obj in objects {
            let signature = "\(obj.data.kind)|\(obj.color)|\(obj.data.content ?? "")|\(obj.id == selected)"
            if let entity = entities[obj.id], signatures[obj.id] == signature {
                entity.move(
                    to: RealityKit.Transform(matrix: obj.transform.matrix), relativeTo: rootAnchor, duration: 0.25)
            } else {
                entities[obj.id]?.removeFromParent()
                let entity = makeEntity(for: obj, selected: obj.id == selected)
                entities[obj.id] = entity
                signatures[obj.id] = signature
                rootAnchor.addChild(entity)
            }
        }
        drawOverlays(presence: presence.filter { $0.member != me }, comments: comments)
    }

    private func drawOverlays(presence: [Presence], comments: [SpatialComment]) {
        overlayAnchor.children.removeAll()
        let cyan = UIColor(red: 0.13, green: 0.83, blue: 0.93, alpha: 1)
        for viewer in presence {
            let orb = ModelEntity(mesh: .generateSphere(radius: 0.03), materials: [UnlitMaterial(color: cyan)])
            orb.position = viewer.cameraPosition.simd
            overlayAnchor.addChild(orb)
        }
        let pink = UIColor(red: 0.96, green: 0.45, blue: 0.71, alpha: 1)
        for comment in comments {
            let pin = ModelEntity(mesh: .generateSphere(radius: 0.018), materials: [UnlitMaterial(color: pink)])
            pin.position = comment.position.simd + SIMD3(0, 0.1, 0)
            overlayAnchor.addChild(pin)
        }
    }

    private func makeEntity(for obj: SceneObject, selected: Bool) -> ModelEntity {
        let mesh: MeshResource
        switch obj.data.kind {
        case "sphere": mesh = .generateSphere(radius: 0.05)
        case "marker": mesh = .generateSphere(radius: 0.02)
        case "arrow":  mesh = .generateBox(width: 0.02, height: 0.02, depth: 0.12)
        case "text":   mesh = .generateText(obj.data.content ?? "", extrusionDepth: 0.005,
                                            font: .systemFont(ofSize: 0.05, weight: .bold))
        default:       mesh = .generateBox(size: 0.1, cornerRadius: 0.01) // cube + image placeholder
        }
        var material = PhysicallyBasedMaterial()
        material.baseColor = .init(tint: Self.color(from: obj.color))
        material.roughness = 0.35
        material.metallic = 0.1
        if selected { material.emissiveColor = .init(color: UIColor.white.withAlphaComponent(0.4)) }
        let entity = ModelEntity(mesh: mesh, materials: [material])
        entity.transform = RealityKit.Transform(matrix: obj.transform.matrix)
        entity.generateCollisionShapes(recursive: true)
        entity.name = obj.id
        return entity
    }

    private static func color(from hex: String) -> UIColor { UIColor(hexString: hex) }

    // ── Placement & hit-testing ───────────────────────────────────────────────

    /// Raycast from the screen centre onto detected geometry; returns the world
    /// transform to place a new object, or nil if nothing was hit.
    func placementTransform(count: Int) -> Transform? {
        let center = CGPoint(x: arView.bounds.midX, y: arView.bounds.midY)
        let results = arView.raycast(from: center, allowing: .estimatedPlane, alignment: .any)
        guard let first = results.first else { return nil }
        return Transform(matrix: first.worldTransform)
    }

    public func entityID(at point: CGPoint) -> String? {
        var entity = arView.entity(at: point)
        while let current = entity {
            if entities[current.name] != nil { return current.name }
            entity = current.parent
        }
        return nil
    }

    // ── ARSessionDelegate: publish camera pose for presence ────────────────────

    public func session(_ session: ARSession, didUpdate frame: ARFrame) {
        let now = frame.timestamp
        guard now - lastPoseSentAt > Self.poseInterval else { return }
        lastPoseSentAt = now
        let t = frame.camera.transform
        let pos = SIMD3(t.columns.3.x, t.columns.3.y, t.columns.3.z)
        var r = t
        r.columns.3 = SIMD4(0, 0, 0, 1)
        onCameraPose?(Vec3(pos), Quat(simd_quatf(r)))
    }
}
#endif
