package network.calimero.stream

import network.calimero.stream.core.AnnexB
import network.calimero.stream.core.Claim
import network.calimero.stream.core.Encoding
import network.calimero.stream.core.Mulaw
import network.calimero.stream.core.People
import network.calimero.stream.core.Slots
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

/** The same vectors as iOS `CodecTests`. */
class CodecTest {
    // CPython audioop.lin2ulaw / ulaw2lin (CCITT G.711 reference).
    @Test fun `mulaw encode matches the reference`() {
        val samples = shortArrayOf(0, 1, -1, 8, -8, 100, -100, 1000, -1000, 8159, -8159, 32767, -32768, 12345, -12345)
        val expected = intArrayOf(255, 255, 126, 254, 126, 242, 114, 206, 78, 159, 31, 128, 0, 151, 23)
        assertArrayEquals(expected, Mulaw.encode(samples).map { it.toInt() and 0xFF }.toIntArray())
    }

    @Test fun `mulaw decode matches the reference`() {
        val bytes = byteArrayOf(0x00, 0x7F, 0x80.toByte(), 0xFF.toByte(), 0x0F, 0x8F.toByte(), 0x55, 0xD5.toByte())
        assertArrayEquals(shortArrayOf(-32124, 0, 32124, 0, -16764, 16764, -716, 716), Mulaw.decode(bytes))
    }

    @Test fun `mulaw round trip stays close`() {
        for (sample in -32000..32000 step 997) {
            val back = Mulaw.decode(Mulaw.encode(sample.toShort())).toInt()
            assertTrue("$sample", abs(back - sample) <= maxOf(8, abs(sample) / 16))
        }
    }

    private val sps = byteArrayOf(0x67, 0x42, 0xC0.toByte(), 0x1F, 0xDA.toByte(), 0x02, 0x80.toByte())
    private val pps = byteArrayOf(0x68, 0xCE.toByte(), 0x3C, 0x80.toByte())
    private val idr = byteArrayOf(0x65, 0x88.toByte(), 0x84.toByte(), 0x00, 0x33)
    private val slice = byteArrayOf(0x41, 0x9A.toByte(), 0x02)

    @Test fun `splits annex-b with three and four byte start codes`() {
        val stream = byteArrayOf(0, 0, 0, 1) + sps + byteArrayOf(0, 0, 1) + pps + byteArrayOf(0, 0, 0, 1) + idr
        val units = AnnexB.units(stream)
        assertEquals(3, units.size)
        assertArrayEquals(sps, units[0])
        assertArrayEquals(pps, units[1])
        assertArrayEquals(idr, units[2])
        assertTrue(AnnexB.isKeyframe(stream))
        assertFalse(AnnexB.isKeyframe(AnnexB.stream(listOf(slice))))
    }

    @Test fun `parameter sets and codec string`() {
        val sets = AnnexB.parameterSets(AnnexB.stream(listOf(sps, pps, idr)))!!
        assertArrayEquals(sps, sets.first)
        assertArrayEquals(pps, sets.second)
        assertEquals("avc1.42c01f", AnnexB.codecString(sps))
        assertEquals("the web's own string", "avc1.42001f", AnnexB.codecString(byteArrayOf(0x67, 0x42, 0x00, 0x1F)))
        assertNull(AnnexB.codecString(pps))
    }

    @Test fun `first come first served with two slots`() {
        val a = Claim("a", 1_000, 1_000, 9_000)
        val b = Claim("b", 2_000, 2_000, 9_000)
        val view = Slots.evaluate(listOf(a, b), "me", null, 10_000, 6_000)
        assertEquals(2, view.occupied)
        assertTrue(view.full)
        assertFalse(view.mayClaim)
        val late = Slots.evaluate(listOf(a, b), "me", 3_000, 10_000, 6_000)
        assertEquals(2, late.myRank)
        assertTrue(late.mustYield)
    }

    @Test fun `a backdated claim is floored and silent senders expire`() {
        val liar = Claim("z", 0, 20_000, 21_000)
        val early = Claim("y", 10_000, 10_000, 21_000)
        val gone = Claim("x", 1, 1, 2)
        assertEquals(listOf("y", "z"), Slots.evaluate(listOf(liar, early, gone), null, null, 21_000, 6_000).ranked.map { it.id })
    }

    @Test fun `encoding is shared among broadcasters`() {
        val base = Encoding(25, 1_500_000)
        assertEquals(base, Encoding.adaptive(base, 1))
        assertEquals(Encoding(13, 750_000), Encoding.adaptive(base, 2))
        assertEquals(Encoding(10, 400_000), Encoding.adaptive(base, 5))
        assertEquals(Encoding(5, 100_000), Encoding.adaptive(Encoding(5, 100_000), 3))
    }

    @Test fun `initials and roster`() {
        assertEquals("AL", People.initials("Ana Maria Lopez"))
        assertEquals("BO", People.initials("bo"))
        assertEquals("??", People.initials("  "))
        val rows = People.roster(listOf("b" to "Bo", "me" to "old", "a" to ""), setOf("b", "c"), "me", "Me", false)
        assertEquals(listOf("me", "b", "c", "a"), rows.map { it.memberId })
        assertEquals("Me", rows[0].name)
        assertEquals("a…", rows[3].name)
    }
}
