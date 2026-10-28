import AVFoundation
import Combine
import StreamCore
import UIKit

/// Wires the platform media to the call: camera → encoder → ``CallModel``,
/// microphone → ``CallModel``, and the model's decoded frames and audio to
/// one decoder view and one player per sender.
@MainActor
final class CallMedia: ObservableObject {
    enum Blocked: Identifiable {
        case camera, microphone
        var id: Self { self }
    }

    @Published var blocked: Blocked?
    @Published private(set) var cameraOn = false
    @Published private(set) var usingFrontCamera = true

    let camera = CameraCapture()
    private let encoder = VideoEncoder()
    private let audio = AudioIO()
    private var decoders: [String: VideoDecoderView] = [:]
    private var watch: AnyCancellable?
    private var applied: Encoding?
    private weak var model: CallModel?

    func attach(_ model: CallModel) {
        self.model = model
        model.onVideo = { [weak self] author, frame in self?.decoder(for: author).enqueue(frame) }
        model.onAudio = { [weak self] author, samples in self?.audio.play(author, samples) }
        model.onPeerGone = { [weak self] author in
            self?.decoders.removeValue(forKey: author)?.reset()
            self?.audio.drop(author)
        }
        encoder.onUnit = { [weak self] unit in
            Task { @MainActor in self?.send(unit) }
        }
        camera.onFrame = { [encoder] pixels, time in encoder.encode(pixels, at: time) }
        audio.onPacket = { [weak model] samples, us in
            Task { @MainActor in model?.sendAudio(samples, timestampUs: us) }
        }
        // Follow the shared budget as broadcasters come and go; stop the
        // camera when the model yields the slot.
        watch = model.objectWillChange.sink { [weak self] in
            Task { @MainActor in self?.follow() }
        }
        audio.activate()
        UIApplication.shared.isIdleTimerDisabled = true
    }

    func detach() {
        stopCamera()
        audio.setCapturing(false)
        audio.deactivate()
        watch = nil
        decoders.values.forEach { $0.reset() }
        decoders.removeAll()
        UIApplication.shared.isIdleTimerDisabled = false
    }

    /// The view a sender's frames are drawn into; made on first use.
    func decoder(for author: String) -> VideoDecoderView {
        if let view = decoders[author] { return view }
        let view = VideoDecoderView()
        view.onFailure = { [weak self] in self?.model?.decoderFailed(author) }
        decoders[author] = view
        return view
    }

    // MARK: Controls

    func toggleCamera() async {
        guard let model else { return }
        if cameraOn {
            stopCamera()
            model.stopLive()
            return
        }
        guard await MediaPermission.request(.video) else {
            blocked = .camera
            return
        }
        guard model.goLive() else { return }
        applied = model.encoding
        encoder.configure(model.encoding)
        encoder.requestKeyframe()
        camera.start(fps: model.encoding.fps)
        cameraOn = true
    }

    func toggleMic() async {
        guard let model else { return }
        if model.micOn {
            model.setMic(false)
            audio.setCapturing(false)
            return
        }
        guard await MediaPermission.request(.audio) else {
            blocked = .microphone
            return
        }
        model.setMic(true)
        if model.micOn { audio.setCapturing(true) }
    }

    func flipCamera() {
        camera.flip()
        usingFrontCamera.toggle()
        encoder.requestKeyframe()
    }

    // MARK: Internals

    private func send(_ unit: EncodedUnit) {
        guard let model else { return }
        model.sendVideo(
            unit.bytes, isKeyframe: unit.isKeyframe, timestampUs: unit.timestampUs, width: unit.width,
            height: unit.height, codec: unit.codec)
        if model.takeKeyframeRequest() { encoder.requestKeyframe() }
    }

    private func follow() {
        guard let model else { return }
        if cameraOn, !model.isLive { stopCamera() }
        if cameraOn, model.encoding != applied {
            applied = model.encoding
            encoder.configure(model.encoding)
            camera.setFrameRate(model.encoding.fps)
        }
    }

    private func stopCamera() {
        guard cameraOn else { return }
        camera.stop()
        encoder.close()
        cameraOn = false
    }
}
