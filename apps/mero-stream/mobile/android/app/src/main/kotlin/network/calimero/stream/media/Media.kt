package network.calimero.stream.media

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.SurfaceTexture
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.view.Surface
import android.view.TextureView
import androidx.camera.core.ImageProxy
import network.calimero.stream.core.AnnexB
import network.calimero.stream.core.Encoding
import network.calimero.stream.core.LiveFrame
import network.calimero.stream.core.Mulaw
import java.nio.ByteBuffer

// The platform half of the call: H.264 encode and decode, and audio. Everything that decides what
// goes on the wire is in core/ and CallModel. The camera itself is CameraX (CallMedia.kt).

/** One encoded access unit, Annex-B, as the web's WebCodecs encoder emits them. */
class EncodedUnit(
    val bytes: ByteArray,
    val isKeyframe: Boolean,
    val timestampUs: Long,
    val width: Int,
    val height: Int,
    val codec: String,
)

/**
 * MediaCodec H.264, Baseline 3.1, from CameraX frames (YUV_420_888, already rotated upright).
 * MediaCodec writes Annex-B but hands the SPS and PPS over once, as a codec-config buffer; they are
 * put back in front of every keyframe, which is what the web's `avc: { format: "annexb" }`
 * produces, so a browser decodes a phone with no out-of-band description.
 */
class VideoEncoder(
    private val onUnit: (EncodedUnit) -> Unit,
) {
    private var codec: MediaCodec? = null
    private var width = 0
    private var height = 0
    private var encoding = Encoding(15, 1_000_000)
    private var parameterSets = ByteArray(0)
    private var codecString = "avc1.42001f"
    private var lastFrameNs = 0L
    private val info = MediaCodec.BufferInfo()

    @Volatile private var forceKeyframe = true

    fun requestKeyframe() {
        forceKeyframe = true
    }

    @Synchronized
    fun configure(next: Encoding) {
        if (next == encoding) return
        encoding = next
        codec?.setParameters(Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_VIDEO_BITRATE, next.bitrate) })
    }

    /** Encode one camera frame; called on the camera's analysis thread. Closes [image]. */
    @Synchronized
    fun encode(image: ImageProxy) {
        image.use {
            val now = image.imageInfo.timestamp
            val force = forceKeyframe
            // Pace to the shared frame rate even if the camera runs faster.
            if (!force && lastFrameNs != 0L && now - lastFrameNs < 900_000_000L / maxOf(1, encoding.fps)) return
            lastFrameNs = now
            if (codec == null || image.width != width || image.height != height) start(image.width, image.height)
            val codec = codec ?: return
            if (force) {
                forceKeyframe = false
                codec.setParameters(Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0) })
            }
            val index = codec.dequeueInputBuffer(INPUT_TIMEOUT_US)
            if (index >= 0) {
                val input = codec.getInputImage(index)
                if (input != null) {
                    copyPlanes(image, input)
                    codec.queueInputBuffer(index, 0, width * height * 3 / 2, now / 1000, 0)
                } else {
                    codec.queueInputBuffer(index, 0, 0, now / 1000, 0)
                }
            }
            drain(codec)
        }
    }

    @Synchronized
    fun close() {
        codec?.let {
            runCatching { it.stop() }
            it.release()
        }
        codec = null
        lastFrameNs = 0
        parameterSets = ByteArray(0)
        forceKeyframe = true
    }

    private fun start(
        w: Int,
        h: Int,
    ) {
        close()
        val format =
            MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, w, h).apply {
                setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
                setInteger(MediaFormat.KEY_BIT_RATE, encoding.bitrate)
                setInteger(MediaFormat.KEY_FRAME_RATE, encoding.fps)
                setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 2)
                setInteger(MediaFormat.KEY_PROFILE, MediaCodecInfo.CodecProfileLevel.AVCProfileBaseline)
                setInteger(MediaFormat.KEY_LEVEL, MediaCodecInfo.CodecProfileLevel.AVCLevel31)
                setInteger(MediaFormat.KEY_LATENCY, 0)
                setInteger(MediaFormat.KEY_PRIORITY, 0)
            }
        val made = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        made.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        made.start()
        codec = made
        width = w
        height = h
    }

    @Suppress("NestedBlockDepth")
    private fun drain(codec: MediaCodec) {
        while (true) {
            val index = codec.dequeueOutputBuffer(info, 0)
            if (index < 0) return
            val buffer = codec.getOutputBuffer(index)
            val bytes = ByteArray(info.size)
            buffer?.position(info.offset)
            buffer?.get(bytes, 0, info.size)
            val flags = info.flags
            val pts = info.presentationTimeUs
            codec.releaseOutputBuffer(index, false)
            if (flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) {
                parameterSets = bytes
                AnnexB.parameterSets(bytes)?.first?.let { sps -> AnnexB.codecString(sps)?.let { codecString = it } }
                continue
            }
            val key = flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0
            val unit = if (key && AnnexB.parameterSets(bytes) == null) parameterSets + bytes else bytes
            onUnit(EncodedUnit(unit, key, pts, width, height, codecString))
        }
    }

    /** Copy a YUV_420_888 frame into the codec's input image, honouring both sides' strides. */
    private fun copyPlanes(
        from: ImageProxy,
        to: android.media.Image,
    ) {
        for (plane in 0 until 3) {
            val src = from.planes[plane]
            val dst = to.planes[plane]
            val planeWidth = if (plane == 0) from.width else from.width / 2
            val planeHeight = if (plane == 0) from.height else from.height / 2
            copyPlane(src.buffer, src.rowStride, src.pixelStride, dst.buffer, dst.rowStride, dst.pixelStride, planeWidth, planeHeight)
        }
    }

    @Suppress("LongParameterList")
    private fun copyPlane(
        src: ByteBuffer,
        srcRow: Int,
        srcPixel: Int,
        dst: ByteBuffer,
        dstRow: Int,
        dstPixel: Int,
        w: Int,
        h: Int,
    ) {
        for (y in 0 until h) {
            for (x in 0 until w) {
                val s = y * srcRow + x * srcPixel
                val d = y * dstRow + x * dstPixel
                if (s < src.limit() && d < dst.limit()) dst.put(d, src.get(s))
            }
        }
    }

    private companion object {
        const val INPUT_TIMEOUT_US = 10_000L
    }
}

