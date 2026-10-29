package network.calimero.vote.crypto

import java.security.MessageDigest
import java.security.SecureRandom

// mero-vote's ballot cryptography: a line-for-line port of the web client's
// `app/src/crypto/protocol.ts`, itself a mirror of the contract's Rust
// (`logic/crates/crypto`). Exponential ElGamal on ristretto255, CDS94
// membership proofs, Chaum–Pedersen DLEQ, Schnorr proofs of knowledge,
// Pedersen DKG with Feldman commitments, Fiat–Shamir over SHA-512.
//
// The order in which every prover draws from `rng` is part of the wire
// format; keep it identical to protocol.ts. iOS `VoteProtocol.swift` is the
// same code.

typealias Rng = () -> Scalar

data class Branch(
    val c: Scalar,
    val z: Scalar,
)

data class Ciphertext(
    val a: RistrettoPoint,
    val b: RistrettoPoint,
) {
    operator fun plus(o: Ciphertext) = Ciphertext(a + o.a, b + o.b)

    companion object {
        val ZERO = Ciphertext(RistrettoPoint.IDENTITY, RistrettoPoint.IDENTITY)
    }
}

data class EncryptedChoice(
    val ct: Ciphertext,
    val proof: List<Branch>,
)

data class Ballot(
    val choices: List<EncryptedChoice>,
    val sumProof: List<Branch>,
)

data class EncryptedShare(
    val r: RistrettoPoint,
    val v: Scalar,
)

data class Dealing(
    val commitments: List<RistrettoPoint>,
    val proof: Branch,
    val shares: List<EncryptedShare>,
)

/** A poll's choice rules: how many options, and how many a voter may pick. */
data class Rules(
    val options: Int,
    val min: Int,
    val max: Int,
)

class VoteCryptoException(
    message: String,
) : IllegalArgumentException(message)

@Suppress("TooManyFunctions", "LongParameterList", "MagicNumber")
object VoteProtocol {
    const val TAG = "mero-vote/v2/"
    const val MAX_OPTIONS = 16

    private val g get() = RistrettoPoint.BASE
    private val random = SecureRandom()

    // ── bytes ──────────────────────────────────────────────────────────────

    internal fun utf8(s: String): ByteArray = s.toByteArray(Charsets.UTF_8)

    internal fun u32le(n: Int): ByteArray = ByteArray(4) { (n ushr (8 * it)).toByte() }

    internal fun u64le(n: Long): ByteArray = ByteArray(8) { (n ushr (8 * it)).toByte() }

    // ── hashing ────────────────────────────────────────────────────────────

