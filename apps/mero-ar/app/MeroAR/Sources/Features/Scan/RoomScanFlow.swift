import SwiftUI

#if canImport(RoomPlan) && os(iOS)
import RoomPlan
#endif

/// Whether this device can scan a room: RoomPlan needs LiDAR (iPhone 12 Pro
/// and later Pro models, LiDAR iPads). Never in the Simulator.
enum RoomScanSupport {
    static var isSupported: Bool {
        #if canImport(RoomPlan) && os(iOS) && !targetEnvironment(simulator)
        return RoomCaptureSession.isSupported
        #else
        return false
        #endif
    }

    static let unsupportedReason =
        "Scanning a room needs a LiDAR iPhone or iPad (iPhone 12 Pro or later Pro models). You can still view and edit a room someone else scanned, or try the sample room."
}

#if canImport(RoomPlan) && os(iOS)
extension RoomModel {
    /// The shared model of a finished RoomPlan scan.
    init(captured room: CapturedRoom) {
        func surface(_ s: CapturedRoom.Surface) -> Surface {
            var category: String?
            if case .door(let isOpen) = s.category { category = isOpen ? "doorOpen" : "door" }
            return Surface(
                id: s.identifier.uuidString,
                dimensions: [s.dimensions.x, s.dimensions.y, s.dimensions.z],
                transform: RoomModel.values(s.transform), category: category)
        }
        self.init(
            sample: false,
            walls: room.walls.map(surface), doors: room.doors.map(surface), windows: room.windows.map(surface),
            openings: room.openings.map(surface),
            objects: room.objects.map {
                Item(
                    id: $0.identifier.uuidString, category: String(describing: $0.category),
                    dimensions: [$0.dimensions.x, $0.dimensions.y, $0.dimensions.z],
                    transform: RoomModel.values($0.transform))
            })
    }
}

/// Scan → review → share, full screen.
struct RoomScanFlow: View {
    @ObservedObject var store: SceneStore
    @Environment(\.dismiss) private var dismiss
    @StateObject private var capture = RoomCaptureController()
    @State private var reviewing: (model: RoomModel, usdz: Data?)?

    var body: some View {
        ZStack {
            if let reviewing {
                ScanReview(store: store, model: reviewing.model, usdz: reviewing.usdz) {
                    self.reviewing = nil
                    capture.start()
                } done: {
                    dismiss()
                }
            } else {
                RoomCaptureContainer(controller: capture).ignoresSafeArea()
                captureChrome
            }
        }
        .preferredColorScheme(.dark)
        .onAppear { capture.start() }
        .onDisappear { capture.stop() }
        .onChange(of: capture.result?.model) { _, _ in
            if let result = capture.result { reviewing = (result.model, result.usdz) }
        }
    }

    private var captureChrome: some View {
        VStack(spacing: 14) {
            HStack {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                }
                .buttonStyle(CircleButtonStyle())
                .accessibilityLabel("Cancel scan")
                Spacer()
                Pill(text: "Scanning", tone: .accent, dot: true)
            }
            .padding(.horizontal, Theme.gutter)
            ARChip {
                Label(capture.instruction, systemImage: "viewfinder").multilineTextAlignment(.leading)
            }
            .animation(.easeOut(duration: 0.2), value: capture.instruction)
            Spacer()
            if capture.isProcessing {
                ARChip { Label("Building your room…", systemImage: "cube.transparent") }
            }
            Button {
                Haptics.tap()
                capture.finish()
            } label: {
                ButtonLabel(title: "Done", icon: "checkmark", isLoading: capture.isProcessing)
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(capture.isProcessing)
            .padding(.horizontal, Theme.gutter)
            if let error = capture.error {
                Callout(tone: .danger, message: error).padding(.horizontal, Theme.gutter)
            }
        }
        .padding(.vertical, 12)
    }
}

/// Runs a RoomCaptureView and turns its result into a `RoomModel` plus USDZ.
@MainActor
final class RoomCaptureController: NSObject, ObservableObject {
    @Published var instruction = "Point your iPhone at a wall and move slowly around the room"
    @Published var isProcessing = false
    @Published var error: String?
    @Published var result: (model: RoomModel, usdz: Data?)?

