package network.calimero.stream.media

import android.content.Context
import android.media.AudioManager
import android.util.Size
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import network.calimero.stream.app.CallModel
import network.calimero.stream.core.Encoding
import java.util.concurrent.Executors

/**
 * Wires the platform media to the call (the iOS `CallMedia`): CameraX → encoder → [CallModel],
 * microphone → [CallModel], and the model's decoded frames and audio to one decoder view and one
 * player per sender. Everything here runs on the main thread except the codecs' own threads.
 */
class CallMedia(
    private val context: Context,
    private val model: CallModel,
    private val scope: CoroutineScope,
) {
    private val _cameraOn = MutableStateFlow(false)
    val cameraOn: StateFlow<Boolean> = _cameraOn.asStateFlow()
    private val _frontCamera = MutableStateFlow(true)
    val frontCamera: StateFlow<Boolean> = _frontCamera.asStateFlow()

    private val main = ContextCompat.getMainExecutor(context)
    private val analysis = Executors.newSingleThreadExecutor()
    private val encoder = VideoEncoder { unit -> main.execute { send(unit) } }
    private val audio = AudioIO { samples, us -> main.execute { model.sendAudio(samples, us) } }
    private val decoders = HashMap<String, VideoDecoder>()
    private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var provider: ProcessCameraProvider? = null
    private var owner: LifecycleOwner? = null
    private var preview: PreviewView? = null
    private var applied: Encoding? = null
    private var watch: Job? = null

    fun attach() {
        model.onVideo = { author, frame -> decoder(author).enqueue(frame) }
        model.onAudio = { author, samples -> audio.play(author, samples) }
        model.onPeerGone = { author ->
            decoders.remove(author)?.release()
            audio.drop(author)
        }
        audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
        @Suppress("DEPRECATION")
        audioManager.isSpeakerphoneOn = true
        // Follow the shared budget as broadcasters come and go; stop the camera when the model
        // yields the slot.
        watch =
            scope.launch {
                combine(model.slots, model.isLive) { _, live -> live }.collect { live ->
                    if (_cameraOn.value && !live) stopCamera()
                    if (_cameraOn.value && model.encoding != applied) {
                        applied = model.encoding
                        encoder.configure(model.encoding)
                    }
                }
            }
    }

    fun detach() {
        watch?.cancel()
        stopCamera()
        audio.release()
        decoders.values.forEach { it.release() }
        decoders.clear()
        analysis.shutdown()
        audioManager.mode = AudioManager.MODE_NORMAL
        @Suppress("DEPRECATION")
        audioManager.isSpeakerphoneOn = false
    }

    /** The decoder (and its view) for a sender; made on first use. */
    fun decoder(author: String): VideoDecoder =
        decoders.getOrPut(author) {
            VideoDecoder(context) { main.execute { model.decoderFailed(author) } }
        }

    /** Where the local camera previews; set by the self tile while it is on screen. */
    fun bindPreview(
        view: PreviewView?,
        lifecycleOwner: LifecycleOwner,
    ) {
        preview = view
        owner = lifecycleOwner
        if (_cameraOn.value) bind()
    }

    // MARK: Controls (permissions already granted by the screen)

    fun toggleCamera(lifecycleOwner: LifecycleOwner) {
        if (_cameraOn.value) {
            stopCamera()
            model.stopLive()
            return
        }
        if (!model.goLive()) return
        owner = lifecycleOwner
        applied = model.encoding
        encoder.configure(model.encoding)
        encoder.requestKeyframe()
        _cameraOn.value = true
        bind()
    }

    fun toggleMic() {
        if (model.micOn.value) {
            model.setMic(false)
            audio.stopCapture()
            return
        }
        model.setMic(true)
        if (model.micOn.value) audio.startCapture()
    }

    fun flipCamera() {
        _frontCamera.value = !_frontCamera.value
        encoder.requestKeyframe()
        if (_cameraOn.value) bind()
    }

    // MARK: Internals

    private fun send(unit: EncodedUnit) {
        model.sendVideo(unit.bytes, unit.isKeyframe, unit.timestampUs, unit.width, unit.height, unit.codec)
        if (model.takeKeyframeRequest()) encoder.requestKeyframe()
    }

    private fun bind() {
        val lifecycleOwner = owner ?: return
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            val cameras = future.get()
            provider = cameras
            val selector = if (_frontCamera.value) CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA
            val resolution =
                ResolutionSelector
                    .Builder()
                    .setResolutionStrategy(ResolutionStrategy(Size(640, 480), ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER))
                    .build()
            // Upright (portrait 480x640 on a phone held normally) and not mirrored: what is sent
            // is what the room sees. The preview mirrors the front camera on its own.
            val frames =
                ImageAnalysis
                    .Builder()
                    .setResolutionSelector(resolution)
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
                    .setOutputImageRotationEnabled(true)
                    .build()
                    .also { it.setAnalyzer(analysis) { image -> encoder.encode(image) } }
            val shown = Preview.Builder().setResolutionSelector(resolution).build()
            preview?.let { shown.setSurfaceProvider(it.surfaceProvider) }
            cameras.unbindAll()
            runCatching { cameras.bindToLifecycle(lifecycleOwner, selector, shown, frames) }
        }, main)
    }

    private fun stopCamera() {
        if (!_cameraOn.value) return
        provider?.unbindAll()
        analysis.execute { encoder.close() }
        _cameraOn.value = false
    }
}
