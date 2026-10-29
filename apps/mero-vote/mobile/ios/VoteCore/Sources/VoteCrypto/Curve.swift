import Foundation

// ristretto255 (RFC 9496) over edwards25519, and arithmetic mod the group order ℓ.
//
// Neither CryptoKit nor any other system framework exposes ristretto255 or
// raw group arithmetic, so this is implemented from the specifications:
//
// - the field GF(2^255 - 19) and the extended-coordinates point addition and
//   constant-time ladder are TweetNaCl's (`car25519`, `M`, `pack25519`,
//   `add`, `scalarmult`), 16 limbs of 16 bits in Int64;
// - scalar reduction mod ℓ is TweetNaCl's `modL`;
// - encode, decode, equality and SQRT_RATIO_M1 follow RFC 9496 §4.
//
// Kotlin `Curve.kt` is the same code line for line. Both are pinned to the web
// client (@noble/curves) by ../../../../test-vectors/vectors.json.

/// An element of GF(2^255 - 19): 16 signed limbs of radix 2^16.
struct FieldElement: Sendable {
    var v: SIMD16<Int64>

    init(_ v: SIMD16<Int64>) { self.v = v }

    init(limbs: [Int64]) {
        var s = SIMD16<Int64>()
        for i in 0..<16 { s[i] = limbs[i] }
        v = s
    }

    static let zero = FieldElement(SIMD16<Int64>())
    static let one: FieldElement = {
        var s = SIMD16<Int64>()
        s[0] = 1
        return FieldElement(s)
    }()

    static let d = FieldElement(limbs: [
        0x78a3, 0x1359, 0x4dca, 0x75eb, 0xd8ab, 0x4141, 0x0a4d, 0x0070,
        0xe898, 0x7779, 0x4079, 0x8cc7, 0xfe73, 0x2b6f, 0x6cee, 0x5203,
    ])
    static let d2 = FieldElement(limbs: [
        0xf159, 0x26b2, 0x9b94, 0xebd6, 0xb156, 0x8283, 0x149a, 0x00e0,
        0xd130, 0xeef3, 0x80f2, 0x198e, 0xfce7, 0x56df, 0xd9dc, 0x2406,
    ])
    static let sqrtM1 = FieldElement(limbs: [
        0xa0b0, 0x4a0e, 0x1b27, 0xc4ee, 0xe478, 0xad2f, 0x1806, 0x2f43,
        0xd7a7, 0x3dfb, 0x0099, 0x2b4d, 0xdf0b, 0x4fc1, 0x2480, 0x2b83,
    ])
    /// 1 / sqrt(a - d), a = -1.
    static let invsqrtAMinusD = FieldElement(limbs: [
        0x40ea, 0x805d, 0xfdaa, 0x99c8, 0x72be, 0x5a41, 0x1617, 0x9d2f,
        0xd840, 0xfe01, 0x7b91, 0x16c2, 0xfca2, 0xcfaf, 0x8905, 0x786c,
    ])

    private static func carry(_ o: inout SIMD16<Int64>) {
        for i in 0..<16 {
            o[i] &+= 1 << 16
            let c = o[i] >> 16
            if i < 15 {
                o[i + 1] &+= c &- 1
            } else {
                o[0] &+= 38 &* (c &- 1)
            }
            o[i] &-= c &<< 16
        }
    }

    /// Swap `p` and `q` when `bit` is 1, in constant time.
    static func cswap(_ p: inout FieldElement, _ q: inout FieldElement, _ bit: Int64) {
        let mask = SIMD16<Int64>(repeating: ~(bit &- 1))
        let t = mask & (p.v ^ q.v)
        p.v ^= t
        q.v ^= t
    }

    /// `b` when `bit` is 1, else `a`, in constant time.
    static func select(_ a: FieldElement, _ b: FieldElement, _ bit: Int64) -> FieldElement {
        var x = a
        var y = b
        cswap(&x, &y, bit)
        return x
    }

