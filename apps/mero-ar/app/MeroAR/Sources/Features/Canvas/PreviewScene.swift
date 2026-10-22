import SceneKit
import SwiftUI

#if canImport(UIKit)
import UIKit
typealias PlatformColor = UIColor
#else
import AppKit
typealias PlatformColor = NSColor
#endif

/// The shared room without a camera: the same scene graph on a lit floor grid,
/// orbited with a finger. Shown wherever world tracking isn't available (the
/// Simulator, a Mac, older devices) so the room can still be seen and edited.
@MainActor
final class PreviewScene: NSObject, ObservableObject, RoomCanvas {
    let scene = SCNScene()
    var onSelect: ((String?) -> Void)?
    var onMove: ((String, SIMD3<Float>) -> Void)?

    /// The shared room scan, when there is one, and its floor.
    private(set) var room: RoomModel?
    private(set) var bounds: FloorBounds?
    private(set) var isFloorPlan = false
    private let roomNode = SCNNode()
    private let gridFloor = SCNNode()
    private let orbitCamera = SCNNode()
    private let planCamera = SCNNode()
    /// The view showing this scene, to move its camera.
    weak var view: SCNView?

    private let root = SCNNode()
    private var nodes: [String: SCNNode] = [:]
    private var signatures: [String: String] = [:]
    /// Accessibility names of furniture and photos, which have no single geometry to name them by.
    private var labels: [String: String] = [:]
    private var overlays = SCNNode()
    private var spin: Float = 0

    override init() {
        super.init()
        scene.background.contents = PlatformColor.clear
        scene.rootNode.addChildNode(roomNode)
        scene.rootNode.addChildNode(root)
        scene.rootNode.addChildNode(overlays)
        buildStage()
    }

    // MARK: Stage

    private func buildStage() {
        let floor = SCNNode(geometry: SCNPlane(width: 8, height: 8))
        floor.eulerAngles.x = -.pi / 2
        let material = SCNMaterial()
        material.diffuse.contents = Self.gridImage()
        material.diffuse.wrapS = .repeat
        material.diffuse.wrapT = .repeat
        // 25 cm cells.
        material.diffuse.contentsTransform = SCNMatrix4MakeScale(32, 32, 1)
        material.diffuse.mipFilter = .linear
        material.lightingModel = .constant
        material.isDoubleSided = true
        floor.geometry?.materials = [material]
        gridFloor.addChildNode(floor)
        scene.rootNode.addChildNode(gridFloor)
        scene.fogStartDistance = 2.2
        scene.fogEndDistance = 5.5
        scene.fogColor = PlatformColor(red: 0.02, green: 0.02, blue: 0.04, alpha: 1)

        let ambient = SCNNode()
        ambient.light = SCNLight()
        ambient.light?.type = .ambient
        ambient.light?.intensity = 260
        ambient.light?.color = PlatformColor(red: 0.75, green: 0.75, blue: 1, alpha: 1)
        scene.rootNode.addChildNode(ambient)

        let key = SCNNode()
        key.light = SCNLight()
        key.light?.type = .directional
        key.light?.intensity = 520
        key.light?.castsShadow = true
        key.light?.shadowColor = PlatformColor.black.withAlphaComponent(0.45)
        key.eulerAngles = SCNVector3(-Float.pi / 3, Float.pi / 5, 0)
        scene.rootNode.addChildNode(key)

        let camera = orbitCamera
        camera.camera = SCNCamera()
        camera.camera?.fieldOfView = 55
        camera.camera?.wantsHDR = true
        camera.camera?.bloomIntensity = 0.15
        camera.camera?.bloomThreshold = 1.2
        camera.camera?.wantsExposureAdaptation = false
        camera.camera?.exposureOffset = -0.4
        camera.position = SCNVector3(0, 1.55, 1.75)
        camera.look(at: SCNVector3(0, 0.05, -0.35))
        camera.name = "camera"
        scene.rootNode.addChildNode(camera)

        planCamera.camera = SCNCamera()
        planCamera.camera?.usesOrthographicProjection = true
        planCamera.camera?.orthographicScale = 3
        planCamera.camera?.wantsHDR = true
        planCamera.camera?.wantsExposureAdaptation = false
        planCamera.camera?.exposureOffset = -0.4
        planCamera.eulerAngles = SCNVector3(-Float.pi / 2, 0, 0)
        planCamera.position = SCNVector3(0, 12, 0)
        planCamera.name = "planCamera"
        scene.rootNode.addChildNode(planCamera)
    }

