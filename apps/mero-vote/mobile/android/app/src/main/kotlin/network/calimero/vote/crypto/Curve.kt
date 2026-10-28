package network.calimero.vote.crypto

// ristretto255 (RFC 9496) over edwards25519, and arithmetic mod the group order ℓ.
//
// Neither the JDK nor Android (nor BouncyCastle) exposes ristretto255 or raw
// group arithmetic, so this is implemented from the specifications:
//
// - the field GF(2^255 - 19) and the extended-coordinates point addition are
//   TweetNaCl's (`car25519`, `M`, `pack25519`, `add`), 16 limbs of 16 bits;
// - scalar reduction mod ℓ is TweetNaCl's `modL`;
// - encode, decode, equality and SQRT_RATIO_M1 follow RFC 9496 §4;
// - scalar multiplication is a fixed 4-bit window with constant-time table
//   reads (a precomputed comb for the generator).
//
// iOS `Curve.swift` is the same code line for line. Both are pinned to the web
// client (@noble/curves) by mobile/test-vectors/vectors.json.

@Suppress("MagicNumber")
internal class FieldElement(
    val v: LongArray,
) {
    operator fun plus(b: FieldElement) = FieldElement(LongArray(16) { v[it] + b.v[it] })

    operator fun minus(b: FieldElement) = FieldElement(LongArray(16) { v[it] - b.v[it] })

    operator fun unaryMinus() = FieldElement(LongArray(16) { -v[it] })

    operator fun times(b: FieldElement): FieldElement {
        val t = LongArray(31)
        for (i in 0 until 16) {
            val ai = v[i]
            for (j in 0 until 16) t[i + j] += ai * b.v[j]
        }
        for (i in 0 until 15) t[i] += 38 * t[i + 16]
        val o = t.copyOf(16)
        carry(o)
        carry(o)
        return FieldElement(o)
    }

    fun squared() = this * this

    /** x^(2^252 - 3) = x^((p - 5) / 8). */
    fun pow2523(): FieldElement {
        var c = this
        for (a in 250 downTo 0) {
            c = c.squared()
            if (a != 1) c = c * this
        }
        return c
    }

    /** The canonical 32-byte little-endian encoding. */
    fun bytes(): ByteArray {
        val t = v.copyOf()
        carry(t)
        carry(t)
        carry(t)
        repeat(2) {
            val m = LongArray(16)
            m[0] = t[0] - 0xffed
            for (i in 1 until 15) {
                m[i] = t[i] - 0xffff - ((m[i - 1] shr 16) and 1)
                m[i - 1] = m[i - 1] and 0xffff
            }
            m[15] = t[15] - 0x7fff - ((m[14] shr 16) and 1)
            val b = (m[15] shr 16) and 1
            m[14] = m[14] and 0xffff
            cswap(t, m, 1 - b)
        }
        val out = ByteArray(32)
        for (i in 0 until 16) {
            out[2 * i] = (t[i] and 0xff).toByte()
            out[2 * i + 1] = ((t[i] shr 8) and 0xff).toByte()
        }
        return out
    }

    /** RFC 9496 IS_NEGATIVE: the low bit of the canonical encoding. */
    fun isNegative(): Long = (bytes()[0].toLong() and 1)

    fun isZero(): Boolean = bytes().all { it == 0.toByte() }

    /** Constant-time equality of the canonical encodings, as 1 or 0. */
    fun eq(other: FieldElement): Long {
        val a = bytes()
        val b = other.bytes()
        var diff = 0
        for (i in 0 until 32) diff = diff or (a[i].toInt() xor b[i].toInt())
        return if (diff == 0) 1 else 0
    }

    /** RFC 9496 CT_ABS. */
    fun abs(): FieldElement = select(this, -this, isNegative())

    companion object {
        fun of(vararg limbs: Long) = FieldElement(limbs.copyOf())

        val ZERO = FieldElement(LongArray(16))
        val ONE = FieldElement(LongArray(16).also { it[0] = 1 })

        val D =
            of(
                0x78a3, 0x1359, 0x4dca, 0x75eb, 0xd8ab, 0x4141, 0x0a4d, 0x0070,
                0xe898, 0x7779, 0x4079, 0x8cc7, 0xfe73, 0x2b6f, 0x6cee, 0x5203,
            )
        val D2 =
            of(
                0xf159, 0x26b2, 0x9b94, 0xebd6, 0xb156, 0x8283, 0x149a, 0x00e0,
                0xd130, 0xeef3, 0x80f2, 0x198e, 0xfce7, 0x56df, 0xd9dc, 0x2406,
            )
        val SQRT_M1 =
            of(
                0xa0b0, 0x4a0e, 0x1b27, 0xc4ee, 0xe478, 0xad2f, 0x1806, 0x2f43,
                0xd7a7, 0x3dfb, 0x0099, 0x2b4d, 0xdf0b, 0x4fc1, 0x2480, 0x2b83,
            )

        /** 1 / sqrt(a - d), a = -1. */
        val INVSQRT_A_MINUS_D =
            of(
                0x40ea, 0x805d, 0xfdaa, 0x99c8, 0x72be, 0x5a41, 0x1617, 0x9d2f,
                0xd840, 0xfe01, 0x7b91, 0x16c2, 0xfca2, 0xcfaf, 0x8905, 0x786c,
            )

        fun carry(o: LongArray) {
            for (i in 0 until 16) {
                o[i] += 1L shl 16
                val c = o[i] shr 16
                if (i < 15) o[i + 1] += c - 1 else o[0] += 38 * (c - 1)
                o[i] -= c shl 16
            }
        }

        /** Swap `p` and `q` in place when `bit` is 1, in constant time. */
        fun cswap(
            p: LongArray,
            q: LongArray,
            bit: Long,
        ) {
            val mask = (bit - 1).inv()
            for (i in 0 until 16) {
                val t = mask and (p[i] xor q[i])
                p[i] = p[i] xor t
                q[i] = q[i] xor t
            }
        }

        /** `b` when `bit` is 1, else `a`, in constant time. */
        fun select(
            a: FieldElement,
            b: FieldElement,
            bit: Long,
        ): FieldElement {
            val x = a.v.copyOf()
            cswap(x, b.v.copyOf(), bit)
            return FieldElement(x)
        }

        /** Bit 255 is dropped; the caller checks canonicity by re-encoding. */
        fun fromBytes(n: ByteArray): FieldElement {
            val o = LongArray(16) { (n[2 * it].toLong() and 0xff) + ((n[2 * it + 1].toLong() and 0xff) shl 8) }
            o[15] = o[15] and 0x7fff
            return FieldElement(o)
        }

        /** RFC 9496 SQRT_RATIO_M1(u, v). */
        fun sqrtRatioM1(
            u: FieldElement,
            v: FieldElement,
        ): Pair<Boolean, FieldElement> {
            val v3 = v.squared() * v
            val v7 = v3.squared() * v
            var r = (u * v3) * (u * v7).pow2523()
            val check = v * r.squared()
            val correct = check.eq(u)
            val flipped = check.eq(-u)
            val flippedI = check.eq(-u * SQRT_M1)
            r = select(r, SQRT_M1 * r, flipped or flippedI)
            return Pair((correct or flipped) == 1L, r.abs())
        }
    }
}

