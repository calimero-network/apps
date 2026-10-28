package network.calimero.vote.crypto

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

/**
 * Pins this implementation to the web client byte for byte.
 *
 * `mobile/test-vectors/vectors.json` is written by `generate.mjs`, which runs the web app's own
 * `protocol.ts` from fixed seeds. The same seeds go through this port here, and every point,
 * scalar, proof, digest, share, partial and count must come out identical. iOS `VectorTests`
 * replays the same file.
 */
class VectorTest {
    companion object {
        val vectors: JsonObject by lazy {
            val path = System.getProperty("vote.vectors") ?: "../../test-vectors/vectors.json"
            Json.parseToJsonElement(File(path).readText()).jsonObject
        }
    }

    private val v get() = vectors
    private val pollId get() = v.str("poll_id")
    private val trustees get() = v.arr("trustees").map { it.s }
    private val threshold get() = v["threshold"]!!.jsonPrimitive.int

    private fun JsonObject.str(k: String) = this[k]!!.jsonPrimitive.content

    private fun JsonObject.arr(k: String) = this[k]!!.jsonArray

    private fun JsonObject.obj(k: String) = this[k]!!.jsonObject

    private val JsonElement.s get() = jsonPrimitive.content
    private val JsonElement.o get() = jsonObject

    private fun point(e: JsonElement) = RistrettoPoint.fromHex(e.s)

    private fun scalar(e: JsonElement) = Scalar.fromHex(e.s)

    private fun branch(e: JsonElement) = Branch(scalar(e.o["c"]!!), scalar(e.o["z"]!!))

    private fun wire(b: Branch) = mapOf("c" to b.c.hex(), "z" to b.z.hex())

    private fun wire(e: JsonElement) = mapOf("c" to e.o.str("c"), "z" to e.o.str("z"))

    private fun dealing(e: JsonElement) =
        Dealing(
            e.o.arr("commitments").map { point(it) },
            branch(e.o["proof"]!!),
            e.o.arr("shares").map { EncryptedShare(point(it.o["r"]!!), scalar(it.o["v"]!!)) },
        )

    private fun ballot(e: JsonElement) =
        Ballot(
            e.o.arr("choices").map { ch ->
                EncryptedChoice(Ciphertext(point(ch.o["a"]!!), point(ch.o["b"]!!)), ch.o.arr("proof").map { branch(it) })
            },
            e.o.arr("sum_proof").map { branch(it) },
        )

    private fun rules(e: JsonElement) = Rules(e.o["options"]!!.jsonPrimitive.int, e.o["min"]!!.jsonPrimitive.int, e.o["max"]!!.jsonPrimitive.int)

    // ── primitives ─────────────────────────────────────────────────────────

    @Test
    fun `base multiples encode and decode`() {
        var acc = RistrettoPoint.IDENTITY
        v.arr("base_multiples").forEachIndexed { k, expected ->
            assertEquals("$k·B", expected.s, acc.hex())
            val decoded = RistrettoPoint.fromHex(expected.s)
            assertEquals(expected.s, decoded.hex())
            assertTrue(decoded.equalsPoint(acc))
            assertEquals(expected.s, RistrettoPoint.BASE.multiply(Scalar.of(k.toLong())).hex())
            acc += RistrettoPoint.BASE
        }
    }

    @Test
    fun `decoding accepts and refuses exactly as the web`() {
        for (c in v.arr("point_decoding")) {
            val ok = runCatching { RistrettoPoint.fromHex(c.o.str("hex")) }.isSuccess
            assertEquals(c.o.str("hex"), c.o["valid"]!!.jsonPrimitive.boolean, ok)
        }
        for (c in v.arr("scalar_decoding")) {
            val ok = runCatching { Scalar.fromHex(c.o.str("hex")) }.isSuccess
            assertEquals(c.o.str("hex"), c.o["valid"]!!.jsonPrimitive.boolean, ok)
        }
    }

    @Test
    fun `scalar arithmetic and multiplication`() {
        for (c in v.arr("scalar_arithmetic")) {
            val a = scalar(c.o["a"]!!)
            val b = scalar(c.o["b"]!!)
            assertEquals(c.o.str("sum"), (a + b).hex())
            assertEquals(c.o.str("difference"), (a - b).hex())
            assertEquals(c.o.str("product"), (a * b).hex())
            assertEquals(Scalar.ONE, a * a.inverse())
            val aB = RistrettoPoint.BASE.multiply(a)
            assertEquals(c.o.str("a_times_base"), aB.hex())
            assertEquals(c.o.str("b_times_a_base"), aB.multiply(b).hex())
        }
    }