    static func + (a: FieldElement, b: FieldElement) -> FieldElement { FieldElement(a.v &+ b.v) }
    static func - (a: FieldElement, b: FieldElement) -> FieldElement { FieldElement(a.v &- b.v) }
    static prefix func - (a: FieldElement) -> FieldElement { FieldElement(SIMD16<Int64>() &- a.v) }

    // Unrolled (generated): SIMD subscripts in a loop do not stay in registers.
    static func * (a: FieldElement, b: FieldElement) -> FieldElement {
        let a0 = a.v[0], b0 = b.v[0]
        let a1 = a.v[1], b1 = b.v[1]
        let a2 = a.v[2], b2 = b.v[2]
        let a3 = a.v[3], b3 = b.v[3]
        let a4 = a.v[4], b4 = b.v[4]
        let a5 = a.v[5], b5 = b.v[5]
        let a6 = a.v[6], b6 = b.v[6]
        let a7 = a.v[7], b7 = b.v[7]
        let a8 = a.v[8], b8 = b.v[8]
        let a9 = a.v[9], b9 = b.v[9]
        let a10 = a.v[10], b10 = b.v[10]
        let a11 = a.v[11], b11 = b.v[11]
        let a12 = a.v[12], b12 = b.v[12]
        let a13 = a.v[13], b13 = b.v[13]
        let a14 = a.v[14], b14 = b.v[14]
        let a15 = a.v[15], b15 = b.v[15]
        var t0: Int64 = a0 &* b0
        var t1: Int64 = a0 &* b1 &+ a1 &* b0
        var t2: Int64 = a0 &* b2 &+ a1 &* b1 &+ a2 &* b0
        var t3: Int64 = a0 &* b3 &+ a1 &* b2 &+ a2 &* b1 &+ a3 &* b0
        var t4: Int64 = a0 &* b4 &+ a1 &* b3 &+ a2 &* b2 &+ a3 &* b1 &+ a4 &* b0
        var t5: Int64 = a0 &* b5 &+ a1 &* b4 &+ a2 &* b3 &+ a3 &* b2 &+ a4 &* b1 &+ a5 &* b0
        var t6: Int64 = a0 &* b6 &+ a1 &* b5 &+ a2 &* b4 &+ a3 &* b3 &+ a4 &* b2 &+ a5 &* b1 &+ a6 &* b0
        var t7: Int64 = a0 &* b7 &+ a1 &* b6 &+ a2 &* b5 &+ a3 &* b4 &+ a4 &* b3 &+ a5 &* b2 &+ a6 &* b1 &+ a7 &* b0
        var t8: Int64 = a0 &* b8 &+ a1 &* b7 &+ a2 &* b6 &+ a3 &* b5 &+ a4 &* b4 &+ a5 &* b3 &+ a6 &* b2 &+ a7 &* b1 &+ a8 &* b0
        var t9: Int64 = a0 &* b9 &+ a1 &* b8 &+ a2 &* b7 &+ a3 &* b6 &+ a4 &* b5 &+ a5 &* b4 &+ a6 &* b3 &+ a7 &* b2 &+ a8 &* b1 &+ a9 &* b0
        var t10: Int64 = a0 &* b10 &+ a1 &* b9 &+ a2 &* b8 &+ a3 &* b7 &+ a4 &* b6 &+ a5 &* b5 &+ a6 &* b4 &+ a7 &* b3 &+ a8 &* b2 &+ a9 &* b1 &+ a10 &* b0
        var t11: Int64 = a0 &* b11 &+ a1 &* b10 &+ a2 &* b9 &+ a3 &* b8 &+ a4 &* b7 &+ a5 &* b6 &+ a6 &* b5 &+ a7 &* b4 &+ a8 &* b3 &+ a9 &* b2 &+ a10 &* b1 &+ a11 &* b0
        var t12: Int64 = a0 &* b12 &+ a1 &* b11 &+ a2 &* b10 &+ a3 &* b9 &+ a4 &* b8 &+ a5 &* b7 &+ a6 &* b6 &+ a7 &* b5 &+ a8 &* b4 &+ a9 &* b3 &+ a10 &* b2 &+ a11 &* b1 &+ a12 &* b0
        var t13: Int64 = a0 &* b13 &+ a1 &* b12 &+ a2 &* b11 &+ a3 &* b10 &+ a4 &* b9 &+ a5 &* b8 &+ a6 &* b7 &+ a7 &* b6 &+ a8 &* b5 &+ a9 &* b4 &+ a10 &* b3 &+ a11 &* b2 &+ a12 &* b1 &+ a13 &* b0
        var t14: Int64 = a0 &* b14 &+ a1 &* b13 &+ a2 &* b12 &+ a3 &* b11 &+ a4 &* b10 &+ a5 &* b9 &+ a6 &* b8 &+ a7 &* b7 &+ a8 &* b6 &+ a9 &* b5 &+ a10 &* b4 &+ a11 &* b3 &+ a12 &* b2 &+ a13 &* b1 &+ a14 &* b0
        var t15: Int64 = a0 &* b15 &+ a1 &* b14 &+ a2 &* b13 &+ a3 &* b12 &+ a4 &* b11 &+ a5 &* b10 &+ a6 &* b9 &+ a7 &* b8 &+ a8 &* b7 &+ a9 &* b6 &+ a10 &* b5 &+ a11 &* b4 &+ a12 &* b3 &+ a13 &* b2 &+ a14 &* b1 &+ a15 &* b0
        let t16: Int64 = a1 &* b15 &+ a2 &* b14 &+ a3 &* b13 &+ a4 &* b12 &+ a5 &* b11 &+ a6 &* b10 &+ a7 &* b9 &+ a8 &* b8 &+ a9 &* b7 &+ a10 &* b6 &+ a11 &* b5 &+ a12 &* b4 &+ a13 &* b3 &+ a14 &* b2 &+ a15 &* b1
        let t17: Int64 = a2 &* b15 &+ a3 &* b14 &+ a4 &* b13 &+ a5 &* b12 &+ a6 &* b11 &+ a7 &* b10 &+ a8 &* b9 &+ a9 &* b8 &+ a10 &* b7 &+ a11 &* b6 &+ a12 &* b5 &+ a13 &* b4 &+ a14 &* b3 &+ a15 &* b2
        let t18: Int64 = a3 &* b15 &+ a4 &* b14 &+ a5 &* b13 &+ a6 &* b12 &+ a7 &* b11 &+ a8 &* b10 &+ a9 &* b9 &+ a10 &* b8 &+ a11 &* b7 &+ a12 &* b6 &+ a13 &* b5 &+ a14 &* b4 &+ a15 &* b3
        let t19: Int64 = a4 &* b15 &+ a5 &* b14 &+ a6 &* b13 &+ a7 &* b12 &+ a8 &* b11 &+ a9 &* b10 &+ a10 &* b9 &+ a11 &* b8 &+ a12 &* b7 &+ a13 &* b6 &+ a14 &* b5 &+ a15 &* b4
        let t20: Int64 = a5 &* b15 &+ a6 &* b14 &+ a7 &* b13 &+ a8 &* b12 &+ a9 &* b11 &+ a10 &* b10 &+ a11 &* b9 &+ a12 &* b8 &+ a13 &* b7 &+ a14 &* b6 &+ a15 &* b5
        let t21: Int64 = a6 &* b15 &+ a7 &* b14 &+ a8 &* b13 &+ a9 &* b12 &+ a10 &* b11 &+ a11 &* b10 &+ a12 &* b9 &+ a13 &* b8 &+ a14 &* b7 &+ a15 &* b6
        let t22: Int64 = a7 &* b15 &+ a8 &* b14 &+ a9 &* b13 &+ a10 &* b12 &+ a11 &* b11 &+ a12 &* b10 &+ a13 &* b9 &+ a14 &* b8 &+ a15 &* b7
        let t23: Int64 = a8 &* b15 &+ a9 &* b14 &+ a10 &* b13 &+ a11 &* b12 &+ a12 &* b11 &+ a13 &* b10 &+ a14 &* b9 &+ a15 &* b8
        let t24: Int64 = a9 &* b15 &+ a10 &* b14 &+ a11 &* b13 &+ a12 &* b12 &+ a13 &* b11 &+ a14 &* b10 &+ a15 &* b9
        let t25: Int64 = a10 &* b15 &+ a11 &* b14 &+ a12 &* b13 &+ a13 &* b12 &+ a14 &* b11 &+ a15 &* b10
        let t26: Int64 = a11 &* b15 &+ a12 &* b14 &+ a13 &* b13 &+ a14 &* b12 &+ a15 &* b11
        let t27: Int64 = a12 &* b15 &+ a13 &* b14 &+ a14 &* b13 &+ a15 &* b12
        let t28: Int64 = a13 &* b15 &+ a14 &* b14 &+ a15 &* b13
        let t29: Int64 = a14 &* b15 &+ a15 &* b14
        let t30: Int64 = a15 &* b15
        t0 &+= 38 &* t16
        t1 &+= 38 &* t17
        t2 &+= 38 &* t18
        t3 &+= 38 &* t19
        t4 &+= 38 &* t20
        t5 &+= 38 &* t21
        t6 &+= 38 &* t22
        t7 &+= 38 &* t23
        t8 &+= 38 &* t24
        t9 &+= 38 &* t25
        t10 &+= 38 &* t26
        t11 &+= 38 &* t27
        t12 &+= 38 &* t28
        t13 &+= 38 &* t29
        t14 &+= 38 &* t30
        var c: Int64
        for _ in 0..<2 {
            t0 &+= 1 << 16; c = t0 >> 16; t1 &+= c &- 1; t0 &-= c &<< 16
            t1 &+= 1 << 16; c = t1 >> 16; t2 &+= c &- 1; t1 &-= c &<< 16
            t2 &+= 1 << 16; c = t2 >> 16; t3 &+= c &- 1; t2 &-= c &<< 16
            t3 &+= 1 << 16; c = t3 >> 16; t4 &+= c &- 1; t3 &-= c &<< 16
            t4 &+= 1 << 16; c = t4 >> 16; t5 &+= c &- 1; t4 &-= c &<< 16
            t5 &+= 1 << 16; c = t5 >> 16; t6 &+= c &- 1; t5 &-= c &<< 16
            t6 &+= 1 << 16; c = t6 >> 16; t7 &+= c &- 1; t6 &-= c &<< 16
            t7 &+= 1 << 16; c = t7 >> 16; t8 &+= c &- 1; t7 &-= c &<< 16
            t8 &+= 1 << 16; c = t8 >> 16; t9 &+= c &- 1; t8 &-= c &<< 16
            t9 &+= 1 << 16; c = t9 >> 16; t10 &+= c &- 1; t9 &-= c &<< 16
            t10 &+= 1 << 16; c = t10 >> 16; t11 &+= c &- 1; t10 &-= c &<< 16
            t11 &+= 1 << 16; c = t11 >> 16; t12 &+= c &- 1; t11 &-= c &<< 16
            t12 &+= 1 << 16; c = t12 >> 16; t13 &+= c &- 1; t12 &-= c &<< 16
            t13 &+= 1 << 16; c = t13 >> 16; t14 &+= c &- 1; t13 &-= c &<< 16
            t14 &+= 1 << 16; c = t14 >> 16; t15 &+= c &- 1; t14 &-= c &<< 16
            t15 &+= 1 << 16; c = t15 >> 16; t0 &+= 38 &* (c &- 1); t15 &-= c &<< 16
        }
        return FieldElement(SIMD16<Int64>(t0, t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, t11, t12, t13, t14, t15))
    }