/** A ristretto255 group element, held as an edwards25519 point in extended coordinates. */
@Suppress("MagicNumber")
class RistrettoPoint internal constructor(
    internal val x: FieldElement,
    internal val y: FieldElement,
    internal val z: FieldElement,
    internal val t: FieldElement,
    /** Set on the generator only, so multiplying it takes the precomputed comb. */
    private val isBase: Boolean = false,
) {
    /** RFC 9496 §4.3.2 ENCODE. */
    fun bytes(): ByteArray {
        val u1 = (z + y) * (z - y)
        val u2 = x * y
        val invsqrt = FieldElement.sqrtRatioM1(FieldElement.ONE, u1 * u2.squared()).second
        val den1 = invsqrt * u1
        val den2 = invsqrt * u2
        val zInv = den1 * den2 * t
        val ix0 = x * FieldElement.SQRT_M1
        val iy0 = y * FieldElement.SQRT_M1
        val enchanted = den1 * FieldElement.INVSQRT_A_MINUS_D
        val rotate = (t * zInv).isNegative()
        val xr = FieldElement.select(x, iy0, rotate)
        var yr = FieldElement.select(y, ix0, rotate)
        val denInv = FieldElement.select(den2, enchanted, rotate)
        yr = FieldElement.select(yr, -yr, (xr * zInv).isNegative())
        return (denInv * (z - yr)).abs().bytes()
    }

    fun hex(): String = Hex.encode(bytes())

    /** RFC 9496 §4.5 EQUALS. */
    fun equalsPoint(other: RistrettoPoint): Boolean =
        ((x * other.y).eq(y * other.x) or (y * other.y).eq(x * other.x)) == 1L

    operator fun plus(q: RistrettoPoint): RistrettoPoint {
        val a = (y - x) * (q.y - q.x)
        val b = (x + y) * (q.x + q.y)
        val c = t * q.t * FieldElement.D2
        val d0 = z * q.z
        val d = d0 + d0
        val e = b - a
        val f = d - c
        val g = d + c
        val h = b + a
        return RistrettoPoint(e * f, h * g, g * f, e * h)
    }

    operator fun unaryMinus() = RistrettoPoint(-x, y, z, -t)

    operator fun minus(q: RistrettoPoint) = this + (-q)

    /** `k · this`: a fixed 4-bit window over all 64 digits, constant time in `k`. */
    fun multiply(k: Scalar): RistrettoPoint {
        if (isBase) return mulBase(k)
        val table = table(this)
        val digits = nibbles(k)
        var acc = IDENTITY
        for (i in 63 downTo 0) {
            acc += acc
            acc += acc
            acc += acc
            acc += acc
            acc += lookup(table, digits[i])
        }
        return acc
    }

    companion object {
        val IDENTITY = RistrettoPoint(FieldElement.ZERO, FieldElement.ONE, FieldElement.ONE, FieldElement.ZERO)

        /** The ristretto255 generator (RFC 9496 §4.4). */
        val BASE: RistrettoPoint =
            fromHex("e2f2ae0a6abc4e71a884a961c500515f58e30b6aa582dd8db6a65945e08d2d76")
                .let { RistrettoPoint(it.x, it.y, it.z, it.t, isBase = true) }

        /** RFC 9496 §4.3.1 DECODE. Refuses a non-canonical or invalid encoding. */
        fun fromBytes(s: ByteArray): RistrettoPoint {
            if (s.size != 32) throw CurveException("not a valid ristretto255 point")
            val fs = FieldElement.fromBytes(s)
            if (!fs.bytes().contentEquals(s) || fs.isNegative() != 0L) {
                throw CurveException("not a valid ristretto255 point")
            }
            val ss = fs.squared()
            val u1 = FieldElement.ONE - ss
            val u2 = FieldElement.ONE + ss
            val u2Sqr = u2.squared()
            val v = -(FieldElement.D * u1.squared()) - u2Sqr
            val (wasSquare, invsqrt) = FieldElement.sqrtRatioM1(FieldElement.ONE, v * u2Sqr)
            val denX = invsqrt * u2
            val denY = invsqrt * denX * v
            val x = ((fs + fs) * denX).abs()
            val y = u1 * denY
            val t = x * y
            if (!wasSquare || t.isNegative() != 0L || y.isZero()) throw CurveException("not a valid ristretto255 point")
            return RistrettoPoint(x, y, FieldElement.ONE, t)
        }

        fun fromHex(hex: String): RistrettoPoint {
            val b = Hex.decode(hex) ?: throw CurveException("not 32 bytes of hex")
            return fromBytes(b)
        }

        private fun cswap(
            p: RistrettoPoint,
            q: RistrettoPoint,
            bit: Long,
        ): Pair<RistrettoPoint, RistrettoPoint> {
            val px = p.x.v.copyOf()
            val py = p.y.v.copyOf()
            val pz = p.z.v.copyOf()
            val pt = p.t.v.copyOf()
            val qx = q.x.v.copyOf()
            val qy = q.y.v.copyOf()
            val qz = q.z.v.copyOf()
            val qt = q.t.v.copyOf()
            FieldElement.cswap(px, qx, bit)
            FieldElement.cswap(py, qy, bit)
            FieldElement.cswap(pz, qz, bit)
            FieldElement.cswap(pt, qt, bit)
            return Pair(
                RistrettoPoint(FieldElement(px), FieldElement(py), FieldElement(pz), FieldElement(pt)),
                RistrettoPoint(FieldElement(qx), FieldElement(qy), FieldElement(qz), FieldElement(qt)),
            )
        }

        /** `a` when `bit` is 0, `b` when it is 1, in constant time. */
        private fun select(
            a: RistrettoPoint,
            b: RistrettoPoint,
            bit: Long,
        ) = cswap(a, b, bit).first

        /** 1 when `a == b` (both small and non-negative), else 0, without a branch. */
        private fun eqBit(
            a: Int,
            b: Int,
        ): Long = (((a xor b).toLong() - 1) shr 63) and 1

        /** `[0·P, 1·P, …, 15·P]`. */
        private fun table(p: RistrettoPoint): List<RistrettoPoint> {
            val t = mutableListOf(IDENTITY, p)
            for (i in 2 until 16) t.add(t[t.size - 1] + p)
            return t
        }

        /** `t[index]`, reading every entry, in constant time. */
        private fun lookup(
            t: List<RistrettoPoint>,
            index: Int,
        ): RistrettoPoint {
            var r = IDENTITY
            for (j in 0 until 16) r = select(r, t[j], eqBit(j, index))
            return r
        }

        /** The scalar's 64 little-endian 4-bit digits. */
        private fun nibbles(k: Scalar): IntArray {
            val b = k.bytes()
            val out = IntArray(64)
            for (i in 0 until 32) {
                val v = b[i].toInt() and 0xff
                out[2 * i] = v and 0x0f
                out[2 * i + 1] = v shr 4
            }
            return out
        }

        /** `j · 16^i · B` for every digit position i and digit j: the fixed-base comb. */
        private val baseTable: List<List<RistrettoPoint>> by lazy {
            val rows = mutableListOf<List<RistrettoPoint>>()
            var p = RistrettoPoint(BASE.x, BASE.y, BASE.z, BASE.t)
            repeat(64) {
                val row = table(p)
                rows.add(row)
                p = row[15] + p
            }
            rows
        }

        /** `k · B`: one constant-time table read and one addition per digit. */
        private fun mulBase(k: Scalar): RistrettoPoint {
            var acc = IDENTITY
            nibbles(k).forEachIndexed { i, digit -> acc += lookup(baseTable[i], digit) }
            return acc
        }
    }
}