    @Test
    fun `hashes, rng and lagrange`() {
        for (h in v.arr("hashes")) {
            val parts = h.o.arr("parts").map { it.s.toByteArray(Charsets.UTF_8) }
            assertEquals(h.o.str("scalar"), VoteProtocol.hashToScalar(h.o.str("domain"), parts).hex())
            assertEquals(h.o.str("digest"), Hex.encode(VoteProtocol.hashToDigest(h.o.str("domain"), parts)))
        }
        val rng = v.obj("rng")
        val draw = VoteProtocol.seededRng(rng.str("seed"))
        assertEquals(rng.arr("first").map { it.s }, List(4) { draw().hex() })
        for (l in v.arr("lagrange")) {
            val set = l.o.arr("set").map { it.jsonPrimitive.int }
            assertEquals(l.o.arr("coefficients").map { it.s }, set.map { VoteProtocol.lagrangeAtZero(it, set).hex() })
        }
    }

    // ── a whole poll ───────────────────────────────────────────────────────

    @Test
    fun `key ceremony`() {
        val keys =
            v.arr("transport").map { t ->
                val trustee = t.o.str("trustee")
                val rng = VoteProtocol.seededRng(t.o.str("seed"))
                val e = rng()
                assertEquals(t.o.str("secret"), e.hex())
                val (key, proof) = VoteProtocol.makeTransportKey(pollId, trustee, e, rng)
                assertEquals(t.o.str("key"), key.hex())
                assertEquals(wire(t.o["proof"]!!), wire(proof))
                assertTrue(VoteProtocol.verifyTransportKey(pollId, trustee, key, proof))
                assertFalse(VoteProtocol.verifyTransportKey(pollId, "someone-else", key, proof))
                key
            }
        val dealings =
            v.arr("dealings").map { d ->
                val dealer = d.o.str("dealer")
                val mine = VoteProtocol.deal(pollId, dealer, threshold, keys, VoteProtocol.seededRng(d.o.str("seed")))
                val expected = dealing(d.o["dealing"]!!)
                assertEquals(expected.commitments.map { it.hex() }, mine.commitments.map { it.hex() })
                assertEquals(expected.proof, mine.proof)
                assertEquals(expected.shares.map { it.r.hex() }, mine.shares.map { it.r.hex() })
                assertEquals(expected.shares.map { it.v }, mine.shares.map { it.v })
                VoteProtocol.verifyDealing(pollId, dealer, threshold, trustees.size, mine)
                mine
            }
        assertEquals(v.str("election_key"), VoteProtocol.jointKey(dealings).hex())
        val transport = v.arr("transport")
        val shares = v.arr("shares")
        trustees.indices.forEach { j ->
            val e = scalar(transport[j].o["secret"]!!)
            var x = Scalar.ZERO
            dealings.forEachIndexed { i, d ->
                val s = VoteProtocol.openShare(pollId, trustees[i], j + 1, e, d)
                assertNotNull(s)
                assertEquals(shares[j].jsonArray[i].s, s!!.hex())
                x += s
            }
            assertEquals(v.arr("combined_secrets")[j].s, x.hex())
            assertEquals(v.arr("verification_keys")[j].s, VoteProtocol.verificationKey(dealings, j + 1).hex())
        }
    }

    @Test
    fun complaint() {
        val c = v.obj("complaint")
        val d = dealing(c["dealing"]!!)
        val index = c["index"]!!.jsonPrimitive.int
        val transport = v.arr("transport")
        val e = scalar(transport[index - 1].o["secret"]!!)
        val recipient = c.str("recipient")
        val dealer = c.str("dealer")
        assertNull(VoteProtocol.openShare(pollId, dealer, index, e, d))
        val (secret, proof) = VoteProtocol.makeComplaint(pollId, recipient, dealer, index, e, d, VoteProtocol.seededRng(c.str("seed")))
        assertEquals(c.str("secret"), secret.hex())
        assertEquals(wire(c["proof"]!!), wire(proof))
        val key = point(transport[index - 1].o["key"]!!)
        assertTrue(VoteProtocol.complaintIsValid(pollId, recipient, dealer, index, key, d, secret, proof))
        val other = point(transport[1].o["key"]!!)
        assertFalse(VoteProtocol.complaintIsValid(pollId, recipient, dealer, index, other, d, secret, proof))
        val honest = dealing(v.arr("dealings")[2].o["dealing"]!!)
        val (s2, p2) = VoteProtocol.makeComplaint(pollId, recipient, dealer, index, e, honest, VoteProtocol.seededRng("x"))
        assertFalse(VoteProtocol.complaintIsValid(pollId, recipient, dealer, index, key, honest, s2, p2))
    }