    /// A glowing grid tile, drawn once.
    private static func gridImage() -> Any {
        #if canImport(UIKit)
        let size = CGSize(width: 128, height: 128)
        return UIGraphicsImageRenderer(size: size).image { ctx in
            UIColor(red: 0.03, green: 0.03, blue: 0.06, alpha: 1).setFill()
            ctx.fill(CGRect(origin: .zero, size: size))
            UIColor(red: 0.55, green: 0.45, blue: 1, alpha: 0.26).setStroke()
            let path = UIBezierPath(rect: CGRect(x: 0.5, y: 0.5, width: size.width - 1, height: size.height - 1))
            path.lineWidth = 1
            path.stroke()
        }
        #else
        return NSColor.darkGray
        #endif
    }

    // MARK: RoomCanvas

    func placementTransform(count: Int) -> Transform? {
        if let bounds {
            // In a scanned room: around the middle of the floor, inside the walls.
            let angle = Float(count) * 2.4
            let radius = 0.3 + 0.12 * Float(count % 5)
            let spot = bounds.clamp(
                SIMD3(bounds.centre.x + cos(angle) * radius, 0, bounds.centre.y + sin(angle) * radius), margin: 0.4)
            // Furniture scale: a room is metres across, not the 10 cm of a tabletop.
            var t = Transform.at(Vec3(Double(spot.x), 0, Double(spot.z)))
            t.scale = Vec3(3, 3, 3)
            return t
        }
        // Spread new objects on a spiral in front of the camera.
        let angle = Double(count) * 2.4
        let radius = 0.1 + 0.05 * Double(count % 6)
        return .at(Vec3(cos(angle) * radius, 0.06, -0.3 + sin(angle) * radius * 0.8))
    }

    func sync(objects: [SceneObject], selected: String?, presence: [Presence], comments: [SpatialComment], me: String) {
        let want = Set(objects.map(\.id))
        for (id, node) in nodes where !want.contains(id) {
            node.removeFromParentNode()
            nodes[id] = nil
            signatures[id] = nil
            labels[id] = nil
        }
        for object in objects {
            let signature = Self.signature(object, selected: object.id == selected)
            let node: SCNNode
            if let existing = nodes[object.id], signatures[object.id] == signature {
                node = existing
            } else {
                nodes[object.id]?.removeFromParentNode()
                node = Self.makeNode(for: object, selected: object.id == selected)
                if nodes[object.id] == nil {
                    // Pop in.
                    node.scale = SCNVector3(0.01, 0.01, 0.01)
                }
                nodes[object.id] = node
                signatures[object.id] = signature
                labels[object.id] = object.data.furnitureParts == nil ? nil : object.data.displayTitle
                root.addChildNode(node)
            }
            let t = object.transform
            SCNTransaction.begin()
            SCNTransaction.animationDuration = 0.35
            node.simdPosition = t.position.simd
            node.simdOrientation = t.rotation.simd
            node.simdScale = t.scale.simd
            SCNTransaction.commit()
        }
        drawOverlays(presence: presence.filter { $0.member != me }, comments: comments)
    }

    private func drawOverlays(presence: [Presence], comments: [SpatialComment]) {
        overlays.childNodes.forEach { $0.removeFromParentNode() }
        for viewer in presence {
            let orb = SCNNode(geometry: SCNSphere(radius: 0.035))
            let material = SCNMaterial()
            material.emission.contents = PlatformColor(red: 0.13, green: 0.83, blue: 0.93, alpha: 1)
            material.diffuse.contents = PlatformColor(red: 0.13, green: 0.83, blue: 0.93, alpha: 1)
            orb.geometry?.materials = [material]
            orb.simdPosition = viewer.cameraPosition.simd
            let cone = SCNNode(geometry: SCNCone(topRadius: 0, bottomRadius: 0.05, height: 0.12))
            cone.geometry?.firstMaterial?.diffuse.contents = PlatformColor(red: 0.13, green: 0.83, blue: 0.93, alpha: 0.25)
            cone.eulerAngles.x = -.pi / 2
            cone.position = SCNVector3(0, 0, -0.07)
            orb.addChildNode(cone)
            orb.simdOrientation = viewer.cameraRotation.simd
            overlays.addChildNode(orb)
        }
        for comment in comments {
            let pin = SCNNode(geometry: SCNSphere(radius: 0.022))
            pin.geometry?.firstMaterial?.emission.contents = PlatformColor(red: 0.96, green: 0.45, blue: 0.71, alpha: 1)
            pin.simdPosition = comment.position.simd + SIMD3(0, 0.12, 0)
            let stem = SCNNode(geometry: SCNCylinder(radius: 0.003, height: 0.1))
            stem.geometry?.firstMaterial?.diffuse.contents = PlatformColor.white.withAlphaComponent(0.5)
            stem.position = SCNVector3(0, -0.05, 0)
            pin.addChildNode(stem)
            overlays.addChildNode(pin)
        }
    }

