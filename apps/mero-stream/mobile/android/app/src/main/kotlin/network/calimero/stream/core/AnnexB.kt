package network.calimero.stream.core

/**
 * H.264 byte-stream helpers (identical to the iOS `AnnexB`). The web encodes with WebCodecs
 * `avc: { format: "annexb" }`, so every access unit on the wire is Annex-B and every keyframe
 * carries its SPS and PPS inline. MediaCodec emits Annex-B already but hands the SPS/PPS over once,
 * as a codec-config buffer, so the encoder puts them back in front of each keyframe.
 */
object AnnexB {
    val START_CODE = byteArrayOf(0, 0, 0, 1)
    const val NAL_SLICE = 1
    const val NAL_IDR = 5
    const val NAL_SPS = 7
    const val NAL_PPS = 8
    const val NAL_AUD = 9

    fun type(nal: ByteArray): Int = if (nal.isEmpty()) 0 else nal[0].toInt() and 0x1F

    /** The NAL units of an Annex-B stream, without their start codes. */
    @Suppress("LoopWithTooManyJumpStatements")
    fun units(stream: ByteArray): List<ByteArray> {
        val starts = mutableListOf<Pair<Int, Int>>()
        var i = 0
        while (i + 2 < stream.size) {
            if (stream[i].toInt() == 0 && stream[i + 1].toInt() == 0) {
                if (stream[i + 2].toInt() == 1) {
                    starts += i to 3
                    i += 3
                    continue
                }
                if (i + 3 < stream.size && stream[i + 2].toInt() == 0 && stream[i + 3].toInt() == 1) {
                    starts += i to 4
                    i += 4
                    continue
                }
            }
            i++
        }
        return starts.mapIndexedNotNull { index, (at, length) ->
            val begin = at + length
            val end = if (index + 1 < starts.size) starts[index + 1].first else stream.size
            if (begin < end) stream.copyOfRange(begin, end) else null
        }
    }

    /** Annex-B from NAL units. */
    fun stream(units: List<ByteArray>): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        for (unit in units) {
            out.write(START_CODE)
            out.write(unit)
        }
        return out.toByteArray()
    }

    /** Whether the access unit holds an IDR slice. */
    fun isKeyframe(stream: ByteArray): Boolean = units(stream).any { type(it) == NAL_IDR }

    /** The SPS and PPS an access unit carries, if it carries both. */
    fun parameterSets(stream: ByteArray): Pair<ByteArray, ByteArray>? {
        val all = units(stream)
        val sps = all.firstOrNull { type(it) == NAL_SPS } ?: return null
        val pps = all.firstOrNull { type(it) == NAL_PPS } ?: return null
        return sps to pps
    }

    /** The WebCodecs codec string an SPS describes: `avc1.PPCCLL`, e.g. `avc1.42001f`. */
    fun codecString(sps: ByteArray): String? {
        if (sps.size < 4 || type(sps) != NAL_SPS) return null
        return "avc1.%02x%02x%02x".format(sps[1].toInt() and 0xFF, sps[2].toInt() and 0xFF, sps[3].toInt() and 0xFF)
    }
}