    var squared: FieldElement { self * self }

    /// x^(2^252 - 3) = x^((p - 5) / 8).
    var pow2523: FieldElement {
        var c = self
        for a in stride(from: 250, through: 0, by: -1) {
            c = c.squared
            if a != 1 { c = c * self }
        }
        return c
    }

    /// The canonical 32-byte little-endian encoding.
    var bytes: [UInt8] {
        var t = v
        FieldElement.carry(&t)
        FieldElement.carry(&t)
        FieldElement.carry(&t)
        for _ in 0..<2 {
            var m = SIMD16<Int64>()
            m[0] = t[0] &- 0xffed
            for i in 1..<15 {
                m[i] = t[i] &- 0xffff &- ((m[i - 1] >> 16) & 1)
                m[i - 1] &= 0xffff
            }
            m[15] = t[15] &- 0x7fff &- ((m[14] >> 16) & 1)
            let b = (m[15] >> 16) & 1
            m[14] &= 0xffff
            var tt = FieldElement(t)
            var mm = FieldElement(m)
            FieldElement.cswap(&tt, &mm, 1 &- b)
            t = tt.v
        }
        var out = [UInt8](repeating: 0, count: 32)
        for i in 0..<16 {
            out[2 * i] = UInt8(truncatingIfNeeded: t[i] & 0xff)
            out[2 * i + 1] = UInt8(truncatingIfNeeded: (t[i] >> 8) & 0xff)
        }
        return out
    }

