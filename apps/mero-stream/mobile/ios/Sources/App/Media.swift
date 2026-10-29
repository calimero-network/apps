import AVFoundation
import StreamCore
import UIKit
import VideoToolbox

// The platform half of the call: camera, H.264 encode and decode, and audio.
// Everything that decides what goes on the wire is in StreamCore.

// MARK: - Permissions

enum MediaPermission {
    /// Ask for camera or microphone access if it was never asked; true when granted.
    static func request(_ type: AVMediaType) async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: type) {
        case .authorized: return true
        case .notDetermined: return await AVCaptureDevice.requestAccess(for: type)
        default: return false
        }
    }

    static func denied(_ type: AVMediaType) -> Bool {
        let status = AVCaptureDevice.authorizationStatus(for: type)
        return status == .denied || status == .restricted
    }
}

// MARK: - Camera

/// The camera, as portrait VGA (480×640) NV12 frames. Not mirrored: what is
/// sent is what the room sees; the preview layer mirrors the front camera.
final class CameraCapture: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, @unchecked Sendable {
    let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "network.calimero.stream.camera")
    private let output = AVCaptureVideoDataOutput()
    private var input: AVCaptureDeviceInput?
    private(set) var position: AVCaptureDevice.Position = .front
    /// Called on the capture queue for every frame.
    var onFrame: ((CVPixelBuffer, CMTime) -> Void)?

    override init() {
        super.init()
        output.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
        ]
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(self, queue: queue)
    }

    func start(fps: Int) {
        queue.async { [self] in
            session.beginConfiguration()
            if session.canSetSessionPreset(.vga640x480) { session.sessionPreset = .vga640x480 }
            if session.outputs.isEmpty, session.canAddOutput(output) { session.addOutput(output) }
            attach(position)
            session.commitConfiguration()
            setFrameRate(fps)
            if !session.isRunning { session.startRunning() }
        }
    }

    func stop() {
        queue.async { [self] in if session.isRunning { session.stopRunning() } }
    }

    func flip() {
        queue.async { [self] in
            position = position == .front ? .back : .front
            session.beginConfiguration()
            attach(position)
            session.commitConfiguration()
        }
    }

    func setFrameRate(_ fps: Int) {
        guard let device = input?.device, fps > 0 else { return }
        let supported = device.activeFormat.videoSupportedFrameRateRanges.contains {
            $0.minFrameRate <= Double(fps) && Double(fps) <= $0.maxFrameRate
        }
        guard supported, (try? device.lockForConfiguration()) != nil else { return }
        device.activeVideoMinFrameDuration = CMTime(value: 1, timescale: CMTimeScale(fps))
        device.activeVideoMaxFrameDuration = CMTime(value: 1, timescale: CMTimeScale(fps))
        device.unlockForConfiguration()
    }

    private func attach(_ position: AVCaptureDevice.Position) {
        if let input { session.removeInput(input) }
        guard
            let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position),
            let next = try? AVCaptureDeviceInput(device: device), session.canAddInput(next)
        else { return }
        session.addInput(next)
        input = next
        if let connection = output.connection(with: .video) {
            if connection.isVideoOrientationSupported { connection.videoOrientation = .portrait }
            if connection.isVideoMirroringSupported {
                connection.automaticallyAdjustsVideoMirroring = false
                connection.isVideoMirrored = false
            }
        }
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        onFrame?(pixels, CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
    }
}

// MARK: - H.264 encode

/// One encoded access unit, Annex-B, as the web's WebCodecs encoder emits them.
struct EncodedUnit: Sendable {
    let bytes: [UInt8]
    let isKeyframe: Bool
    let timestampUs: UInt64
    let width: Int
    let height: Int
    let codec: String
}

/// VideoToolbox H.264, Baseline 3.1, real time, no B-frames. Its AVCC output
/// is rewritten as Annex-B with the SPS and PPS in front of every keyframe,
/// which is exactly what the web's `avc: { format: "annexb" }` produces, so a
/// browser decodes a phone with no out-of-band description.
final class VideoEncoder: @unchecked Sendable {
    private var session: VTCompressionSession?
    private var width = 0
    private var height = 0
    private var encoding = Encoding(fps: 15, bitrate: 1_000_000)
    private var lastFrameAt: CMTime = .invalid
    private let lock = NSLock()
    private var forceKeyframe = true
    private var codec = "avc1.42001f"
    var onUnit: ((EncodedUnit) -> Void)?

    func requestKeyframe() { lock.withLock { forceKeyframe = true } }