    /// What a node is drawn from: a change in any of it rebuilds the node.
    static func signature(_ object: SceneObject, selected: Bool) -> String {
        var loaded = false
        #if canImport(UIKit)
        if let blob = object.data.blobId { loaded = PictureCache.shared.image(for: blob) != nil }
        #endif
        return "\(object.data.kind)|\(object.data.item ?? "")|\(object.color)|\(object.data.content ?? "")|\(selected)|\(loaded)"
    }

    /// A furniture piece or a framed photo, built from its catalogue parts.
    static func makeFurnitureNode(for object: SceneObject, parts: [FurniturePart], selected: Bool) -> SCNNode {
        let node = SCNNode()
        node.name = object.id
        var photo: Any?
        #if canImport(UIKit)
        if let blob = object.data.blobId { photo = PictureCache.shared.image(for: blob) }
        #endif
        for part in parts {
            let s = part.size
            let geometry: SCNGeometry
            switch part.shape {
            case .box:
                geometry = SCNBox(
                    width: CGFloat(s.x), height: CGFloat(s.y), length: CGFloat(s.z),
                    chamferRadius: CGFloat(min(0.02, min(s.x, s.y, s.z) * 0.2)))
            case .cylinder: geometry = SCNCylinder(radius: CGFloat(s.x / 2), height: CGFloat(s.y))
            case .sphere: geometry = SCNSphere(radius: CGFloat(s.x / 2))
            }
            let material = SCNMaterial()
            material.lightingModel = .physicallyBased
            material.diffuse.contents = PlatformColor(hexString: part.role.hex ?? object.color)
            material.roughness.contents = part.role == .screen ? 0.15 : 0.7
            material.metalness.contents = 0.0
            if part.role == .art, let photo {
                material.diffuse.contents = photo
                material.lightingModel = .constant
            }
            if part.role == .screen {
                material.emission.contents = PlatformColor(red: 0.08, green: 0.1, blue: 0.2, alpha: 1)
            }
            if selected, part.role == .primary {
                material.emission.contents = PlatformColor(hexString: object.color).withAlphaComponent(0.35)
            }
            geometry.materials = [material]
            let child = SCNNode(geometry: geometry)
            child.simdPosition = part.centre
            node.addChildNode(child)
        }
        if selected {
            let footprint = parts.reduce(Float(0.1)) { max($0, abs($1.centre.x) + $1.size.x / 2, abs($1.centre.z) + $1.size.z / 2) }
            let ring = SCNNode(geometry: SCNTorus(ringRadius: CGFloat(footprint * 1.08), pipeRadius: 0.01))
            ring.geometry?.firstMaterial?.emission.contents = PlatformColor.white
            ring.geometry?.firstMaterial?.diffuse.contents = PlatformColor.white
            ring.position.y = 0.004
            node.addChildNode(ring)
        }
        return node
    }

