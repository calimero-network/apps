package network.calimero.stream.core

/**
 * G.711 µ-law, the audio a phone sends on track 1 (codec string `ulaw`, 8 kHz mono, one byte per
 * sample). Bit-exact with CPython's `audioop.lin2ulaw` / `ulaw2lin` (CCITT reference), identical to
 * the iOS `Mulaw`. The web app sends no audio, so this is what two phones speak to each other.
 */
object Mulaw {
    const val SAMPLE_RATE = 8_000

    /** Samples per packet: 200 ms. */
    const val PACKET_SAMPLES = 1_600
    const val CODEC = "ulaw"

    private val segmentEnds = intArrayOf(0x3F, 0x7F, 0xFF, 0x1FF, 0x3FF, 0x7FF, 0xFFF, 0x1FFF)

    fun encode(sample: Short): Byte {
        var pcm = sample.toInt() shr 2
        val mask: Int
        if (pcm < 0) {
            pcm = -pcm
            mask = 0x7F
        } else {
            mask = 0xFF
        }
        if (pcm > 8159) pcm = 8159
        pcm += 0x84 shr 2
        val segment = segmentEnds.indexOfFirst { pcm <= it }
        if (segment < 0) return (0x7F xor mask).toByte()
        val value = (segment shl 4) or ((pcm shr (segment + 1)) and 0xF)
        return (value xor mask).toByte()
    }

    fun decode(byte: Byte): Short {
        val u = byte.toInt().inv() and 0xFF
        var t = ((u and 0x0F) shl 3) + 0x84
        t = t shl ((u and 0x70) shr 4)
        return (if (u and 0x80 != 0) 0x84 - t else t - 0x84).toShort()
    }

    fun encode(samples: ShortArray): ByteArray = ByteArray(samples.size) { encode(samples[it]) }

    fun decode(bytes: ByteArray): ShortArray = ShortArray(bytes.size) { decode(bytes[it]) }
}