    /// Bit 255 is dropped; the caller checks canonicity by re-encoding.
    init(bytes n: [UInt8]) {
        var s = SIMD16<Int64>()
        for i in 0..<16 { s[i] = Int64(n[2 * i]) + (Int64(n[2 * i + 1]) << 8) }
        s[15] &= 0x7fff
        v = s
    }

    /// RFC 9496 IS_NEGATIVE: the low bit of the canonical encoding.
    var isNegative: Int64 { Int64(bytes[0] & 1) }

    var isZero: Bool { bytes.allSatisfy { $0 == 0 } }

    /// Constant-time equality of the canonical encodings, as 1 or 0.
    func equals(_ other: FieldElement) -> Int64 {
        let a = bytes
        let b = other.bytes
        var diff: UInt8 = 0
        for i in 0..<32 { diff |= a[i] ^ b[i] }
        return diff == 0 ? 1 : 0
    }

    /// RFC 9496 CT_ABS.
    var abs: FieldElement { FieldElement.select(self, -self, isNegative) }

    /// RFC 9496 SQRT_RATIO_M1(u, v): (was_square, the non-negative root of u/v or of i·u/v).
    static func sqrtRatioM1(_ u: FieldElement, _ v: FieldElement) -> (Bool, FieldElement) {
        let v3 = v.squared * v
        let v7 = v3.squared * v
        var r = (u * v3) * (u * v7).pow2523
        let check = v * r.squared
        let correct = check.equals(u)
        let flipped = check.equals(-u)
        let flippedI = check.equals(-u * sqrtM1)
        r = select(r, sqrtM1 * r, flipped | flippedI)
        return ((correct | flipped) == 1, r.abs)
    }
}