/** An integer mod ℓ = 2^252 + 27742317777372353535851937790883648493: canonical, 32 bytes little-endian. */
@Suppress("MagicNumber")
class Scalar private constructor(
    private val b: ByteArray,
) {
    fun bytes(): ByteArray = b.copyOf()

    fun hex(): String = Hex.encode(b)

    val isZero: Boolean get() = b.all { it == 0.toByte() }

    override fun equals(other: Any?): Boolean = other is Scalar && other.b.contentEquals(b)

    override fun hashCode(): Int = b.contentHashCode()

    override fun toString(): String = "Scalar(${hex()})"

    operator fun plus(o: Scalar) = mulAdd(this, ONE, o)

    operator fun times(o: Scalar) = mulAdd(this, o, ZERO)

    operator fun unaryMinus() = mulAdd(this, MINUS_ONE, ZERO)

    operator fun minus(o: Scalar) = this + (-o)

    /** a^(ℓ-2): the inverse of a non-zero scalar (Fermat). The exponent is public. */
    fun inverse(): Scalar {
        val exponent = IntArray(32) { ORDER[it].toInt() }
        exponent[0] -= 2
        var result = ONE
        for (i in 255 downTo 0) {
            result *= result
            if ((exponent[i / 8] shr (i and 7)) and 1 == 1) result *= this
        }
        return result
    }

    companion object {
        private val ORDER =
            longArrayOf(
                0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde, 0x14,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x10,
            )

        val ZERO = reducing(ByteArray(32))
        val ONE = of(1)

        /** ℓ - 1, i.e. -1. */
        private val MINUS_ONE = Scalar(ByteArray(32) { (if (it == 0) ORDER[0] - 1 else ORDER[it]).toByte() })

        /** Any little-endian byte string (up to 64 bytes), reduced mod ℓ. */
        fun reducing(input: ByteArray): Scalar {
            val x = LongArray(64)
            for (i in input.indices) if (i < 64) x[i] = input[i].toLong() and 0xff
            return Scalar(modL(x))
        }

        fun of(n: Long): Scalar {
            val bytes = ByteArray(32)
            for (i in 0 until 8) bytes[i] = (n ushr (8 * i)).toByte()
            return reducing(bytes)
        }

        /** A canonical encoding only: refuses anything ≥ ℓ. */
        fun canonical(bytes: ByteArray): Scalar {
            if (bytes.size != 32) throw CurveException("not a canonical scalar")
            var lessThan = false
            for (i in 31 downTo 0) {
                val v = bytes[i].toLong() and 0xff
                if (v < ORDER[i]) {
                    lessThan = true
                    break
                }
                if (v > ORDER[i]) break
            }
            if (!lessThan) throw CurveException("not a canonical scalar")
            return Scalar(bytes.copyOf())
        }

        fun fromHex(hex: String): Scalar = canonical(Hex.decode(hex) ?: throw CurveException("not 32 bytes of hex"))

        /** TweetNaCl `modL`: reduce a 64-limb little-endian integer mod ℓ. */
        private fun modL(x: LongArray): ByteArray {
            var carry: Long
            for (i in 63 downTo 32) {
                carry = 0
                var j = i - 32
                while (j < i - 12) {
                    x[j] += carry - 16 * x[i] * ORDER[j - (i - 32)]
                    carry = (x[j] + 128) shr 8
                    x[j] -= carry shl 8
                    j++
                }
                x[j] += carry
                x[i] = 0
            }
            carry = 0
            for (j in 0 until 32) {
                x[j] += carry - (x[31] shr 4) * ORDER[j]
                carry = x[j] shr 8
                x[j] = x[j] and 255
            }
            for (j in 0 until 32) x[j] -= carry * ORDER[j]
            val r = ByteArray(32)
            for (i in 0 until 32) {
                x[i + 1] += x[i] shr 8
                r[i] = (x[i] and 255).toByte()
            }
            return r
        }

        /** `a · b + c mod ℓ`. */
        private fun mulAdd(
            a: Scalar,
            b: Scalar,
            c: Scalar,
        ): Scalar {
            val x = LongArray(64)
            for (i in 0 until 32) x[i] = c.b[i].toLong() and 0xff
            for (i in 0 until 32) {
                val ai = a.b[i].toLong() and 0xff
                for (j in 0 until 32) x[i + j] += ai * (b.b[j].toLong() and 0xff)
            }
            return Scalar(modL(x))
        }
    }
}

class CurveException(
    message: String,
) : IllegalArgumentException(message)

/** Lower-case hex, both ways. */
object Hex {
    private const val DIGITS = "0123456789abcdef"

    fun encode(bytes: ByteArray): String {
        val sb = StringBuilder(bytes.size * 2)
        for (b in bytes) {
            val v = b.toInt() and 0xff
            sb.append(DIGITS[v shr 4]).append(DIGITS[v and 0x0f])
        }
        return sb.toString()
    }

    fun decode(s: String): ByteArray? {
        if (s.length % 2 != 0) return null
        val out = ByteArray(s.length / 2)
        for (i in out.indices) {
            val hi = Character.digit(s[2 * i], 16)
            val lo = Character.digit(s[2 * i + 1], 16)
            if (hi < 0 || lo < 0) return null
            out[i] = ((hi shl 4) or lo).toByte()
        }
        return out
    }
}
