package network.calimero.stream.core

/**
 * The web app's media framing on ephemeral presence, byte for byte: a port of
 * `app/src/lib/ephemeralFrames.ts` (header v2), identical to the iOS `LiveFrames`. A phone and a
 * browser in the same room read each other's slices because both sides write exactly this.
 *
 * Header, little-endian: magic "MS" (2) · version 2 (1) · track (1, 0 video / 1 audio) · flags (1,
 * bit0 keyframe) · msgSeq u32 · fragIndex (1) · fragCount (1) · width u16 · height u16 ·
 * timestampUs u64 · createdAtMs u64 · startedAtMs u64 · codecLen (1) · codec ASCII · payload.
 *
 * `src/test/resources/frame-vectors.json` holds slices the web's own `encodeFragments` produced; the
 * tests check this encoder writes them exactly.
 */
object LiveFrames {
    /** `EPHEMERAL_MAX_BYTES` in core: one presence slice. */
    const val MAX_SLICE_BYTES = 16_384
    const val VERSION = 2
    const val HEADER_FIXED_BYTES = 40
    const val MAX_FRAGMENTS = 255
    private const val MAGIC_0 = 0x4D
    private const val MAGIC_1 = 0x53
    private const val FLAG_KEYFRAME = 0x01
    private const val U32 = 0x1_0000_0000L

    /** Payload bytes one fragment carries for [codec]. */
    fun maxPayloadBytes(codec: String): Int = MAX_SLICE_BYTES - HEADER_FIXED_BYTES - codec.length

    /** Split one frame into presence-sized slices. A zero-byte frame is still one slice. */
    fun encodeFragments(frame: LiveFrame): List<ByteArray> {
        require(frame.codec.all { it.code < 0x80 }) { "codec string must be ASCII: ${frame.codec}" }
        val codec = frame.codec.toByteArray(Charsets.US_ASCII)
        val capacity = MAX_SLICE_BYTES - HEADER_FIXED_BYTES - codec.size
        require(capacity > 0 && codec.size <= 255) { "codec string leaves no room for payload" }
        val count = maxOf(1, (frame.bytes.size + capacity - 1) / capacity)
        require(count <= MAX_FRAGMENTS) { "frame of ${frame.bytes.size} bytes needs $count fragments" }
        return List(count) { index ->
            val start = index * capacity
            val end = minOf(frame.bytes.size, start + capacity)
            val payload = if (start < end) end - start else 0
            val buf = ByteArray(HEADER_FIXED_BYTES + codec.size + payload)
            buf[0] = MAGIC_0.toByte()
            buf[1] = MAGIC_1.toByte()
            buf[2] = VERSION.toByte()
            buf[3] = frame.track.toByte()
            buf[4] = (if (frame.isKeyframe) FLAG_KEYFRAME else 0).toByte()
            buf.putLE(5, frame.msgSeq % U32, 4)
            buf[9] = index.toByte()
            buf[10] = count.toByte()
            buf.putLE(11, frame.width.toLong(), 2)
            buf.putLE(13, frame.height.toLong(), 2)
            buf.putLE(15, maxOf(0L, frame.timestampUs), 8)
            buf.putLE(23, maxOf(0L, frame.createdAtMs), 8)
            buf.putLE(31, maxOf(0L, frame.startedAtMs), 8)
            buf[39] = codec.size.toByte()
            codec.copyInto(buf, HEADER_FIXED_BYTES)
            if (payload > 0) frame.bytes.copyInto(buf, HEADER_FIXED_BYTES + codec.size, start, end)
            buf
        }
    }

    /**
     * Parse one slice, or null when it is not ours (presence is shared with whatever else publishes
     * in the context, so a foreign slice is a silent no-op).
     */
    fun decodeFragment(slice: ByteArray): FrameFragment? {
        if (slice.size < HEADER_FIXED_BYTES) return null
        if (slice.u8(0) != MAGIC_0 || slice.u8(1) != MAGIC_1 || slice.u8(2) != VERSION) return null
        val codecLen = slice.u8(39)
        val payloadStart = HEADER_FIXED_BYTES + codecLen
        if (slice.size < payloadStart) return null
        val fragCount = slice.u8(10)
        val fragIndex = slice.u8(9)
        if (fragCount == 0 || fragIndex >= fragCount) return null
        return FrameFragment(
            msgSeq = slice.getLE(5, 4),
            track = slice.u8(3),
            isKeyframe = slice.u8(4) and FLAG_KEYFRAME != 0,
            width = slice.getLE(11, 2).toInt(),
            height = slice.getLE(13, 2).toInt(),
            timestampUs = slice.getLE(15, 8),
            createdAtMs = slice.getLE(23, 8),
            startedAtMs = slice.getLE(31, 8),
            codec = String(slice, HEADER_FIXED_BYTES, codecLen, Charsets.ISO_8859_1),
            fragIndex = fragIndex,
            fragCount = fragCount,
            payload = slice.copyOfRange(payloadStart, slice.size),
        )
    }

    /** The next per-sender frame counter, wrapping at the header's u32. */
    fun nextMsgSeq(current: Long): Long = (current + 1) % U32

    private fun ByteArray.u8(at: Int): Int = this[at].toInt() and 0xFF

