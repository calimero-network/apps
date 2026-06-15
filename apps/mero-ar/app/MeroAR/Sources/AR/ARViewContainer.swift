#if canImport(ARKit)
import SwiftUI
import RealityKit

/// Bridges the ARSessionManager's RealityKit `ARView` into SwiftUI, and forwards
/// taps to the manager for entity selection.
public struct ARViewContainer: UIViewRepresentable {
    public let manager: ARSessionManager

    public init(manager: ARSessionManager) { self.manager = manager }

    public func makeUIView(context: Context) -> ARView {
        let view = manager.arView
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleTap(_:)))
        view.addGestureRecognizer(tap)
        return view
    }

    public func updateUIView(_ uiView: ARView, context: Context) {}

    public func makeCoordinator() -> Coordinator { Coordinator(manager: manager) }

    @MainActor
    public final class Coordinator: NSObject {
        let manager: ARSessionManager
        init(manager: ARSessionManager) { self.manager = manager }

        @objc func handleTap(_ gr: UITapGestureRecognizer) {
            let point = gr.location(in: manager.arView)
            if let id = manager.entityID(at: point) {
                manager.onSelect?(id)
            }
        }
    }
}
#endif