/// A ristretto255 group element, held as an edwards25519 point in extended coordinates.
public struct RistrettoPoint: Sendable {
    var x: FieldElement
    var y: FieldElement
    var z: FieldElement
    var t: FieldElement
    /// Set on the generator only, so multiplying it takes the precomputed comb.
    var isBase = false

    public static let identity = RistrettoPoint(x: .zero, y: .one, z: .one, t: .zero)

    /// The ristretto255 generator (RFC 9496 §4.4).
    public static let base: RistrettoPoint = {
        // swiftlint:disable:next force_try
        var b = try! RistrettoPoint(hex: "e2f2ae0a6abc4e71a884a961c500515f58e30b6aa582dd8db6a65945e08d2d76")
        b.isBase = true
        return b
    }()

    init(x: FieldElement, y: FieldElement, z: FieldElement, t: FieldElement) {
        self.x = x
        self.y = y
        self.z = z
        self.t = t
    }

    /// RFC 9496 §4.3.1 DECODE. Refuses a non-canonical or invalid encoding.
    public init(bytes s: [UInt8]) throws {
        guard s.count == 32 else { throw CurveError.invalidPoint }
        let fs = FieldElement(bytes: s)
        guard fs.bytes == s, fs.isNegative == 0 else { throw CurveError.invalidPoint }
        let ss = fs.squared
        let u1 = FieldElement.one - ss
        let u2 = FieldElement.one + ss
        let u2Sqr = u2.squared
        let v = -(FieldElement.d * u1.squared) - u2Sqr
        let (wasSquare, invsqrt) = FieldElement.sqrtRatioM1(.one, v * u2Sqr)
        let denX = invsqrt * u2
        let denY = invsqrt * denX * v
        let x = (fs + fs) * denX
        let xAbs = x.abs
        let y = u1 * denY
        let t = xAbs * y
        guard wasSquare, t.isNegative == 0, !y.isZero else { throw CurveError.invalidPoint }
        self.init(x: xAbs, y: y, z: .one, t: t)
    }