    func configure(_ next: Encoding) {
        lock.withLock {
            guard next != encoding else { return }
            encoding = next
            if let session { apply(session) }
        }
    }

    func encode(_ pixels: CVPixelBuffer, at time: CMTime) {
        let w = CVPixelBufferGetWidth(pixels)
        let h = CVPixelBufferGetHeight(pixels)
        let (fps, force): (Int, Bool) = lock.withLock {
            let force = forceKeyframe
            forceKeyframe = false
            return (encoding.fps, force)
        }
        // Pace to the shared frame rate even if the camera runs faster.
        if !force, lastFrameAt.isValid, CMTimeGetSeconds(CMTimeSubtract(time, lastFrameAt)) < 0.9 / Double(max(1, fps)) {
            return
        }
        lastFrameAt = time
        if session == nil || w != width || h != height { makeSession(width: w, height: h) }
        guard let session else { return }
        let properties = force ? [kVTEncodeFrameOptionKey_ForceKeyFrame: kCFBooleanTrue] as CFDictionary : nil
        VTCompressionSessionEncodeFrame(
            session, imageBuffer: pixels, presentationTimeStamp: time, duration: .invalid,
            frameProperties: properties, infoFlagsOut: nil
        ) { [weak self] status, _, sample in
            guard status == noErr, let sample, let self else { return }
            self.emit(sample)
        }
    }

    func close() {
        if let session {
            VTCompressionSessionCompleteFrames(session, untilPresentationTimeStamp: .invalid)
            VTCompressionSessionInvalidate(session)
        }
        session = nil
        lastFrameAt = .invalid
        requestKeyframe()
    }

    private func makeSession(width w: Int, height h: Int) {
        close()
        var made: VTCompressionSession?
        VTCompressionSessionCreate(
            allocator: nil, width: Int32(w), height: Int32(h), codecType: kCMVideoCodecType_H264,
            encoderSpecification: nil, imageBufferAttributes: nil, compressedDataAllocator: nil,
            outputCallback: nil, refcon: nil, compressionSessionOut: &made)
        guard let made else { return }
        VTSessionSetProperty(made, key: kVTCompressionPropertyKey_RealTime, value: kCFBooleanTrue)
        VTSessionSetProperty(made, key: kVTCompressionPropertyKey_ProfileLevel, value: kVTProfileLevel_H264_Baseline_3_1)
        VTSessionSetProperty(made, key: kVTCompressionPropertyKey_AllowFrameReordering, value: kCFBooleanFalse)
        VTSessionSetProperty(
            made, key: kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration,
            value: NSNumber(value: Double(CallModel.keyframeIntervalMs) / 1000))
        lock.withLock { apply(made) }
        VTCompressionSessionPrepareToEncodeFrames(made)
        session = made
        width = w
        height = h
    }

    private func apply(_ session: VTCompressionSession) {
        VTSessionSetProperty(session, key: kVTCompressionPropertyKey_AverageBitRate, value: NSNumber(value: encoding.bitrate))
        VTSessionSetProperty(session, key: kVTCompressionPropertyKey_ExpectedFrameRate, value: NSNumber(value: encoding.fps))
    }

    private func emit(_ sample: CMSampleBuffer) {
        guard let block = CMSampleBufferGetDataBuffer(sample) else { return }
        let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[CFString: Any]]
        let notSync = attachments?.first?[kCMSampleAttachmentKey_NotSync] as? Bool ?? false
        let isKeyframe = !notSync

        var length = 0
        var pointer: UnsafeMutablePointer<CChar>?
        guard CMBlockBufferGetDataPointer(block, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &pointer) == noErr,
            let pointer
        else { return }
        let avcc = [UInt8](UnsafeBufferPointer(start: UnsafeRawPointer(pointer).assumingMemoryBound(to: UInt8.self), count: length))
        var units = AnnexB.unitsFromAVCC(avcc)
        if isKeyframe, let format = CMSampleBufferGetFormatDescription(sample) {
            let sets = Self.parameterSets(format)
            units = sets + units
            if let sps = sets.first, let string = AnnexB.codecString(sps: sps) { codec = string }
        }
        let pts = CMSampleBufferGetPresentationTimeStamp(sample)
        let us = pts.isValid ? UInt64(max(0, CMTimeGetSeconds(pts) * 1_000_000)) : 0
        onUnit?(
            EncodedUnit(
                bytes: AnnexB.stream(units), isKeyframe: isKeyframe, timestampUs: us, width: width, height: height,
                codec: codec))
    }

    private static func parameterSets(_ format: CMFormatDescription) -> [[UInt8]] {
        var count = 0
        CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
            format, parameterSetIndex: 0, parameterSetPointerOut: nil, parameterSetSizeOut: nil,
            parameterSetCountOut: &count, nalUnitHeaderLengthOut: nil)
        var sets: [[UInt8]] = []
        for index in 0..<count {
            var pointer: UnsafePointer<UInt8>?
            var size = 0
            CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
                format, parameterSetIndex: index, parameterSetPointerOut: &pointer, parameterSetSizeOut: &size,
                parameterSetCountOut: nil, nalUnitHeaderLengthOut: nil)
            if let pointer { sets.append([UInt8](UnsafeBufferPointer(start: pointer, count: size))) }
        }
        return sets
    }
}

