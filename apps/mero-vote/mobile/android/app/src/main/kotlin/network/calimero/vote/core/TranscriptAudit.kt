package network.calimero.vote.core

import network.calimero.vote.crypto.Ciphertext
import network.calimero.vote.crypto.Dealing
import network.calimero.vote.crypto.Hex
import network.calimero.vote.crypto.RistrettoPoint
import network.calimero.vote.crypto.VoteCryptoException
import network.calimero.vote.crypto.VoteProtocol
import network.calimero.vote.generated.CountedBallot
import network.calimero.vote.generated.Election
import network.calimero.vote.generated.Phase
import network.calimero.vote.generated.PollDefinition
import network.calimero.vote.generated.Transcript

/** One line of an audit: what was checked, whether it held, and the detail. */
data class AuditCheck(
    val name: String,
    val ok: Boolean,
    val detail: String,
)

/** What re-verifying a transcript on this device came to. */
data class LocalAudit(
    val checks: List<AuditCheck>,
    val verified: Boolean,
    val counts: List<ULong>?,
    val digest: String?,
    /** Counts and digest equal what the node reported. */
    val agreesWithNode: Boolean,
)

/**
 * An independent re-count, on this device, from a transcript alone: a port of the web's
 * `crypto/verify.ts`, check for check and word for word (the web says "in this browser", this
 * says "on this device"). (Swift `TranscriptAudit`.)
 */
object TranscriptAudit {
    /** Must equal `transcript_text` in the contract, byte for byte. */
    fun transcriptText(
        pollId: String,
        def: PollDefinition,
        election: Election,
        counted: List<CountedBallot>,
        counts: List<ULong>,
    ): String {
        fun hexUtf8(s: String) = Hex.encode(s.toByteArray(Charsets.UTF_8))
        val out = StringBuilder("mero-vote/v2/transcript\n")
        out.append("poll $pollId\n")
        out.append("title ${hexUtf8(def.title)}\n")
        def.options.forEachIndexed { i, o -> out.append("option $i ${hexUtf8(o)}\n") }
        out.append("rules ${def.options.size} ${def.minChoices} ${def.maxChoices}\n")
        out.append("threshold ${election.threshold} ${def.trustees.size}\n")
        def.trustees.forEachIndexed { i, t -> out.append("trustee ${i + 1} $t\n") }
        for (q in election.qualified) out.append("dealer ${q.dealer} ${q.dealing.commitments.joinToString(" ")}\n")
        for (d in election.disqualified) out.append("disqualified $d\n")
        out.append("key ${election.key}\n")
        for (b in counted) out.append("ballot ${b.voter} ${b.digest}\n")
        counts.forEachIndexed { j, n -> out.append("count $j $n\n") }
        return out.toString()
    }

    fun digest(text: String): String = VoteProtocol.sha256Hex(text)