    static func makeNode(for object: SceneObject, selected: Bool) -> SCNNode {
        if let parts = object.data.furnitureParts {
            return makeFurnitureNode(for: object, parts: parts, selected: selected)
        }
        let geometry: SCNGeometry
        switch object.data.kind {
        case "sphere": geometry = SCNSphere(radius: 0.06)
        case "marker":
            geometry = SCNCone(topRadius: 0, bottomRadius: 0.035, height: 0.09)
        case "arrow": geometry = SCNPyramid(width: 0.06, height: 0.12, length: 0.06)
        case "text":
            let text = SCNText(string: object.data.content ?? "", extrusionDepth: 0.6)
            text.font = .systemFont(ofSize: 4, weight: .bold)
            text.flatness = 0.2
            geometry = text
        default: geometry = SCNBox(width: 0.1, height: 0.1, length: 0.1, chamferRadius: 0.012)
        }
        let material = SCNMaterial()
        material.lightingModel = .physicallyBased
        material.diffuse.contents = PlatformColor(hexString: object.color)
        material.roughness.contents = 0.35
        material.metalness.contents = 0.15
        material.emission.contents = selected ? PlatformColor(hexString: object.color).withAlphaComponent(0.35) : PlatformColor.black
        geometry.materials = [material]
        let shape = SCNNode(geometry: geometry)
        if object.data.kind == "text" {
            shape.scale = SCNVector3(0.012, 0.012, 0.012)
            let (lo, hi) = shape.boundingBox
            shape.pivot = SCNMatrix4MakeTranslation((hi.x - lo.x) / 2 + lo.x, 0, 0)
        } else if object.data.kind != "marker" {
            shape.position.y = object.data.kind == "sphere" ? 0.06 : 0.05
        }
        let node = SCNNode()
        node.addChildNode(shape)
        node.name = object.id
        if selected {
            let ring = SCNNode(geometry: SCNTorus(ringRadius: 0.09, pipeRadius: 0.004))
            ring.geometry?.firstMaterial?.emission.contents = PlatformColor.white
            ring.geometry?.firstMaterial?.diffuse.contents = PlatformColor.white
            ring.position.y = 0.002
            node.addChildNode(ring)
        }
        return node
    }

    // MARK: The room

    func showRoom(_ model: RoomModel?) {
        guard model != room else { return }
        room = model
        roomNode.childNodes.forEach { $0.removeFromParentNode() }
        guard let model else {
            bounds = nil
            gridFloor.opacity = 1
            // Fog fades the endless grid; a room is framed whole instead.
            scene.fogStartDistance = 2.2
            scene.fogEndDistance = 5.5
            frameCamera()
            return
        }
        let b = model.floorBounds
        bounds = b
        gridFloor.opacity = 0.35
        scene.fogStartDistance = 0
        scene.fogEndDistance = 0
        Self.buildRoom(model, bounds: b).forEach { roomNode.addChildNode($0) }
        frameCamera()
    }

    func setFloorPlan(_ on: Bool) {
        isFloorPlan = on
        frameCamera()
    }

    /// Point the cameras at the room (or the default stage) and pick one.
    private func frameCamera() {
        let centre = bounds.map { SCNVector3($0.centre.x, 0, $0.centre.y) } ?? SCNVector3(0, 0.05, -0.35)
        let span = bounds.map { max($0.width, $0.length) } ?? 1.6
        if bounds != nil {
            // High and steep enough to see over the near wall into the room.
            orbitCamera.position = SCNVector3(centre.x + span * 0.15, span * 1.65 + 1, centre.z + span * 1.05)
        } else {
            orbitCamera.position = SCNVector3(0, 1.55, 1.75)
        }
        orbitCamera.look(at: centre)
        planCamera.position = SCNVector3(centre.x, 12, centre.z)
        let aspect = Float((view?.bounds.width ?? 390) / max(view?.bounds.height ?? 844, 1))
        // Half the visible height; wide enough for the room's width on a portrait screen.
        let halfWidth = (bounds?.width ?? 2) / 2 + 0.5
        let halfLength = (bounds?.length ?? 2) / 2 + 0.5
        planCamera.camera?.orthographicScale = Double(max(halfLength, halfWidth / max(aspect, 0.1)))
        guard let view else { return }
        SCNTransaction.begin()
        SCNTransaction.animationDuration = 0.6
        view.pointOfView = isFloorPlan ? planCamera : orbitCamera
        SCNTransaction.commit()
        view.allowsCameraControl = !isFloorPlan
        view.defaultCameraController.target = centre
    }