// MARK: - H.264 decode

/// One sender's picture: Annex-B access units in, decoded and shown by
/// `AVSampleBufferDisplayLayer` (which runs VideoToolbox itself).
final class VideoDecoderView: UIView {
    override class var layerClass: AnyClass { AVSampleBufferDisplayLayer.self }
    private var displayLayer: AVSampleBufferDisplayLayer { layer as! AVSampleBufferDisplayLayer }
    private var format: CMVideoFormatDescription?
    private var parameterSets: [[UInt8]] = []
    /// The stream could not be decoded: the call waits for the next keyframe.
    var onFailure: (() -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        displayLayer.videoGravity = .resizeAspectFill
        backgroundColor = .black
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    func setFill(_ fill: Bool) { displayLayer.videoGravity = fill ? .resizeAspectFill : .resizeAspect }

    func enqueue(_ frame: LiveFrame) {
        let units = AnnexB.units(frame.bytes)
        let sps = units.first { AnnexB.type(of: $0) == AnnexB.NALType.sps.rawValue }
        let pps = units.first { AnnexB.type(of: $0) == AnnexB.NALType.pps.rawValue }
        if let sps, let pps, [sps, pps] != parameterSets {
            parameterSets = [sps, pps]
            format = Self.makeFormat(sps: sps, pps: pps)
        }
        let slices = units.filter {
            let type = AnnexB.type(of: $0)
            return type != AnnexB.NALType.sps.rawValue && type != AnnexB.NALType.pps.rawValue
                && type != AnnexB.NALType.aud.rawValue
        }
        guard let format, !slices.isEmpty, let sample = Self.makeSample(AnnexB.avcc(slices), format: format) else { return }
        if displayLayer.status == .failed {
            displayLayer.flush()
            onFailure?()
            return
        }
        displayLayer.enqueue(sample)
    }

    func reset() {
        displayLayer.flushAndRemoveImage()
        format = nil
        parameterSets = []
    }

    private static func makeFormat(sps: [UInt8], pps: [UInt8]) -> CMVideoFormatDescription? {
        var format: CMVideoFormatDescription?
        sps.withUnsafeBufferPointer { spsPointer in
            pps.withUnsafeBufferPointer { ppsPointer in
                let pointers = [spsPointer.baseAddress!, ppsPointer.baseAddress!]
                let sizes = [sps.count, pps.count]
                _ = CMVideoFormatDescriptionCreateFromH264ParameterSets(
                    allocator: nil, parameterSetCount: 2, parameterSetPointers: pointers, parameterSetSizes: sizes,
                    nalUnitHeaderLength: 4, formatDescriptionOut: &format)
            }
        }
        return format
    }

    private static func makeSample(_ avcc: [UInt8], format: CMVideoFormatDescription) -> CMSampleBuffer? {
        var block: CMBlockBuffer?
        guard
            CMBlockBufferCreateWithMemoryBlock(
                allocator: nil, memoryBlock: nil, blockLength: avcc.count, blockAllocator: nil, customBlockSource: nil,
                offsetToData: 0, dataLength: avcc.count, flags: 0, blockBufferOut: &block) == noErr,
            let block
        else { return nil }
        avcc.withUnsafeBytes { raw in
            _ = CMBlockBufferReplaceDataBytes(with: raw.baseAddress!, blockBuffer: block, offsetIntoDestination: 0, dataLength: avcc.count)
        }
        var sample: CMSampleBuffer?
        var size = avcc.count
        guard
            CMSampleBufferCreateReady(
                allocator: nil, dataBuffer: block, formatDescription: format, sampleCount: 1, sampleTimingEntryCount: 0,
                sampleTimingArray: nil, sampleSizeEntryCount: 1, sampleSizeArray: &size, sampleBufferOut: &sample) == noErr,
            let sample
        else { return nil }
        if let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: true),
            CFArrayGetCount(attachments) > 0
        {
            let dict = unsafeBitCast(CFArrayGetValueAtIndex(attachments, 0), to: CFMutableDictionary.self)
            CFDictionarySetValue(
                dict, Unmanaged.passUnretained(kCMSampleAttachmentKey_DisplayImmediately).toOpaque(),
                Unmanaged.passUnretained(kCFBooleanTrue).toOpaque())
        }
        return sample
    }
}