    @Suppress("LongMethod", "CyclomaticComplexMethod")
    fun verify(t: Transcript): LocalAudit {
        val checks = mutableListOf<AuditCheck>()

        fun push(
            name: String,
            ok: Boolean,
            detail: String,
        ) {
            checks += AuditCheck(name, ok, detail)
        }

        fun done(
            counts: List<ULong>?,
            digest: String?,
        ): LocalAudit {
            val verified = checks.all { it.ok }
            val c = if (verified) counts else null
            val d = if (verified) digest else null
            val node = t.report
            val agrees = node.verified == verified && node.counts == c && node.transcriptDigest == d
            return LocalAudit(checks.toList(), verified, c, d, agrees)
        }

        val def = t.definition
        val rules = VoteWire.rules(def)
        val pollId = t.pollId
        push("protocol", t.protocol == VoteProtocol.TAG, t.protocol)
        val n = def.trustees.size
        val threshold = def.threshold.toInt()

        val election = t.state.election
        if (election == null) {
            push("election key", true, "key ceremony in progress")
            return done(null, null)
        }

        // 1. Dealings and key.
        val dealings = mutableListOf<Dealing>()
        var dealingsOk = election.threshold.toInt() == threshold && election.qualified.size >= threshold
        var last = 0
        for (q in election.qualified) {
            val idx = def.trustees.indexOf(q.dealer) + 1
            if (idx <= last) dealingsOk = false
            last = idx
            attempt {
                val d = VoteWire.dealing(q.dealing)
                VoteProtocol.verifyDealing(pollId, q.dealer, threshold, n, d)
                d
            }.onSuccess { dealings += it }.onFailure { dealingsOk = false }
        }
        push("dealings", dealingsOk, "${election.qualified.size} qualified dealings (threshold $threshold), each proven")
        val keyOk = dealingsOk && VoteProtocol.jointKey(dealings).hex() == election.key
        push("election key", keyOk, "key = sum of qualified constant terms")
        val pk = attempt { VoteWire.point(election.key, "election key") }.getOrNull() ?: return done(null, null)

        // 2. Ballots.
        val closure = t.state.closure
        if (closure == null) {
            push("ballots", true, if (t.state.phase == Phase.Closing) "closing — the count is not sealed yet" else "voting in progress")
            return done(null, null)
        }
        val eligible = { v: String -> def.voters.isEmpty() || v in def.voters }
        var agg = List(rules.options) { Ciphertext.ZERO }
        var valid = 0
        val seen = mutableSetOf<String>()
        for (cb in closure.counted) {
            attempt {
                val tb =
                    t.ballots.firstOrNull { it.voter == cb.voter && it.digest == cb.digest }
                        ?: throw VoteCryptoException("missing")
                if (!eligible(cb.voter) || cb.voter in seen) throw VoteCryptoException("ineligible or duplicate")
                seen += cb.voter
                val ballot = VoteWire.ballot(tb.ballot)
                VoteProtocol.verifyBallot(pk, pollId, cb.voter, rules, ballot)
                if (VoteProtocol.ballotDigest(pollId, cb.voter, ballot) != cb.digest) throw VoteCryptoException("digest")
                agg = agg.zip(ballot.choices) { ct, ch -> ct + ch.ct }
                valid++
            }
        }
        val counted = closure.counted.size
        push("ballot proofs", valid == counted, "$valid of $counted counted ballots verified on this device")

        // 3. Partials and counts. Robust, like the node: an unproven partial is set aside, and
        //    the `t` lowest-indexed good ones are combined.
        val good = mutableListOf<Pair<Int, List<RistrettoPoint>>>()
        val rejected = mutableListOf<String>()
        for (p in t.partials.sortedBy { it.index }) {
            val index = def.trustees.indexOf(p.trustee) + 1
            attempt {
                if (index != p.index.toInt() || index == 0 || p.options.size != agg.size) throw VoteCryptoException("shape")
                val vkey = VoteProtocol.verificationKey(dealings, index)
                val ds =
                    p.options.mapIndexed { j, o ->
                        val d = VoteWire.point(o.d, "partial")
                        if (!VoteProtocol.verifyPartial(pollId, p.trustee, j, vkey, agg[j].a, d, VoteWire.branch(o.proof))) {
                            throw VoteCryptoException("proof")
                        }
                        d
                    }
                good += index to ds
            }.onFailure { rejected += p.trustee }
        }
        push(
            "partial decryptions",
            true,
            "${good.size} of $threshold needed" + if (rejected.isEmpty()) "" else "; set aside as unproven: ${rejected.joinToString(", ")}",
        )
        if (good.size < threshold || !checks.all { it.ok }) return done(null, null)

        val used = good.take(threshold)
        val opened = agg.mapIndexed { j, ct -> VoteProtocol.openCount(ct, used.map { it.first to it.second[j] }, counted) }
        val all = opened.filterNotNull()
        val total = all.sum()
        val sumOk =
            all.size == opened.size && total >= counted * def.minChoices.toInt() && total <= counted * def.maxChoices.toInt()
        push("decryption", sumOk, "every option decrypts to a count within 0..=ballots")
        if (!sumOk) return done(null, null)
        val counts = all.map { it.toULong() }

        val digest = digest(transcriptText(pollId, def, election, closure.counted, counts))
        t.state.anchor?.let { push("anchor", it.digest == digest, "anchored on ${it.network}: ${it.reference}") }
        return done(counts, digest)
    }
}