    /// The room as geometry: floor, walls, door frames, windows, furniture.
    static func buildRoom(_ model: RoomModel, bounds b: FloorBounds) -> [SCNNode] {
        var nodes: [SCNNode] = []
        let floor = SCNNode(geometry: SCNBox(width: CGFloat(b.width), height: 0.02, length: CGFloat(b.length), chamferRadius: 0))
        floor.geometry?.firstMaterial = material(PlatformColor(red: 0.16, green: 0.15, blue: 0.24, alpha: 1), roughness: 0.9)
        floor.position = SCNVector3(b.centre.x, -0.011, b.centre.y)
        nodes.append(floor)

        let wallColor = PlatformColor(red: 0.86, green: 0.86, blue: 0.95, alpha: 1)
        for wall in model.walls {
            let d = wall.dimensions
            guard d.count == 3 else { continue }
            let slab = SCNNode(geometry: SCNBox(width: CGFloat(d[0]), height: CGFloat(d[1]), length: 0.06, chamferRadius: 0.01))
            let m = material(wallColor, roughness: 0.6)
            // See-through, so furniture behind a wall stays visible from any side.
            m.transparency = 0.38
            m.writesToDepthBuffer = false
            slab.geometry?.firstMaterial = m
            slab.simdTransform = RoomModel.matrix(wall.transform)
            // A bright edge along the top so the room reads from above.
            let edge = SCNNode(geometry: SCNBox(width: CGFloat(d[0]), height: 0.015, length: 0.07, chamferRadius: 0))
            edge.geometry?.firstMaterial = glow(PlatformColor(red: 0.65, green: 0.71, blue: 0.99, alpha: 1))
            edge.position = SCNVector3(0, d[1] / 2, 0)
            slab.addChildNode(edge)
            nodes.append(slab)
        }
        for door in model.doors + model.openings {
            nodes.append(frame(door, color: PlatformColor(red: 0.13, green: 0.83, blue: 0.93, alpha: 1)))
        }
        for window in model.windows {
            let node = frame(window, color: PlatformColor(red: 0.38, green: 0.65, blue: 0.98, alpha: 1))
            let d = window.dimensions
            let glass = SCNNode(geometry: SCNBox(width: CGFloat(d[0]), height: CGFloat(d[1]), length: 0.02, chamferRadius: 0))
            let m = material(PlatformColor(red: 0.55, green: 0.8, blue: 1, alpha: 1), roughness: 0.1)
            m.transparency = 0.35
            glass.geometry?.firstMaterial = m
            node.addChildNode(glass)
            nodes.append(node)
        }
        for item in model.objects {
            let d = item.dimensions
            guard d.count == 3 else { continue }
            let box = SCNNode(
                geometry: SCNBox(
                    width: CGFloat(d[0]), height: CGFloat(d[1]), length: CGFloat(max(d[2], 0.04)),
                    chamferRadius: CGFloat(min(0.08, min(d[0], d[1], max(d[2], 0.04)) * 0.25))))
            box.geometry?.firstMaterial = material(furnitureColor(item.category), roughness: 0.7)
            box.simdTransform = RoomModel.matrix(item.transform)
            box.addChildNode(label(item.category.capitalized, above: d[1] / 2 + 0.12))
            nodes.append(box)
        }
        return nodes
    }

    private static func frame(_ surface: RoomModel.Surface, color: PlatformColor) -> SCNNode {
        let d = surface.dimensions
        let node = SCNNode()
        node.simdTransform = RoomModel.matrix(surface.transform)
        guard d.count == 3 else { return node }
        let w = CGFloat(d[0]), h = CGFloat(d[1]), t: CGFloat = 0.05
        for (size, pos) in [
            ((w, t), SCNVector3(0, Float(h / 2), 0)), ((w, t), SCNVector3(0, -Float(h / 2), 0)),
            ((t, h), SCNVector3(-Float(w / 2), 0, 0)), ((t, h), SCNVector3(Float(w / 2), 0, 0)),
        ] {
            let bar = SCNNode(geometry: SCNBox(width: size.0, height: size.1, length: 0.1, chamferRadius: 0.01))
            bar.geometry?.firstMaterial = glow(color)
            bar.position = pos
            node.addChildNode(bar)
        }
        return node
    }

    private static func label(_ text: String, above y: Float) -> SCNNode {
        let geometry = SCNText(string: text, extrusionDepth: 0)
        geometry.font = .systemFont(ofSize: 3, weight: .semibold)
        geometry.flatness = 0.2
        geometry.firstMaterial = glow(.white)
        let node = SCNNode(geometry: geometry)
        node.scale = SCNVector3(0.03, 0.03, 0.03)
        let (lo, hi) = node.boundingBox
        node.pivot = SCNMatrix4MakeTranslation((hi.x - lo.x) / 2 + lo.x, 0, 0)
        node.position = SCNVector3(0, y, 0)
        node.constraints = [SCNBillboardConstraint()]
        return node
    }