/**
 * One sender's picture: Annex-B access units in, MediaCodec decoding straight onto a
 * [TextureView]'s surface. The codec is made on the first keyframe once the surface exists,
 * configured from that keyframe's own SPS and PPS; decoding runs on its own thread.
 */
class VideoDecoder(
    context: Context,
    /** The stream could not be decoded: the call waits for the next keyframe. */
    private val onFailure: () -> Unit,
) : TextureView.SurfaceTextureListener {
    val view: TextureView = TextureView(context).also { it.surfaceTextureListener = this }
    private val thread = HandlerThread("decoder").also { it.start() }
    private val handler = Handler(thread.looper)
    private var surface: Surface? = null
    private var codec: MediaCodec? = null
    private val info = MediaCodec.BufferInfo()

    fun enqueue(frame: LiveFrame) {
        handler.post { decode(frame) }
    }

    fun release() {
        handler.post {
            closeCodec()
            surface?.release()
            surface = null
        }
        thread.quitSafely()
    }

    private fun decode(frame: LiveFrame) {
        val target = surface ?: return
        try {
            if (codec == null) {
                val sets = (if (frame.isKeyframe) AnnexB.parameterSets(frame.bytes) else null) ?: return
                val format =
                    MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, maxOf(16, frame.width), maxOf(16, frame.height)).apply {
                        setByteBuffer("csd-0", ByteBuffer.wrap(AnnexB.START_CODE + sets.first))
                        setByteBuffer("csd-1", ByteBuffer.wrap(AnnexB.START_CODE + sets.second))
                        setInteger(MediaFormat.KEY_LOW_LATENCY, 1)
                    }
                codec =
                    MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_VIDEO_AVC).also {
                        it.configure(format, target, null, 0)
                        it.start()
                    }
            }
            val codec = codec ?: return
            val index = codec.dequeueInputBuffer(INPUT_TIMEOUT_US)
            if (index >= 0) {
                val input = codec.getInputBuffer(index) ?: return
                input.clear()
                input.put(frame.bytes, 0, minOf(frame.bytes.size, input.capacity()))
                codec.queueInputBuffer(index, 0, minOf(frame.bytes.size, input.capacity()), frame.timestampUs, 0)
            }
            while (true) {
                val out = codec.dequeueOutputBuffer(info, 0)
                if (out < 0) break
                codec.releaseOutputBuffer(out, true)
            }
        } catch (e: IllegalStateException) {
            closeCodec()
            onFailure()
        }
    }

    private fun closeCodec() {
        codec?.let {
            runCatching { it.stop() }
            it.release()
        }
        codec = null
    }

    override fun onSurfaceTextureAvailable(
        texture: SurfaceTexture,
        width: Int,
        height: Int,
    ) {
        handler.post {
            surface = Surface(texture)
            // A fresh surface needs a fresh keyframe.
            onFailure()
        }
    }

    override fun onSurfaceTextureSizeChanged(
        texture: SurfaceTexture,
        width: Int,
        height: Int,
    ) = Unit

    override fun onSurfaceTextureDestroyed(texture: SurfaceTexture): Boolean {
        handler.post {
            closeCodec()
            surface?.release()
            surface = null
        }
        return true
    }

    override fun onSurfaceTextureUpdated(texture: SurfaceTexture) = Unit

    private companion object {
        const val INPUT_TIMEOUT_US = 10_000L
    }
}