    public init(hex: String) throws {
        guard let b = Hex.decode(hex), b.count == 32 else { throw CurveError.invalidPoint }
        try self.init(bytes: b)
    }

    /// RFC 9496 §4.3.2 ENCODE.
    public var bytes: [UInt8] {
        let u1 = (z + y) * (z - y)
        let u2 = x * y
        let (_, invsqrt) = FieldElement.sqrtRatioM1(.one, u1 * u2.squared)
        let den1 = invsqrt * u1
        let den2 = invsqrt * u2
        let zInv = den1 * den2 * t
        let ix0 = x * FieldElement.sqrtM1
        let iy0 = y * FieldElement.sqrtM1
        let enchanted = den1 * FieldElement.invsqrtAMinusD
        let rotate = (t * zInv).isNegative
        let xr = FieldElement.select(x, iy0, rotate)
        var yr = FieldElement.select(y, ix0, rotate)
        let denInv = FieldElement.select(den2, enchanted, rotate)
        yr = FieldElement.select(yr, -yr, (xr * zInv).isNegative)
        let s = (denInv * (z - yr)).abs
        return s.bytes
    }

    public var hex: String { Hex.encode(bytes) }

    /// RFC 9496 §4.5 EQUALS.
    public func equals(_ other: RistrettoPoint) -> Bool {
        (x * other.y).equals(y * other.x) | (y * other.y).equals(x * other.x) == 1
    }

    public static func + (p: RistrettoPoint, q: RistrettoPoint) -> RistrettoPoint {
        let a = (p.y - p.x) * (q.y - q.x)
        let b = (p.x + p.y) * (q.x + q.y)
        let c = p.t * q.t * FieldElement.d2
        var d = p.z * q.z
        d = d + d
        let e = b - a
        let f = d - c
        let g = d + c
        let h = b + a
        return RistrettoPoint(x: e * f, y: h * g, z: g * f, t: e * h)
    }

    public static prefix func - (p: RistrettoPoint) -> RistrettoPoint {
        RistrettoPoint(x: -p.x, y: p.y, z: p.z, t: -p.t)
    }

    public static func - (p: RistrettoPoint, q: RistrettoPoint) -> RistrettoPoint { p + (-q) }

    static func cswap(_ p: inout RistrettoPoint, _ q: inout RistrettoPoint, _ bit: Int64) {
        FieldElement.cswap(&p.x, &q.x, bit)
        FieldElement.cswap(&p.y, &q.y, bit)
        FieldElement.cswap(&p.z, &q.z, bit)
        FieldElement.cswap(&p.t, &q.t, bit)
    }

    /// `self` when `bit` is 0, `other` when it is 1, in constant time.
    static func select(_ a: RistrettoPoint, _ b: RistrettoPoint, _ bit: Int64) -> RistrettoPoint {
        var p = a
        var q = b
        cswap(&p, &q, bit)
        return p
    }

    /// 1 when `a == b` (both small and non-negative), else 0, without a branch.
    static func eqBit(_ a: Int, _ b: Int) -> Int64 { ((Int64(a ^ b) &- 1) >> 63) & 1 }

    /// The table `[0·P, 1·P, …, 15·P]`.
    static func table(_ p: RistrettoPoint) -> [RistrettoPoint] {
        var t = [RistrettoPoint.identity, p]
        for _ in 2..<16 { t.append(t[t.count - 1] + p) }
        return t
    }