    private static func furnitureColor(_ category: String) -> PlatformColor {
        switch category {
        case "sofa", "chair", "bed": return PlatformColor(red: 0.6, green: 0.55, blue: 0.85, alpha: 1)
        case "table": return PlatformColor(red: 0.75, green: 0.62, blue: 0.5, alpha: 1)
        case "television": return PlatformColor(red: 0.2, green: 0.2, blue: 0.26, alpha: 1)
        default: return PlatformColor(red: 0.62, green: 0.66, blue: 0.75, alpha: 1)
        }
    }

    private static func material(_ color: PlatformColor, roughness: CGFloat) -> SCNMaterial {
        let m = SCNMaterial()
        m.lightingModel = .physicallyBased
        m.diffuse.contents = color
        m.roughness.contents = roughness
        m.metalness.contents = 0.0
        return m
    }

    private static func glow(_ color: PlatformColor) -> SCNMaterial {
        let m = SCNMaterial()
        m.lightingModel = .constant
        m.diffuse.contents = color
        return m
    }

    /// Where a screen point hits the floor (y = `height`), or nil.
    func floorPoint(in view: SCNView, at point: CGPoint, height: Float = 0) -> SIMD3<Float>? {
        let near = view.unprojectPoint(SCNVector3(Float(point.x), Float(point.y), 0))
        let far = view.unprojectPoint(SCNVector3(Float(point.x), Float(point.y), 1))
        let a = SIMD3<Float>(near.x, near.y, near.z)
        let dir = SIMD3<Float>(far.x, far.y, far.z) - a
        guard abs(dir.y) > 1e-5 else { return nil }
        let t = (height - a.y) / dir.y
        guard t > 0 else { return nil }
        return a + dir * t
    }

    /// Move an object's node while it is dragged (the store commits on release).
    func drag(_ id: String, to point: SIMD3<Float>) -> SIMD3<Float>? {
        guard let node = nodes[id] else { return nil }
        let target = bounds?.clamp(point, margin: 0.15, floorY: node.simdPosition.y)
            ?? SIMD3(point.x, node.simdPosition.y, point.z)
        node.simdPosition = target
        return target
    }

    /// Each placed object's screen position, for accessibility (VoiceOver and
    /// UI tests): its id, a label and a touch-sized frame around its centre.
    func accessibleObjects(in view: SCNView) -> [(id: String, label: String, frame: CGRect)] {
        nodes.compactMap { id, node in
            let p = view.projectPoint(node.presentation.worldPosition)
            guard p.z > 0, p.z < 1 else { return nil }
            let kind = labels[id] ?? node.childNodes.first?.geometry.map { Self.kindName(of: $0) } ?? "Object"
            return (id, kind, CGRect(x: CGFloat(p.x) - 22, y: CGFloat(p.y) - 22, width: 44, height: 44))
        }
        .sorted { $0.id < $1.id }
    }

    private static func kindName(of geometry: SCNGeometry) -> String {
        switch geometry {
        case is SCNSphere: return "Sphere"
        case is SCNBox: return "Cube"
        case is SCNCone: return "Marker"
        case is SCNPyramid: return "Arrow"
        case is SCNText: return "Label"
        default: return "Object"
        }
    }

    /// The object under a touch, or the nearest one within a finger's reach:
    /// a 30 cm cube is only a few dozen points across on a floor plan.
    func objectID(near point: CGPoint, in view: SCNView, reach: CGFloat = 36) -> String? {
        if let hit = objectID(in: view, at: point) { return hit }
        return accessibleObjects(in: view)
            .map { ($0.id, hypot($0.frame.midX - point.x, $0.frame.midY - point.y)) }
            .filter { $0.1 <= reach }
            .min { $0.1 < $1.1 }?.0
    }

    /// The object id under a tap, or nil for empty space.
    func objectID(in view: SCNView, at point: CGPoint) -> String? {
        for hit in view.hitTest(point, options: [.searchMode: SCNHitTestSearchMode.all.rawValue]) {
            var node: SCNNode? = hit.node
            while let current = node {
                if let name = current.name, nodes[name] != nil { return name }
                node = current.parent
            }
        }
        return nil
    }
}