    lazy var view: RoomCaptureView = {
        let view = RoomCaptureView(frame: .zero)
        view.delegate = delegate
        view.captureSession.delegate = delegate
        return view
    }()

    private lazy var delegate = Delegate(owner: self)

    func start() {
        result = nil
        error = nil
        isProcessing = false
        view.captureSession.run(configuration: RoomCaptureSession.Configuration())
    }

    func finish() {
        isProcessing = true
        view.captureSession.stop()
    }

    func stop() { view.captureSession.stop() }

    fileprivate func processed(_ room: CapturedRoom?, _ failure: Error?) {
        isProcessing = false
        guard let room else {
            error = failure.map { "The scan couldn't be finished: \($0.localizedDescription)" } ?? "The scan couldn't be finished."
            return
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("room-\(UUID().uuidString).usdz")
        try? room.export(to: url, exportOptions: .parametric)
        let usdz = try? Data(contentsOf: url)
        try? FileManager.default.removeItem(at: url)
        result = (RoomModel(captured: room), usdz)
    }

    fileprivate func coach(_ text: String) { instruction = text }

    /// RoomPlan's delegates (the view's must be NSCoding).
    @objc(MeroARRoomCaptureDelegate)
    final class Delegate: NSObject, RoomCaptureViewDelegate, RoomCaptureSessionDelegate, NSCoding {
        weak var owner: RoomCaptureController?

        init(owner: RoomCaptureController) { self.owner = owner }
        required init?(coder: NSCoder) { nil }
        func encode(with coder: NSCoder) {}

        func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool { true }

        func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
            Task { @MainActor in owner?.processed(processedResult, error) }
        }

        func captureSession(_ session: RoomCaptureSession, didProvide instruction: RoomCaptureSession.Instruction) {
            let text: String
            switch instruction {
            case .moveCloseToWall: text = "Move closer to the wall"
            case .moveAwayFromWall: text = "Move a little away from the wall"
            case .slowDown: text = "Slow down"
            case .turnOnLight: text = "Turn on more light"
            case .lowTexture: text = "Aim at something with more detail"
            case .normal: text = "Keep going: walk around the room's edges"
            @unknown default: text = "Keep scanning"
            }
            Task { @MainActor in owner?.coach(text) }
        }
    }
}

private struct RoomCaptureContainer: UIViewRepresentable {
    let controller: RoomCaptureController
    func makeUIView(context: Context) -> RoomCaptureView { controller.view }
    func updateUIView(_ uiView: RoomCaptureView, context: Context) {}
}
#endif

/// The finished room: a 3D look, its size, and Share with the room.
struct ScanReview: View {
    @ObservedObject var store: SceneStore
    let model: RoomModel
    let usdz: Data?
    let retake: () -> Void
    let done: () -> Void
    @StateObject private var preview = PreviewScene()

    var body: some View {
        ZStack(alignment: .bottom) {
            SpatialBackground(animated: false)
            PreviewSceneView(scene: preview).ignoresSafeArea()
            VStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Your room").font(Theme.display(28)).foregroundStyle(Theme.text)
                    Text(
                        String(format: "%.1f × %.1f m · %d walls · %d doors and windows · %d pieces of furniture",
                               model.width, model.length, model.walls.count,
                               model.doors.count + model.windows.count, model.objects.count)
                    )
                    .font(.system(size: 14)).foregroundStyle(Theme.textDim)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                HStack(spacing: 12) {
                    Button(action: retake) { ButtonLabel(title: "Retake", icon: "arrow.counterclockwise") }
                        .buttonStyle(GlassButtonStyle())
                    Button {
                        Haptics.tap()
                        Task {
                            if await store.publishRoomScan(model, usdz: usdz) {
                                Haptics.success()
                                done()
                            }
                        }
                    } label: {
                        ButtonLabel(title: "Share with the room", icon: "square.and.arrow.up", isLoading: store.isPublishingScan)
                    }
                    .buttonStyle(PrimaryButtonStyle(height: 50))
                }
            }
            .padding(20)
            .glass(cornerRadius: Theme.Radius.dock, strong: true)
            .padding(Theme.gutter)
        }
        .preferredColorScheme(.dark)
        .onAppear { preview.showRoom(model) }
    }
}