    @Test
    fun `ballots, partials and counts`() {
        val pk = point(v["election_key"]!!)
        val r = rules(v["rules"]!!)
        var agg = List(r.options) { Ciphertext.ZERO }
        val ballots = v.arr("ballots")
        for (b in ballots) {
            val voter = b.o.str("voter")
            val selection = b.o.arr("selection").map { it.jsonPrimitive.boolean }
            val mine = VoteProtocol.castBallot(pk, pollId, voter, r, selection, VoteProtocol.seededRng(b.o.str("seed")))
            val theirs = ballot(b.o["ballot"]!!)
            assertEquals(theirs.choices.map { it.ct.a.hex() }, mine.choices.map { it.ct.a.hex() })
            assertEquals(theirs.choices.map { it.ct.b.hex() }, mine.choices.map { it.ct.b.hex() })
            assertEquals(theirs.choices.map { it.proof }, mine.choices.map { it.proof })
            assertEquals(theirs.sumProof, mine.sumProof)
            assertEquals(b.o.str("digest"), VoteProtocol.ballotDigest(pollId, voter, mine))
            VoteProtocol.verifyBallot(pk, pollId, voter, r, theirs)
            try {
                VoteProtocol.verifyBallot(pk, pollId, "someone-else", r, theirs)
                fail("a ballot replayed under another voter must not verify")
            } catch (_: VoteCryptoException) {
            }
            agg = agg.zip(theirs.choices) { ct, ch -> ct + ch.ct }
        }
        val aggregate = v.arr("aggregate")
        assertEquals(aggregate.map { it.o.str("a") }, agg.map { it.a.hex() })
        assertEquals(aggregate.map { it.o.str("b") }, agg.map { it.b.hex() })

        val picked = List(r.options) { mutableListOf<Pair<Int, RistrettoPoint>>() }
        for (p in v.arr("partials")) {
            val index = p.o["index"]!!.jsonPrimitive.int
            val trustee = p.o.str("trustee")
            val x = scalar(v.arr("combined_secrets")[index - 1])
            val vkey = point(v.arr("verification_keys")[index - 1])
            val rng = VoteProtocol.seededRng(p.o.str("seed"))
            val options = p.o.arr("options")
            agg.forEachIndexed { j, ct ->
                val (d, proof) = VoteProtocol.partialDecrypt(pollId, trustee, j, x, ct.a, rng)
                assertEquals(options[j].o.str("d"), d.hex())
                assertEquals(wire(options[j].o["proof"]!!), wire(proof))
                assertTrue(VoteProtocol.verifyPartial(pollId, trustee, j, vkey, ct.a, d, proof))
                picked[j] += Pair(index, d)
            }
        }
        val counts = agg.mapIndexed { j, ct -> VoteProtocol.openCount(ct, picked[j], ballots.size) }
        assertEquals(v.arr("counts").map { it.jsonPrimitive.int }, counts)
    }

    @Test
    fun `single choice ballots`() {
        val pk = point(v["election_key"]!!)
        val r = rules(v["single_rules"]!!)
        for (b in v.arr("single_ballots")) {
            val voter = b.o.str("voter")
            val selection = b.o.arr("selection").map { it.jsonPrimitive.boolean }
            val mine = VoteProtocol.castBallot(pk, pollId, voter, r, selection, VoteProtocol.seededRng(b.o.str("seed")))
            assertEquals(b.o.str("digest"), VoteProtocol.ballotDigest(pollId, voter, mine))
            VoteProtocol.verifyBallot(pk, pollId, voter, r, ballot(b.o["ballot"]!!))
        }
        assertTrue(
            runCatching {
                VoteProtocol.castBallot(pk, pollId, "v", r, listOf(true, true, false, false), VoteProtocol.secureRng)
            }.isFailure,
        )
    }

    @Test
    fun `secure random ballot verifies`() {
        val pk = point(v["election_key"]!!)
        val r = Rules(3, 1, 1)
        val b = VoteProtocol.castBallot(pk, pollId, "me", r, listOf(false, true, false), VoteProtocol.secureRng)
        VoteProtocol.verifyBallot(pk, pollId, "me", r, b)
    }
}