// MARK: - Audio

/// The microphone as 8 kHz mono 16-bit packets of ``Mulaw/packetSamples``,
/// and one player per remote speaker. Voice processing (echo cancellation)
/// is on while the mic is, since the call plays through the speaker.
final class AudioIO: @unchecked Sendable {
    private let engine = AVAudioEngine()
    private let lock = NSLock()
    private var players: [String: AVAudioPlayerNode] = [:]
    private var converter: AVAudioConverter?
    private var pending: [Int16] = []
    private var sentSamples: UInt64 = 0
    private var capturing = false
    private let playFormat = AVAudioFormat(
        commonFormat: .pcmFormatFloat32, sampleRate: Double(Mulaw.sampleRate), channels: 1, interleaved: false)!
    private let sendFormat = AVAudioFormat(
        commonFormat: .pcmFormatInt16, sampleRate: Double(Mulaw.sampleRate), channels: 1, interleaved: true)!
    /// A full packet of microphone samples and its media time.
    var onPacket: (([Int16], UInt64) -> Void)?

    func activate() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playAndRecord, mode: .videoChat, options: [.defaultToSpeaker, .allowBluetooth])
        try? session.setActive(true)
        startEngine()
    }

    func deactivate() {
        setCapturing(false)
        engine.stop()
        lock.withLock {
            for player in players.values { engine.detach(player) }
            players.removeAll()
        }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    func setCapturing(_ on: Bool) {
        guard on != capturing else { return }
        capturing = on
        engine.stop()
        let input = engine.inputNode
        if on {
            try? input.setVoiceProcessingEnabled(true)
            let format = input.outputFormat(forBus: 0)
            converter = AVAudioConverter(from: format, to: sendFormat)
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
                self?.convert(buffer)
            }
        } else {
            input.removeTap(onBus: 0)
            try? input.setVoiceProcessingEnabled(false)
            converter = nil
            pending.removeAll()
        }
        startEngine()
    }

    func play(_ author: String, _ samples: [Int16]) {
        guard let buffer = AVAudioPCMBuffer(pcmFormat: playFormat, frameCapacity: AVAudioFrameCount(samples.count)) else {
            return
        }
        buffer.frameLength = AVAudioFrameCount(samples.count)
        if let channel = buffer.floatChannelData?[0] {
            for (i, sample) in samples.enumerated() { channel[i] = Float(sample) / 32_768 }
        }
        let player: AVAudioPlayerNode = lock.withLock {
            if let existing = players[author] { return existing }
            let made = AVAudioPlayerNode()
            engine.attach(made)
            engine.connect(made, to: engine.mainMixerNode, format: playFormat)
            players[author] = made
            return made
        }
        if !engine.isRunning { startEngine() }
        player.scheduleBuffer(buffer)
        if !player.isPlaying { player.play() }
    }

    func drop(_ author: String) {
        lock.withLock {
            if let player = players.removeValue(forKey: author) {
                player.stop()
                engine.detach(player)
            }
        }
    }

    private func startEngine() {
        engine.prepare()
        try? engine.start()
    }

    private func convert(_ buffer: AVAudioPCMBuffer) {
        guard let converter else { return }
        let ratio = sendFormat.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 16
        guard let out = AVAudioPCMBuffer(pcmFormat: sendFormat, frameCapacity: capacity) else { return }
        var fed = false
        var error: NSError?
        converter.convert(to: out, error: &error) { _, status in
            if fed {
                status.pointee = .noDataNow
                return nil
            }
            fed = true
            status.pointee = .haveData
            return buffer
        }
        guard error == nil, let data = out.int16ChannelData?[0] else { return }
        pending += UnsafeBufferPointer(start: data, count: Int(out.frameLength))
        while pending.count >= Mulaw.packetSamples {
            let packet = Array(pending.prefix(Mulaw.packetSamples))
            pending.removeFirst(Mulaw.packetSamples)
            let us = sentSamples * 1_000_000 / UInt64(Mulaw.sampleRate)
            sentSamples += UInt64(Mulaw.packetSamples)
            onPacket?(packet, us)
        }
    }
}
