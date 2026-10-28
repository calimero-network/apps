package network.calimero.stream

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import network.calimero.stream.core.FrameReassembler
import network.calimero.stream.core.LiveFrame
import network.calimero.stream.core.LiveFrames
import network.calimero.stream.core.hexToBytes
import network.calimero.stream.core.toHex
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The framing against slices the WEB APP's own encoder produced (resources/frame-vectors.json, from
 * mobile/scripts/gen-frame-vectors.ts). The iOS tests read the same file.
 */
class FrameVectorsTest {
    private val vectors: JsonObject =
        Json.parseToJsonElement(javaClass.classLoader!!.getResource("frame-vectors.json")!!.readText()).jsonObject

    private fun frame(
        f: JsonObject,
        bytes: ByteArray,
    ) = LiveFrame(
        msgSeq = f["msgSeq"]!!.jsonPrimitive.long,
        track = f["track"]!!.jsonPrimitive.int,
        isKeyframe = f["isKeyframe"]!!.jsonPrimitive.boolean,
        width = f["width"]!!.jsonPrimitive.int,
        height = f["height"]!!.jsonPrimitive.int,
        timestampUs = f["timestampUs"]!!.jsonPrimitive.long,
        createdAtMs = f["createdAtMs"]!!.jsonPrimitive.long,
        startedAtMs = f["startedAtMs"]!!.jsonPrimitive.long,
        codec = f["codec"]!!.jsonPrimitive.content,
        bytes = bytes,
    )

    private fun cases() = vectors["cases"]!!.jsonArray.map { it.jsonObject }

    @Test fun `payload capacity matches the web`() {
        assertEquals(vectors["maxPayloadAvc"]!!.jsonPrimitive.int, LiveFrames.maxPayloadBytes("avc1.42001f"))
    }

    @Test fun `encodes exactly what the web encodes`() {
        for (c in cases()) {
            val f = c["frame"]!!.jsonObject
            val encoded = LiveFrames.encodeFragments(frame(f, f["bytes"]!!.jsonPrimitive.content.hexToBytes()))
            assertEquals(c["name"].toString(), c["fragments"]!!.jsonArray.map { it.jsonPrimitive.content }, encoded.map { it.toHex() })
        }
    }

    @Test fun `decodes what the web encodes`() {
        for (c in cases()) {
            val f = c["frame"]!!.jsonObject
            val slice =
                c["fragments"]!!
                    .jsonArray[0]
                    .jsonPrimitive.content
                    .hexToBytes()
            val out = FrameReassembler().push("a", LiveFrames.decodeFragment(slice)!!)
            assertEquals(c["name"].toString(), frame(f, f["bytes"]!!.jsonPrimitive.content.hexToBytes()), out)
        }
    }

    @Test fun `a multi-fragment frame splits like the web and reassembles out of order`() {
        val multi = vectors["multi"]!!.jsonObject
        val f = multi["frame"]!!.jsonObject
        val bytes = pattern(f["byteLength"]!!.jsonPrimitive.int, f["patternSeed"]!!.jsonPrimitive.int)
        val source = frame(f, bytes)
        val slices = LiveFrames.encodeFragments(source)
        assertEquals(multi["fragmentLengths"]!!.jsonArray.map { it.jsonPrimitive.int }, slices.map { it.size })
        assertEquals(multi["headersHex"]!!.jsonArray.map { it.jsonPrimitive.content }, slices.map { it.copyOf(51).toHex() })

        val reassembler = FrameReassembler()
        val fragments = slices.map { LiveFrames.decodeFragment(it)!! }
        assertNull(reassembler.push("a", fragments[2]))
        assertNull(reassembler.push("a", fragments[0]))
        assertNull("a duplicate does not complete the frame", reassembler.push("a", fragments[0]))
        assertEquals(source, reassembler.push("a", fragments[1]))
        assertNull("a replay after completion is ignored", reassembler.push("a", fragments[1]))
    }

    @Test fun `a frame missing a fragment is never emitted`() {
        val big = LiveFrames.encodeFragments(LiveFrame(3, 0, true, 640, 480, 0, 0, 0, "avc1.42001f", pattern(20_000, 2)))
        val reassembler = FrameReassembler()
        assertNull(reassembler.push("a", LiveFrames.decodeFragment(big[0])!!))
        val next = LiveFrames.encodeFragments(LiveFrame(4, 0, false, 640, 480, 1, 0, 0, "avc1.42001f", byteArrayOf(1, 2, 3)))
        assertEquals(4L, reassembler.push("a", LiveFrames.decodeFragment(next[0])!!)?.msgSeq)
        assertEquals(0, reassembler.pendingCount("a"))
        assertNull(reassembler.push("a", LiveFrames.decodeFragment(big[1])!!))
    }

    @Test fun `foreign slices are ignored`() {
        assertNull(LiveFrames.decodeFragment("{\"typing\":true}".toByteArray()))
        assertNull("old header version", LiveFrames.decodeFragment(byteArrayOf(0x4D, 0x53, 1) + ByteArray(60)))
        val zeroCount =
            ByteArray(50).also {
                it[0] = 0x4D
                it[1] = 0x53
                it[2] = 2
            }
        assertNull("fragCount 0", LiveFrames.decodeFragment(zeroCount))
        assertNotNull(LiveFrames.decodeFragment(LiveFrames.encodeFragments(LiveFrame(1, 0, false, 1, 1, 0, 0, 0, "x", ByteArray(0)))[0]))
    }

    @Test fun `msgSeq wraps at u32`() {
        assertEquals(0L, LiveFrames.nextMsgSeq(0xFFFF_FFFFL))
    }

    @Test fun `pattern matches the generator`() {
        assertArrayEquals(byteArrayOf(3, 34, 65), pattern(3, 3))
    }

    companion object {
        /** byte i = (i * 31 + seed) & 0xff, as in gen-frame-vectors.ts. */
        fun pattern(
            count: Int,
            seed: Int,
        ) = ByteArray(count) { ((it * 31 + seed) and 0xFF).toByte() }
    }
}