    /// `t[index]`, reading every entry, in constant time.
    static func lookup(_ t: [RistrettoPoint], _ index: Int) -> RistrettoPoint {
        var r = RistrettoPoint.identity
        for j in 0..<16 { r = select(r, t[j], eqBit(j, index)) }
        return r
    }

    /// The scalar's 64 little-endian 4-bit digits.
    static func nibbles(_ k: Scalar) -> [Int] {
        var out = [Int](repeating: 0, count: 64)
        for i in 0..<32 {
            out[2 * i] = Int(k.bytes[i] & 0x0f)
            out[2 * i + 1] = Int(k.bytes[i] >> 4)
        }
        return out
    }

    /// `j · 16^i · B` for every digit position i and digit j: the fixed-base comb.
    static let baseTable: [[RistrettoPoint]] = {
        var rows: [[RistrettoPoint]] = []
        var p = RistrettoPoint.base
        for _ in 0..<64 {
            let row = table(p)
            rows.append(row)
            p = row[15] + p
        }
        return rows
    }()

    /// `k · B`: one constant-time table read and one addition per digit.
    static func mulBase(_ k: Scalar) -> RistrettoPoint {
        var acc = RistrettoPoint.identity
        for (i, digit) in nibbles(k).enumerated() { acc = acc + lookup(baseTable[i], digit) }
        return acc
    }

    /// `k · self`: a fixed 4-bit window over all 64 digits, constant time in `k`.
    public func multiply(_ k: Scalar) -> RistrettoPoint {
        if isBase { return RistrettoPoint.mulBase(k) }
        let t = RistrettoPoint.table(self)
        let digits = RistrettoPoint.nibbles(k)
        var acc = RistrettoPoint.identity
        for i in stride(from: 63, through: 0, by: -1) {
            acc = acc + acc
            acc = acc + acc
            acc = acc + acc
            acc = acc + acc
            acc = acc + RistrettoPoint.lookup(t, digits[i])
        }
        return acc
    }

    public static func * (k: Scalar, p: RistrettoPoint) -> RistrettoPoint { p.multiply(k) }
}

/// An integer mod ℓ = 2^252 + 27742317777372353535851937790883648493, canonical, 32 bytes little-endian.
public struct Scalar: Equatable, Hashable, Sendable {
    public let bytes: [UInt8]

    static let order: [Int64] = [
        0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde, 0x14,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x10,
    ]

    public static let zero = Scalar(reducing: [UInt8](repeating: 0, count: 32))
    public static let one = Scalar(UInt64(1))
    /// ℓ - 1, i.e. -1.
    static let minusOne: Scalar = Scalar(unchecked: order.enumerated().map { i, b in UInt8(i == 0 ? b - 1 : b) })

    init(unchecked bytes: [UInt8]) { self.bytes = bytes }

    /// Any little-endian byte string (32 or 64 bytes), reduced mod ℓ.
    public init(reducing input: [UInt8]) {
        var x = [Int64](repeating: 0, count: 64)
        for (i, b) in input.enumerated() where i < 64 { x[i] = Int64(b) }
        bytes = Scalar.modL(&x)
    }

    public init(_ n: UInt64) {
        var b = [UInt8](repeating: 0, count: 32)
        for i in 0..<8 { b[i] = UInt8(truncatingIfNeeded: n >> (8 * UInt64(i))) }
        self.init(reducing: b)
    }

    /// A canonical encoding only: refuses anything ≥ ℓ.
    public init(canonical b: [UInt8]) throws {
        guard b.count == 32 else { throw CurveError.invalidScalar }
        // Compare with ℓ from the top byte down.
        var lessThan = false
        for i in stride(from: 31, through: 0, by: -1) {
            let l = UInt8(Scalar.order[i])
            if b[i] < l { lessThan = true; break }
            if b[i] > l { break }
        }
        guard lessThan else { throw CurveError.invalidScalar }
        bytes = b
    }