/**
 * The microphone as 8 kHz mono 16-bit packets of [Mulaw.PACKET_SAMPLES] (echo cancelled where the
 * device has it), and one player per remote speaker.
 */
class AudioIO(
    private val onPacket: (ShortArray, Long) -> Unit,
) {
    private var record: AudioRecord? = null
    private var echo: AcousticEchoCanceler? = null
    private var reader: Thread? = null
    private val players = HashMap<String, AudioTrack>()

    @Volatile private var capturing = false

    /** Start the microphone. Call only once RECORD_AUDIO is granted. */
    @SuppressLint("MissingPermission")
    fun startCapture() {
        if (capturing) return
        val min = AudioRecord.getMinBufferSize(Mulaw.SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val made =
            AudioRecord(
                MediaRecorder.AudioSource.VOICE_COMMUNICATION,
                Mulaw.SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                maxOf(min, Mulaw.PACKET_SAMPLES * 4),
            )
        if (made.state != AudioRecord.STATE_INITIALIZED) {
            made.release()
            return
        }
        if (AcousticEchoCanceler.isAvailable()) echo = AcousticEchoCanceler.create(made.audioSessionId)?.also { it.enabled = true }
        record = made
        capturing = true
        made.startRecording()
        reader =
            Thread {
                var sent = 0L
                while (capturing) {
                    val packet = ShortArray(Mulaw.PACKET_SAMPLES)
                    var filled = 0
                    while (capturing && filled < packet.size) {
                        val read = made.read(packet, filled, packet.size - filled)
                        if (read <= 0) break
                        filled += read
                    }
                    if (filled == packet.size) {
                        onPacket(packet, sent * 1_000_000L / Mulaw.SAMPLE_RATE)
                        sent += packet.size
                    }
                }
            }.also { it.start() }
    }

    fun stopCapture() {
        capturing = false
        reader?.join(500)
        reader = null
        record?.let {
            runCatching { it.stop() }
            it.release()
        }
        record = null
        echo?.release()
        echo = null
    }

    fun play(
        author: String,
        samples: ShortArray,
    ) {
        val track =
            players.getOrPut(author) {
                AudioTrack
                    .Builder()
                    .setAudioAttributes(
                        AudioAttributes
                            .Builder()
                            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build(),
                    ).setAudioFormat(
                        AudioFormat
                            .Builder()
                            .setSampleRate(Mulaw.SAMPLE_RATE)
                            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .build(),
                    ).setBufferSizeInBytes(Mulaw.PACKET_SAMPLES * 2 * 4)
                    .setTransferMode(AudioTrack.MODE_STREAM)
                    .build()
                    .also { it.play() }
            }
        track.write(samples, 0, samples.size, AudioTrack.WRITE_NON_BLOCKING)
    }

    fun drop(author: String) {
        players.remove(author)?.let {
            runCatching { it.stop() }
            it.release()
        }
    }

    fun release() {
        stopCapture()
        for (author in players.keys.toList()) drop(author)
    }
}