    internal fun framed(
        domain: String,
        parts: List<ByteArray>,
    ): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        out.write(utf8(TAG))
        out.write(utf8(domain))
        out.write(0)
        for (p in parts) {
            out.write(u32le(p.size))
            out.write(p)
        }
        return out.toByteArray()
    }

    fun hashToScalar(
        domain: String,
        parts: List<ByteArray>,
    ): Scalar =
        Scalar.reducing(MessageDigest.getInstance("SHA-512").digest(framed(domain, parts)))

    fun hashToDigest(
        domain: String,
        parts: List<ByteArray>,
    ): ByteArray =
        MessageDigest.getInstance("SHA-256").digest(framed(domain, parts))

    fun sha256Hex(text: String): String = Hex.encode(MessageDigest.getInstance("SHA-256").digest(utf8(text)))

    /** Deterministic stream, for tests only. Mirrors `seededRng`. */
    fun seededRng(seed: String): Rng {
        val s = utf8(seed)
        var k = 0L
        return { hashToScalar("test-rng", listOf(s, u64le(k++))) }
    }

    /** 64 uniform bytes from the system CSPRNG, reduced mod ℓ (bias < 2⁻²⁵⁰). */
    val secureRng: Rng = {
        val b = ByteArray(64)
        random.nextBytes(b)
        Scalar.reducing(b)
    }

    // ── ElGamal ────────────────────────────────────────────────────────────

    fun encrypt(
        pk: RistrettoPoint,
        m: Scalar,
        r: Scalar,
    ) = Ciphertext(g.multiply(r), g.multiply(m) + pk.multiply(r))

    fun smallDlog(
        target: RistrettoPoint,
        max: Int,
    ): Int? {
        var acc = RistrettoPoint.IDENTITY
        for (m in 0..maxOf(max, 0)) {
            if (acc.equalsPoint(target)) return m
            acc += g
        }
        return null
    }

    // ── proofs ─────────────────────────────────────────────────────────────

    private fun membershipChallenge(
        domain: String,
        ctx: List<ByteArray>,
        pk: RistrettoPoint,
        ct: Ciphertext,
        values: List<Long>,
        commitments: List<Pair<RistrettoPoint, RistrettoPoint>>,
    ): Scalar {
        val parts = ctx.toMutableList()
        parts += listOf(pk.bytes(), ct.a.bytes(), ct.b.bytes())
        for (v in values) parts += u64le(v)
        for ((t1, t2) in commitments) parts += listOf(t1.bytes(), t2.bytes())
        return hashToScalar(domain, parts)
    }

    /** CDS94 OR-proof. rng order: (cᵢ, zᵢ) for each i ≠ real, then w. */
    fun proveMembership(
        domain: String,
        ctx: List<ByteArray>,
        pk: RistrettoPoint,
        ct: Ciphertext,
        values: List<Long>,
        real: Int,
        r: Scalar,
        rng: Rng,
    ): List<Branch> {
        val n = values.size
        val branches = MutableList(n) { Branch(Scalar.ZERO, Scalar.ZERO) }
        val commitments = MutableList(n) { Pair(RistrettoPoint.IDENTITY, RistrettoPoint.IDENTITY) }
        for (i in 0 until n) {
            if (i == real) continue
            val c = rng()
            val z = rng()
            val shifted = ct.b - g.multiply(Scalar.of(values[i]))
            commitments[i] = Pair(g.multiply(z) - ct.a.multiply(c), pk.multiply(z) - shifted.multiply(c))
            branches[i] = Branch(c, z)
        }
        val w = rng()
        commitments[real] = Pair(g.multiply(w), pk.multiply(w))
        val challenge = membershipChallenge(domain, ctx, pk, ct, values, commitments)
        var others = Scalar.ZERO
        for (i in 0 until n) if (i != real) others += branches[i].c
        val cReal = challenge - others
        branches[real] = Branch(cReal, w + cReal * r)
        return branches
    }

    fun verifyMembership(
        domain: String,
        ctx: List<ByteArray>,
        pk: RistrettoPoint,
        ct: Ciphertext,
        values: List<Long>,
        proof: List<Branch>,
    ): Boolean {
        if (values.isEmpty() || proof.size != values.size) return false
        var sum = Scalar.ZERO
        val commitments =
            proof.mapIndexed { i, br ->
                val shifted = ct.b - g.multiply(Scalar.of(values[i]))
                sum += br.c
                Pair(g.multiply(br.z) - ct.a.multiply(br.c), pk.multiply(br.z) - shifted.multiply(br.c))
            }
        return sum == membershipChallenge(domain, ctx, pk, ct, values, commitments)
    }

    private fun dleqChallenge(
        domain: String,
        ctx: List<ByteArray>,
        base: RistrettoPoint,
        pubG: RistrettoPoint,
        pubBase: RistrettoPoint,
        t1: RistrettoPoint,
        t2: RistrettoPoint,
    ): Scalar = hashToScalar(domain, ctx + listOf(pubG.bytes(), base.bytes(), pubBase.bytes(), t1.bytes(), t2.bytes()))

    /** Chaum–Pedersen DLEQ. rng is drawn once. */
    fun proveDleq(
        domain: String,
        ctx: List<ByteArray>,
        base: RistrettoPoint,
        x: Scalar,
        rng: Rng,
    ): Triple<RistrettoPoint, RistrettoPoint, Branch> {
        val pubG = g.multiply(x)
        val pubBase = base.multiply(x)
        val w = rng()
        val c = dleqChallenge(domain, ctx, base, pubG, pubBase, g.multiply(w), base.multiply(w))
        return Triple(pubG, pubBase, Branch(c, w + c * x))
    }

    fun verifyDleq(
        domain: String,
        ctx: List<ByteArray>,
        base: RistrettoPoint,
        pubG: RistrettoPoint,
        pubBase: RistrettoPoint,
        p: Branch,
    ): Boolean {
        val t1 = g.multiply(p.z) - pubG.multiply(p.c)
        val t2 = base.multiply(p.z) - pubBase.multiply(p.c)
        return p.c == dleqChallenge(domain, ctx, base, pubG, pubBase, t1, t2)
    }

    /** Schnorr proof of knowledge. rng is drawn once. */
    fun proveKnowledge(
        domain: String,
        ctx: List<ByteArray>,
        x: Scalar,
        rng: Rng,
    ): Pair<RistrettoPoint, Branch> {
        val h = g.multiply(x)
        val w = rng()
        val c = hashToScalar(domain, ctx + listOf(h.bytes(), g.multiply(w).bytes()))
        return Pair(h, Branch(c, w + c * x))
    }

    fun verifyKnowledge(
        domain: String,
        ctx: List<ByteArray>,
        h: RistrettoPoint,
        p: Branch,
    ): Boolean {
        val t = g.multiply(p.z) - h.multiply(p.c)
        return p.c == hashToScalar(domain, ctx + listOf(h.bytes(), t.bytes()))
    }

    // ── ballots ────────────────────────────────────────────────────────────

    fun checkRules(r: Rules) {
        if (r.options < 2 || r.options > MAX_OPTIONS) throw VoteCryptoException("a poll needs 2..=16 options")
        if (r.min > r.max || r.max > r.options || r.max == 0) throw VoteCryptoException("bad choice bounds")
    }

    private fun sumValues(r: Rules): List<Long> = (r.min..r.max).map { it.toLong() }

    private val BINARY = listOf(0L, 1L)

    /** rng order: per option, r then that option's proof draws; then the sum proof's. */
    fun castBallot(
        pk: RistrettoPoint,
        pollId: String,
        voter: String,
        rules: Rules,
        selections: List<Boolean>,
        rng: Rng,
    ): Ballot {
        checkRules(rules)
        if (selections.size != rules.options) throw VoteCryptoException("one selection per option")
        val chosen = selections.count { it }
        if (chosen < rules.min || chosen > rules.max) throw VoteCryptoException("selection count outside the poll's bounds")
        val pkB = pk.bytes()
        val poll = utf8(pollId)
        val who = utf8(voter)
        val choices = mutableListOf<EncryptedChoice>()
        var totalR = Scalar.ZERO
        var total = Ciphertext.ZERO
        selections.forEachIndexed { i, sel ->
            val m = if (sel) 1L else 0L
            val r = rng()
            val ct = encrypt(pk, Scalar.of(m), r)
            val proof = proveMembership("choice", listOf(poll, who, pkB, u32le(i)), pk, ct, BINARY, m.toInt(), r, rng)
            totalR += r
            total += ct
            choices += EncryptedChoice(ct, proof)
        }
        val sumProof = proveMembership("sum", listOf(poll, who, pkB), pk, total, sumValues(rules), chosen - rules.min, totalR, rng)
        return Ballot(choices, sumProof)
    }

    /** Throws with the reason a ballot must not be counted. */
    fun verifyBallot(
        pk: RistrettoPoint,
        pollId: String,
        voter: String,
        rules: Rules,
        ballot: Ballot,
    ) {
        checkRules(rules)
        if (ballot.choices.size != rules.options) throw VoteCryptoException("one ciphertext per option")
        val pkB = pk.bytes()
        val poll = utf8(pollId)
        val who = utf8(voter)
        var total = Ciphertext.ZERO
        ballot.choices.forEachIndexed { i, ch ->
            if (!verifyMembership("choice", listOf(poll, who, pkB, u32le(i)), pk, ch.ct, BINARY, ch.proof)) {
                throw VoteCryptoException("an option is not an encryption of 0 or 1")
            }
            total += ch.ct
        }
        if (!verifyMembership("sum", listOf(poll, who, pkB), pk, total, sumValues(rules), ballot.sumProof)) {
            throw VoteCryptoException("the number of options chosen is outside the bounds")
        }
    }

    fun ballotDigest(
        pollId: String,
        voter: String,
        ballot: Ballot,
    ): String {
        val parts = mutableListOf(utf8(pollId), utf8(voter), u32le(ballot.choices.size), u32le(ballot.sumProof.size))
        for (ch in ballot.choices) {
            parts += listOf(ch.ct.a.bytes(), ch.ct.b.bytes())
            for (br in ch.proof) parts += listOf(br.c.bytes(), br.z.bytes())
        }
        for (br in ballot.sumProof) parts += listOf(br.c.bytes(), br.z.bytes())
        return Hex.encode(hashToDigest("ballot", parts))
    }

    // ── distributed key generation ─────────────────────────────────────────

    fun makeTransportKey(
        pollId: String,
        trustee: String,
        e: Scalar,
        rng: Rng,
    ): Pair<RistrettoPoint, Branch> =
        proveKnowledge("transport", listOf(utf8(pollId), utf8(trustee)), e, rng)

    fun verifyTransportKey(
        pollId: String,
        trustee: String,
        key: RistrettoPoint,
        proof: Branch,
    ): Boolean =
        verifyKnowledge("transport", listOf(utf8(pollId), utf8(trustee)), key, proof)

    private fun shareMask(
        pollId: String,
        dealer: String,
        index: Int,
        r: RistrettoPoint,
        secret: RistrettoPoint,
    ): Scalar =
        hashToScalar("sharemask", listOf(utf8(pollId), utf8(dealer), u32le(index), r.bytes(), secret.bytes()))

    fun evalCommitments(
        commitments: List<RistrettoPoint>,
        x: Int,
    ): RistrettoPoint {
        var acc = RistrettoPoint.IDENTITY
        var pow = Scalar.ONE
        val xs = Scalar.of(x.toLong())
        for (c in commitments) {
            acc += c.multiply(pow)
            pow *= xs
        }
        return acc
    }

    /** rng order: `threshold` coefficients, the proof nonce, then one k per recipient. */
    fun deal(
        pollId: String,
        dealer: String,
        threshold: Int,
        recipients: List<RistrettoPoint>,
        rng: Rng,
    ): Dealing {
        if (threshold < 1 || threshold > recipients.size) throw VoteCryptoException("threshold must be 1..=trustees")
        val coeffs = List(threshold) { rng() }
        val (_, proof) = proveKnowledge("keyshare", listOf(utf8(pollId), utf8(dealer)), coeffs[0], rng)
        val commitments = coeffs.map { g.multiply(it) }
        val shares =
            recipients.mapIndexed { pos, e ->
                val index = pos + 1
                val x = Scalar.of(index.toLong())
                var f = Scalar.ZERO
                for (a in coeffs.asReversed()) f = f * x + a
                val k = rng()
                val r = g.multiply(k)
                EncryptedShare(r, f + shareMask(pollId, dealer, index, r, e.multiply(k)))
            }
        return Dealing(commitments, proof, shares)
    }

    fun verifyDealing(
        pollId: String,
        dealer: String,
        threshold: Int,
        trustees: Int,
        d: Dealing,
    ) {
        if (threshold < 1 || d.commitments.size != threshold || d.shares.size != trustees) {
            throw VoteCryptoException("a dealing has t commitments and one share per trustee")
        }
        if (!verifyKnowledge("keyshare", listOf(utf8(pollId), utf8(dealer)), d.commitments[0], d.proof)) {
            throw VoteCryptoException("dealing: no proof of knowledge of the constant term")
        }
    }

    /** Decrypt and check share `index`; null means the dealer cheated this recipient. */
    fun openShare(
        pollId: String,
        dealer: String,
        index: Int,
        e: Scalar,
        d: Dealing,
    ): Scalar? {
        val enc = d.shares.getOrNull(index - 1) ?: return null
        val s = enc.v - shareMask(pollId, dealer, index, enc.r, enc.r.multiply(e))
        return if (g.multiply(s).equalsPoint(evalCommitments(d.commitments, index))) s else null
    }

    fun makeComplaint(
        pollId: String,
        recipient: String,
        dealer: String,
        index: Int,
        e: Scalar,
        d: Dealing,
        rng: Rng,
    ): Pair<RistrettoPoint, Branch> {
        val enc = d.shares.getOrNull(index - 1) ?: throw VoteCryptoException("no such share")
        val (_, secret, proof) = proveDleq("complaint", listOf(utf8(pollId), utf8(recipient), utf8(dealer)), enc.r, e, rng)
        return Pair(secret, proof)
    }

    fun complaintIsValid(
        pollId: String,
        recipient: String,
        dealer: String,
        index: Int,
        transport: RistrettoPoint,
        d: Dealing,
        secret: RistrettoPoint,
        proof: Branch,
    ): Boolean {
        val enc = d.shares.getOrNull(index - 1) ?: return false
        val ctx = listOf(utf8(pollId), utf8(recipient), utf8(dealer))
        if (!verifyDleq("complaint", ctx, enc.r, transport, secret, proof)) return false
        val s = enc.v - shareMask(pollId, dealer, index, enc.r, secret)
        return !g.multiply(s).equalsPoint(evalCommitments(d.commitments, index))
    }

    fun jointKey(qualified: List<Dealing>): RistrettoPoint =
        qualified.fold(RistrettoPoint.IDENTITY) { acc, d -> acc + d.commitments[0] }

    fun verificationKey(
        qualified: List<Dealing>,
        index: Int,
    ): RistrettoPoint =
        qualified.fold(RistrettoPoint.IDENTITY) { acc, d -> acc + evalCommitments(d.commitments, index) }

    fun lagrangeAtZero(
        index: Int,
        set: List<Int>,
    ): Scalar {
        var num = Scalar.ONE
        var den = Scalar.ONE
        for (m in set) {
            if (m == index) continue
            num *= Scalar.of(m.toLong())
            den *= Scalar.of(m.toLong()) - Scalar.of(index.toLong())
        }
        return num * den.inverse()
    }

    /** Under the trustee's combined key xⱼ. */
    fun partialDecrypt(
        pollId: String,
        trustee: String,
        option: Int,
        x: Scalar,
        aggA: RistrettoPoint,
        rng: Rng,
    ): Pair<RistrettoPoint, Branch> {
        val (_, d, proof) = proveDleq("partial", listOf(utf8(pollId), utf8(trustee), u32le(option)), aggA, x, rng)
        return Pair(d, proof)
    }

    /** `vkey` is the trustee's verificationKey. */
    fun verifyPartial(
        pollId: String,
        trustee: String,
        option: Int,
        vkey: RistrettoPoint,
        aggA: RistrettoPoint,
        d: RistrettoPoint,
        proof: Branch,
    ): Boolean = verifyDleq("partial", listOf(utf8(pollId), utf8(trustee), u32le(option)), aggA, vkey, d, proof)

    /** Combine exactly `t` partials `(index, Dⱼ)` with Lagrange coefficients. */
    fun openCount(
        agg: Ciphertext,
        partials: List<Pair<Int, RistrettoPoint>>,
        max: Int,
    ): Int? {
        val set = partials.map { it.first }
        var mask = RistrettoPoint.IDENTITY
        for ((i, d) in partials) mask += d.multiply(lagrangeAtZero(i, set))
        return smallDlog(agg.b - mask, max)
    }
}