    private fun ByteArray.putLE(
        at: Int,
        value: Long,
        size: Int,
    ) {
        for (i in 0 until size) this[at + i] = (value ushr (8 * i)).toByte()
    }

    private fun ByteArray.getLE(
        at: Int,
        size: Int,
    ): Long {
        var value = 0L
        for (i in 0 until size) value = value or ((this[at + i].toLong() and 0xFF) shl (8 * i))
        return value
    }
}

/** One encoded frame (a video access unit, or an audio packet). The header's fields, one for one. */
@Suppress("LongParameterList")
class LiveFrame(
    /** Per-sender frame counter, a u32. */
    val msgSeq: Long,
    /** 0 = video, 1 = audio. */
    val track: Int,
    val isKeyframe: Boolean,
    val width: Int,
    val height: Int,
    val timestampUs: Long,
    /** Sender wall clock, unix ms. */
    val createdAtMs: Long,
    /** When this sender began its current broadcast, unix ms. */
    val startedAtMs: Long,
    val codec: String,
    val bytes: ByteArray,
) {
    override fun equals(other: Any?): Boolean =
        other is LiveFrame &&
            msgSeq == other.msgSeq &&
            track == other.track &&
            isKeyframe == other.isKeyframe &&
            width == other.width &&
            height == other.height &&
            timestampUs == other.timestampUs &&
            createdAtMs == other.createdAtMs &&
            startedAtMs == other.startedAtMs &&
            codec == other.codec &&
            bytes.contentEquals(other.bytes)

    override fun hashCode(): Int = (msgSeq.hashCode() * 31 + track) * 31 + bytes.contentHashCode()

    override fun toString(): String = "LiveFrame(msgSeq=$msgSeq, track=$track, key=$isKeyframe, ${bytes.size} bytes, $codec)"
}

/** A parsed slice: the frame header plus this fragment's bytes. */
@Suppress("LongParameterList")
class FrameFragment(
    val msgSeq: Long,
    val track: Int,
    val isKeyframe: Boolean,
    val width: Int,
    val height: Int,
    val timestampUs: Long,
    val createdAtMs: Long,
    val startedAtMs: Long,
    val codec: String,
    val fragIndex: Int,
    val fragCount: Int,
    val payload: ByteArray,
) {
    fun frame(bytes: ByteArray) = LiveFrame(msgSeq, track, isKeyframe, width, height, timestampUs, createdAtMs, startedAtMs, codec, bytes)
}

/**
 * Reassembles fragments into frames, per key (the web's `FrameReassembler`): out-of-order fragments
 * still complete, a frame missing a fragment is never emitted, a replay (msgSeq at or below the last
 * emitted) is ignored. The call keys it by author AND track.
 */
class FrameReassembler {
    private class Pending(
        val fragments: Array<ByteArray?>,
        var received: Int,
        val header: FrameFragment,
    )

    private val pending = HashMap<String, HashMap<Long, Pending>>()
    private val lastEmitted = HashMap<String, Long>()

    @Suppress("ReturnCount")
    fun push(
        key: String,
        fragment: FrameFragment,
    ): LiveFrame? {
        val emitted = lastEmitted[key]
        if (emitted != null && fragment.msgSeq <= emitted) return null
        if (fragment.fragCount == 1) {
            lastEmitted[key] = fragment.msgSeq
            dropUpTo(key, fragment.msgSeq)
            return fragment.frame(fragment.payload)
        }
        val byKey = pending.getOrPut(key) { HashMap() }
        var slot = byKey[fragment.msgSeq]
        if (slot == null) {
            slot = Pending(arrayOfNulls(fragment.fragCount), 0, fragment)
            byKey[fragment.msgSeq] = slot
            while (byKey.size > MAX_PENDING_FRAMES) byKey.remove(byKey.keys.min())
            if (byKey[fragment.msgSeq] == null) return null
        }
        if (slot.fragments.size != fragment.fragCount) {
            byKey.remove(fragment.msgSeq)
            return null
        }
        if (slot.fragments[fragment.fragIndex] != null) return null
        slot.fragments[fragment.fragIndex] = fragment.payload
        slot.received += 1
        if (slot.received < slot.fragments.size) return null
        byKey.remove(fragment.msgSeq)
        lastEmitted[key] = fragment.msgSeq
        dropUpTo(key, fragment.msgSeq)
        val total = slot.fragments.sumOf { it!!.size }
        val out = ByteArray(total)
        var at = 0
        for (part in slot.fragments) {
            part!!.copyInto(out, at)
            at += part.size
        }
        return slot.header.frame(out)
    }

    /** Drop everything held for a sender that has gone away. */
    fun forget(key: String) {
        pending.remove(key)
        lastEmitted.remove(key)
    }

    /** Partial frames held for a key (diagnostics and tests). */
    fun pendingCount(key: String): Int = pending[key]?.size ?: 0

    private fun dropUpTo(
        key: String,
        msgSeq: Long,
    ) {
        pending[key]?.keys?.removeAll { it <= msgSeq }
    }

    companion object {
        /** Partially received frames held per sender before the oldest is dropped. */
        const val MAX_PENDING_FRAMES = 4
    }
}

/** Lowercase hex. */
fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it.toInt() and 0xFF) }

/** Bytes from hex. */
fun String.hexToBytes(): ByteArray = ByteArray(length / 2) { substring(it * 2, it * 2 + 2).toInt(16).toByte() }