extension PlatformColor {
    convenience init(hexString: String) {
        var s = hexString.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        let v = s.count == 6 ? UInt32(s, radix: 16) ?? 0x8B5CF6 : 0x8B5CF6
        self.init(
            red: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255,
            blue: CGFloat(v & 0xFF) / 255, alpha: 1)
    }
}

#if canImport(UIKit)
/// An SCNView that lists the room's placed objects to accessibility, each at
/// its projected position, so VoiceOver can find them and a UI test can drag
/// one.
final class SceneCanvasView: SCNView {
    weak var canvas: PreviewScene?

    override var accessibilityElements: [Any]? {
        get {
            guard let canvas else { return nil }
            return canvas.accessibleObjects(in: self).map { item in
                let element = UIAccessibilityElement(accessibilityContainer: self)
                element.accessibilityLabel = "\(item.label), placed object"
                element.accessibilityIdentifier = "sceneObject-\(item.id)"
                element.accessibilityFrameInContainerSpace = item.frame
                element.accessibilityTraits = [.button]
                return element
            }
        }
        set {}
    }
}

/// The preview's view: orbit with a finger, tap to select.
struct PreviewSceneView: UIViewRepresentable {
    let scene: PreviewScene

    func makeUIView(context: Context) -> SCNView {
        let view = SceneCanvasView()
        view.canvas = scene
        view.scene = scene.scene
        view.backgroundColor = .clear
        view.allowsCameraControl = true
        view.defaultCameraController.interactionMode = .orbitTurntable
        view.defaultCameraController.target = SCNVector3(0, 0.05, -0.35)
        view.defaultCameraController.inertiaEnabled = true
        view.pointOfView = scene.scene.rootNode.childNode(withName: "camera", recursively: false)
        view.antialiasingMode = .multisampling4X
        view.rendersContinuously = true
        view.accessibilityIdentifier = "previewCanvas"
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tapped(_:)))
        view.addGestureRecognizer(tap)
        // Drag an object along the floor; a drag that starts on empty space
        // falls through to the camera.
        let pan = UIPanGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.panned(_:)))
        pan.maximumNumberOfTouches = 1
        pan.delegate = context.coordinator
        view.addGestureRecognizer(pan)
        context.coordinator.view = view
        scene.view = view
        scene.setFloorPlan(scene.isFloorPlan)
        return view
    }

    func updateUIView(_ uiView: SCNView, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(scene: scene) }

    @MainActor
    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        let scene: PreviewScene
        weak var view: SCNView?
        private var dragging: String?
        private var lastPoint: SIMD3<Float>?
        init(scene: PreviewScene) { self.scene = scene }

        /// Where the current touch went down: a pan is recognised only after
        /// the finger has moved, by which point it may have left the object.
        private var touchDown: CGPoint?

        @objc func tapped(_ gesture: UITapGestureRecognizer) {
            guard let view else { return }
            scene.onSelect?(scene.objectID(near: gesture.location(in: view), in: view))
        }

        nonisolated func gestureRecognizer(_ gesture: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            MainActor.assumeIsolated {
                if let view { touchDown = touch.location(in: view) }
                return true
            }
        }

        /// Only a pan that starts on an object drags it.
        nonisolated func gestureRecognizerShouldBegin(_ gesture: UIGestureRecognizer) -> Bool {
            MainActor.assumeIsolated {
                guard let view, gesture is UIPanGestureRecognizer else { return true }
                return scene.objectID(near: touchDown ?? gesture.location(in: view), in: view) != nil
            }
        }

        @objc func panned(_ gesture: UIPanGestureRecognizer) {
            guard let view else { return }
            let point = gesture.location(in: view)
            switch gesture.state {
            case .began:
                dragging = scene.objectID(near: touchDown ?? point, in: view)
                view.allowsCameraControl = false
                if let id = dragging { scene.onSelect?(id) }
            case .changed:
                guard let id = dragging, let hit = scene.floorPoint(in: view, at: point) else { return }
                lastPoint = scene.drag(id, to: hit)
            case .ended, .cancelled, .failed:
                if let id = dragging, let final = lastPoint { scene.onMove?(id, final) }
                dragging = nil
                lastPoint = nil
                view.allowsCameraControl = !scene.isFloorPlan
            default:
                break
            }
        }
    }
}
#endif