    public init(hex: String) throws {
        guard let b = Hex.decode(hex) else { throw CurveError.invalidScalar }
        try self.init(canonical: b)
    }

    public var hex: String { Hex.encode(bytes) }

    public var isZero: Bool { bytes.allSatisfy { $0 == 0 } }

    /// TweetNaCl `modL`: reduce a 64-limb little-endian integer mod ℓ.
    private static func modL(_ x: inout [Int64]) -> [UInt8] {
        var carry: Int64 = 0
        for i in stride(from: 63, through: 32, by: -1) {
            carry = 0
            var j = i - 32
            while j < i - 12 {
                x[j] &+= carry &- 16 &* x[i] &* order[j - (i - 32)]
                carry = (x[j] &+ 128) >> 8
                x[j] &-= carry &<< 8
                j += 1
            }
            x[j] &+= carry
            x[i] = 0
        }
        carry = 0
        for j in 0..<32 {
            x[j] &+= carry &- (x[31] >> 4) &* order[j]
            carry = x[j] >> 8
            x[j] &= 255
        }
        for j in 0..<32 { x[j] &-= carry &* order[j] }
        var r = [UInt8](repeating: 0, count: 32)
        for i in 0..<32 {
            x[i + 1] &+= x[i] >> 8
            r[i] = UInt8(truncatingIfNeeded: x[i] & 255)
        }
        return r
    }

    /// `a · b + c mod ℓ`.
    static func mulAdd(_ a: Scalar, _ b: Scalar, _ c: Scalar) -> Scalar {
        var x = [Int64](repeating: 0, count: 64)
        for i in 0..<32 { x[i] = Int64(c.bytes[i]) }
        for i in 0..<32 {
            let ai = Int64(a.bytes[i])
            for j in 0..<32 { x[i + j] &+= ai &* Int64(b.bytes[j]) }
        }
        return Scalar(unchecked: modL(&x))
    }

    public static func + (a: Scalar, b: Scalar) -> Scalar { mulAdd(a, one, b) }
    public static func * (a: Scalar, b: Scalar) -> Scalar { mulAdd(a, b, zero) }
    public static prefix func - (a: Scalar) -> Scalar { mulAdd(a, minusOne, zero) }
    public static func - (a: Scalar, b: Scalar) -> Scalar { a + (-b) }

    /// a^(ℓ-2): the inverse of a non-zero scalar (Fermat). The exponent is public.
    public var inverse: Scalar {
        var exponent = Scalar.order.map { UInt8($0) }
        exponent[0] -= 2
        var result = Scalar.one
        for i in stride(from: 255, through: 0, by: -1) {
            result = result * result
            if (exponent[i / 8] >> UInt8(i & 7)) & 1 == 1 { result = result * self }
        }
        return result
    }
}

public enum CurveError: Error, Equatable {
    case invalidPoint
    case invalidScalar
}

/// Lower-case hex, both ways.
public enum Hex {
    public static func encode<S: Sequence>(_ bytes: S) -> String where S.Element == UInt8 {
        let digits = Array("0123456789abcdef".utf8)
        var out = [UInt8]()
        for b in bytes {
            out.append(digits[Int(b >> 4)])
            out.append(digits[Int(b & 0x0f)])
        }
        return String(decoding: out, as: UTF8.self)
    }

    public static func decode(_ s: String) -> [UInt8]? {
        let chars = Array(s.utf8)
        guard chars.count % 2 == 0 else { return nil }
        var out = [UInt8]()
        out.reserveCapacity(chars.count / 2)
        var i = 0
        while i < chars.count {
            guard let hi = nibble(chars[i]), let lo = nibble(chars[i + 1]) else { return nil }
            out.append(hi << 4 | lo)
            i += 2
        }
        return out
    }

    private static func nibble(_ c: UInt8) -> UInt8? {
        switch c {
        case 0x30...0x39: return c - 0x30
        case 0x61...0x66: return c - 0x61 + 10
        case 0x41...0x46: return c - 0x41 + 10
        default: return nil
        }
    }
}
