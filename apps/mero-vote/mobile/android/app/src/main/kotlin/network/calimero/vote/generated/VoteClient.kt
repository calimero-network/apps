// Mero Vote's contract on Calimero 1.0 (the component ABI, `logic/res/abi.json`), typed. Kept by
// hand, in step with the web app's adapter (`app/src/meroVote.ts`) and iOS `VoteClient.swift`:
//
// - methods and their arguments are camelCase (`castBallot`, `pollId`, `minChoices`);
// - answers keep their snake_case fields, but every u64 (`created_at`, `cast_at`…) is a decimal
//   string, read back into a number here ([VoteWireDecoding]);
// - the one u64 argument, `closesAt`, is sent as a decimal string (or `null`);
// - a refusal is `422 APP_ERROR {code, fields: {message}}` (`com.calimero.mero.AppError`).

package network.calimero.vote.generated

import com.calimero.mero.app.ContextContractCalling
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.serializer

/** Typed calls to the contract. Views go through `query`, writes through `execute`. */
class VoteClient(private val transport: ContextContractCalling) {
    /**
     * anchor_result
     *
     * Record where the transcript digest was published. Only for a fully
     * verified result, and only with the digest this node computes.
     *
     * Write (`mutating`): sent with `execute`.
     */
    suspend fun anchorResult(pollId: String, network: String, reference: String): String {
        val args = json.encodeToString(AnchorResultArgs.serializer(), AnchorResultArgs(pollId, network, reference))
        val response = transport.execute("anchorResult", args)
        return VoteWireDecoding.decode(serializer<String>(), response)
    }

    /**
     * cast_ballot
     *
     * Submit a ballot the browser encrypted. Verified here before it is
     * stored — and again by every reader, on every audit.
     *
     * Write (`mutating`): sent with `execute`.
     */
    suspend fun castBallot(pollId: String, ballot: WireBallot): String {
        val args = json.encodeToString(CastBallotArgs.serializer(), CastBallotArgs(pollId, ballot))
        val response = transport.execute("castBallot", args)
        return VoteWireDecoding.decode(serializer<String>(), response)
    }

    /**
     * ceremony
     *
     * Transport keys, dealings and complaints as they stand.
     *
     * View (`read_only`): sent with `query`.
     */
    suspend fun ceremony(pollId: String): Ceremony {
        val args = json.encodeToString(CeremonyArgs.serializer(), CeremonyArgs(pollId))
        val response = transport.query("ceremony", args)
        return VoteWireDecoding.decode(serializer<Ceremony>(), response)
    }

    /**
     * close_poll
     *
     * Step one of closing: stop accepting ballots. Each node refuses new
     * ballots once it sees this; ballots cast before that keep syncing in,
     * and the seal is what freezes the count.
     *
     * Write (`mutating`): sent with `execute`.
     */
    suspend fun closePoll(pollId: String) {
        val args = json.encodeToString(ClosePollArgs.serializer(), ClosePollArgs(pollId))
        transport.execute("closePoll", args)
    }

    /**
     * create_poll
     *
     * Write (`mutating`): sent with `execute`.
     */
    suspend fun createPoll(title: String, description: String, options: List<String>, minChoices: UInt, maxChoices: UInt, trustees: List<String>, threshold: UInt, voters: List<String>, closesAt: ULong? = null): String {
        val args = json.encodeToString(CreatePollArgs.serializer(), CreatePollArgs(title, description, options, minChoices, maxChoices, trustees, threshold, voters, closesAt?.toString()))
        val response = transport.execute("createPoll", args)
        return VoteWireDecoding.decode(serializer<String>(), response)
    }

    /**
     * file_complaint
     *
     * A trustee proves `dealer` sent it a share that does not match the
     * dealer's commitments. Refused unless the proof holds AND the share is
     * really bad — so a complaint can never frame an honest dealer.
     *
     * Write (`mutating`): sent with `execute`.
     */
    suspend fun fileComplaint(pollId: String, dealer: String, secret: String, proof: WireBranch) {
        val args = json.encodeToString(FileComplaintArgs.serializer(), FileComplaintArgs(pollId, dealer, secret, proof))
        transport.execute("fileComplaint", args)
    }

    /**
     * get_poll
     *
     * View (`read_only`): sent with `query`.
     */
    suspend fun getPoll(pollId: String): PollView {
        val args = json.encodeToString(GetPollArgs.serializer(), GetPollArgs(pollId))
        val response = transport.query("getPoll", args)
        return VoteWireDecoding.decode(serializer<PollView>(), response)
    }

    /**
     * get_result
     *
     * Re-verify everything and, once `t` trustees have published, the counts.
     *
     * View (`read_only`): sent with `query`.
     */
    suspend fun getResult(pollId: String): AuditReport {
        val args = json.encodeToString(GetResultArgs.serializer(), GetResultArgs(pollId))
        val response = transport.query("getResult", args)
        return VoteWireDecoding.decode(serializer<AuditReport>(), response)
    }

    /**
     * get_transcript
     *
     * Every input of the tally plus this node's audit of it.
     *
     * View (`read_only`): sent with `query`.
     */
    suspend fun getTranscript(pollId: String): Transcript {
        val args = json.encodeToString(GetTranscriptArgs.serializer(), GetTranscriptArgs(pollId))
        val response = transport.query("getTranscript", args)
        return VoteWireDecoding.decode(serializer<Transcript>(), response)
    }

    /**
     * list_polls
     *
     * View (`read_only`): sent with `query`.
     */
    suspend fun listPolls(): List<PollSummary> {
        val response = transport.query("listPolls", "{}")
        return VoteWireDecoding.decode(serializer<List<PollSummary>>(), response)
    }

    /**
     * open_voting
     *
     * Freeze the election key and open voting. The qualified set is every
     * verified dealing with no valid complaint against it, and it must hold
     * at least `t` dealers — otherwise fewer than `t` colluders could know
     * the whole key.
     *
     * Write (`mutating`): sent with `execute`.
     */
    suspend fun openVoting(pollId: String): String {
        val args = json.encodeToString(OpenVotingArgs.serializer(), OpenVotingArgs(pollId))
        val response = transport.execute("openVoting", args)
        return VoteWireDecoding.decode(serializer<String>(), response)
    }

    /**
     * publish_dealing
     *
     * Round 2: a trustee deals shares of its polynomial to every trustee.
     * The contract checks the shape and the proof of knowledge; whether each
     * encrypted share matches the commitments only its recipient can tell,
     * which is what complaints are for. Write-once.
     *
     * Write (`mutating`): sent with `execute`.
     */
    suspend fun publishDealing(pollId: String, dealing: WireDealing) {
        val args = json.encodeToString(PublishDealingArgs.serializer(), PublishDealingArgs(pollId, dealing))
        transport.execute("publishDealing", args)
    }

    /**
     * publish_partial
     *
     * A trustee publishes `Dⱼ = xⱼ·Aⱼ` for every option's aggregate, each
     * with a DLEQ proof against its verification key `hⱼ`, which anyone can
     * derive from the qualified commitments.
     *
     * Write (`mutating`): sent with `execute`.
     */
    suspend fun publishPartial(pollId: String, partials: List<WirePartial>) {
        val args = json.encodeToString(PublishPartialArgs.serializer(), PublishPartialArgs(pollId, partials))
        transport.execute("publishPartial", args)
    }

    /**
     * publish_transport_key
     *
     * Round 1: a trustee publishes the key dealers will encrypt its shares
     * to. Write-once — dealings are addressed to it.
     *
     * Write (`mutating`): sent with `execute`.
     */
    suspend fun publishTransportKey(pollId: String, key: String, proof: WireBranch) {
        val args = json.encodeToString(PublishTransportKeyArgs.serializer(), PublishTransportKeyArgs(pollId, key, proof))
        transport.execute("publishTransportKey", args)
    }

    /**
     * roster
     *
     * View (`read_only`): sent with `query`.
     */
    suspend fun roster(): List<Member> {
        val response = transport.query("roster", "{}")
        return VoteWireDecoding.decode(serializer<List<Member>>(), response)
    }

    /**
     * seal_poll
     *
     * Step two: freeze the ballots to count — every eligible voter's
     * current, re-verified ballot as this node sees it now.
     *
     * Write (`mutating`): sent with `execute`.
     */
    suspend fun sealPoll(pollId: String): UInt {
        val args = json.encodeToString(SealPollArgs.serializer(), SealPollArgs(pollId))
        val response = transport.execute("sealPoll", args)
        return VoteWireDecoding.decode(serializer<UInt>(), response)
    }

    /**
     * set_name
     *
     * Put a display name in your slot. Doubles as "I'm here": the roster is
     * how a creator finds the accounts to name as trustees or voters.
     *
     * Write (`mutating`): sent with `execute`.
     */
    suspend fun setName(name: String) {
        val args = json.encodeToString(SetNameArgs.serializer(), SetNameArgs(name))
        transport.execute("setName", args)
    }

    /**
     * tally_inputs
     *
     * The per-option aggregates a trustee decrypts. Recomputed from the
     * frozen ballots every call; nothing stored is trusted.
     *
     * View (`read_only`): sent with `query`.
     */
    suspend fun tallyInputs(pollId: String): TallyInputs {
        val args = json.encodeToString(TallyInputsArgs.serializer(), TallyInputsArgs(pollId))
        val response = transport.query("tallyInputs", args)
        return VoteWireDecoding.decode(serializer<TallyInputs>(), response)
    }

    /**
     * whoami
     *
     * The caller's ACCOUNT — the id trustees and voter rolls are written in.
     *
     * View (`read_only`): sent with `query`.
     */
    suspend fun whoami(): Identity {
        val response = transport.query("whoami", "{}")
        return VoteWireDecoding.decode(serializer<Identity>(), response)
    }

    @Serializable
    private data class AnchorResultArgs(
        val pollId: String,
        val network: String,
        val reference: String,
    )

    @Serializable
    private data class CastBallotArgs(
        val pollId: String,
        val ballot: WireBallot,
    )

    @Serializable
    private data class CeremonyArgs(
        val pollId: String,
    )

    @Serializable
    private data class ClosePollArgs(
        val pollId: String,
    )

    @Serializable
    private data class CreatePollArgs(
        val title: String,
        val description: String,
        val options: List<String>,
        val minChoices: UInt,
        val maxChoices: UInt,
        val trustees: List<String>,
        val threshold: UInt,
        val voters: List<String>,
        /** A u64: a decimal string, or `null` (always sent). */
        val closesAt: String?,
    )

    @Serializable
    private data class FileComplaintArgs(
        val pollId: String,
        val dealer: String,
        val secret: String,
        val proof: WireBranch,
    )

    @Serializable
    private data class GetPollArgs(
        val pollId: String,
    )

    @Serializable
    private data class GetResultArgs(
        val pollId: String,
    )

    @Serializable
    private data class GetTranscriptArgs(
        val pollId: String,
    )

    @Serializable
    private data class OpenVotingArgs(
        val pollId: String,
    )

    @Serializable
    private data class PublishDealingArgs(
        val pollId: String,
        val dealing: WireDealing,
    )

    @Serializable
    private data class PublishPartialArgs(
        val pollId: String,
        val partials: List<WirePartial>,
    )

    @Serializable
    private data class PublishTransportKeyArgs(
        val pollId: String,
        val key: String,
        val proof: WireBranch,
    )

    @Serializable
    private data class SealPollArgs(
        val pollId: String,
    )

    @Serializable
    private data class SetNameArgs(
        val name: String,
    )

    @Serializable
    private data class TallyInputsArgs(
        val pollId: String,
    )

    private companion object {
        val json = Json { ignoreUnknownKeys = true }
    }
}

/** A pointer from the context to a public record of the transcript digest. */
@Serializable
data class Anchor(
    val digest: String,
    val network: String,
    val reference: String,
    @SerialName("anchored_at") val anchoredAt: ULong,
)

/** Result of re-verifying a poll from its raw inputs. */
@Serializable
data class AuditReport(
    @SerialName("poll_id") val pollId: String,
    val phase: Phase,
    /** Every check held. A poll is only as good as its worst check. */
    val verified: Boolean,
    val checks: List<Check>,
    /** Per-option counts, once `t` trustees have published and all checks hold. */
    val counts: List<ULong>? = null,
    @SerialName("counted_ballots") val countedBallots: UInt,
    /** Trustees whose partials were combined, in index order. */
    @SerialName("decrypted_by") val decryptedBy: List<String>,
    /** Digest of the canonical transcript. What gets anchored. */
    @SerialName("transcript_digest") val transcriptDigest: String? = null,
    val anchor: Anchor? = null,
    /**
     * Eligible voters whose current ballot is not in the sealed count:
     * cast after the creator's node sealed, or left out by the creator.
     * Informational — a voter can always add one after the seal, so it
     * cannot fail the audit without letting any voter veto the result.
     */
    val uncounted: List<String>,
)

/** What a voter's slot holds for a poll: which body is theirs. */
@Serializable
data class BallotPointer(
    val digest: String,
    val frozen: String,
    @SerialName("cast_at") val castAt: ULong,
)

/** What a trustee's browser needs during the key ceremony. */
@Serializable
data class Ceremony(
    val threshold: UInt,
    val trustees: List<CeremonyTrustee>,
    val complaints: List<ComplaintView>,
)

@Serializable
data class CeremonyTrustee(
    val account: String,
    val index: UInt,
    val transport: String? = null,
    val dealing: WireDealing? = null,
)

@Serializable
data class Check(
    val name: String,
    val ok: Boolean,
    val detail: String,
)

@Serializable
data class Closure(
    val counted: List<CountedBallot>,
    /** Per option, the sum of the counted ballots' ciphertexts, frozen by the seal (new on 1.0). */
    val aggregate: List<WireCiphertext>? = null,
    @SerialName("closed_at") val closedAt: ULong,
)

/**
 * "Dealer X sent me a share that does not match its commitments", with
 * the ECDH secret for that one share and a DLEQ proof it is genuine.
 */
@Serializable
data class Complaint(
    @SerialName("poll_id") val pollId: String,
    val dealer: String,
    val secret: String,
    val proof: WireBranch,
)

@Serializable
data class ComplaintView(
    val recipient: String,
    val dealer: String,
    /** Proves the dealer cheated. An invalid complaint disqualifies no one. */
    val valid: Boolean,
)

/** One ballot the seal commits to count. */
@Serializable
data class CountedBallot(
    val voter: String,
    /** The protocol digest — the voter's receipt. */
    val digest: String,
    /** Where the body lives in `ballot_bodies`. */
    val frozen: String,
)

/** The key ceremony's outcome, frozen at open. */
@Serializable
data class Election(
    val key: String,
    val threshold: UInt,
    /**
     * Transport keys, in trustee order. Frozen because complaints are
     * adjudicated against them.
     */
    val transport: List<String>,
    /** Dealings that make up the key, in trustee order. */
    val qualified: List<QualifiedDealing>,
    /** Dealers left out because a complaint proved they cheated. */
    val disqualified: List<String>,
    @SerialName("opened_at") val openedAt: ULong,
)

@Serializable
data class Event_Anchored(
    val pollId: String,
)

@Serializable
data class Event_BallotCast(
    val pollId: String,
    val voter: String,
)

@Serializable
data class Event_ComplaintFiled(
    val pollId: String,
    val recipient: String,
    val dealer: String,
)

@Serializable
data class Event_DealingPublished(
    val pollId: String,
    val trustee: String,
)

@Serializable
data class Event_MemberNamed(
    val account: String,
)

@Serializable
data class Event_PartialPublished(
    val pollId: String,
    val trustee: String,
)

@Serializable
data class Event_PollClosing(
    val pollId: String,
)

@Serializable
data class Event_PollCreated(
    val pollId: String,
)

@Serializable
data class Event_PollSealed(
    val pollId: String,
    val counted: UInt,
)

@Serializable
data class Event_TransportKeyPublished(
    val pollId: String,
    val trustee: String,
)

@Serializable
data class Event_VotingOpened(
    val pollId: String,
)

@Serializable
data class Identity(
    val account: String,
)

@Serializable
data class Member(
    val account: String,
    val name: String,
)

/**
 * What one account may still change. Lives in [`UserStorage`], so only that
 * account can write it — enforced at merge, not just by this contract.
 *
 * Nothing the audit requires to stay put is here: a voter re-pointing their
 * ballot or a trustee re-publishing a partial after the seal changes no
 * verdict. Ceremony material is write-once, in [`MeroVote`].
 */
@Serializable
data class MemberSlot(
    val name: String,
    val ballots: Map<String, BallotPointer>,
    val partials: Map<String, StoredPartials>,
)

@Serializable
data class MeroVote(
    /** Immutable definitions; the key is the poll id. */
    val definitions: Map<String, PollDefinition>,
    /**
     * Closing notice and anchor, owned by the creator (checked at merge). Its
     * owner stamp must name the definition's `creator`, or the poll is
     * ignored: the field alone is forgeable.
     */
    val polls: Map<String, PollControl>,
    /**
     * The frozen election, `"{poll_id}/{nonce}"`. Only the creator's entries
     * count; two of them is equivocation, and fails the audit.
     */
    val elections: Map<String, Election>,
    /** The seal, keyed and read like `elections`. */
    val closures: Map<String, Closure>,
    /** `"{poll_id}/{trustee}/{content hash}"`. */
    @SerialName("transport_keys") val transportKeys: Map<String, TransportKey>,
    /** `"{poll_id}/{dealer}/{content hash}"`. */
    val dealings: Map<String, WireDealing>,
    /** `"{poll_id}/{recipient}/{dealer}/{content hash}"`. */
    val complaints: Map<String, Complaint>,
    /**
     * Ballot bodies by the SHA-256 of their bytes, owned by the voter who
     * cast them. The owner stamp is what shows the voter, not the creator,
     * made a counted ballot.
     */
    @SerialName("ballot_bodies") val ballotBodies: Map<String, StoredBallot>,
    /** One signed slot per account. */
    val slots: Map<String, MemberSlot>,
)

@Serializable
enum class Phase {
    @SerialName("KeyCeremony")
    KeyCeremony,
    @SerialName("Voting")
    Voting,
    @SerialName("Closing")
    Closing,
    @SerialName("Closed")
    Closed,
}

/**
 * The part of a poll its creator may still change: the closing notice
 * and the anchor. Everything else about a poll's lifecycle is written
 * once (see `elections` and `closures` in [`MeroVote`]).
 */
@Serializable
data class PollControl(
    /** When the close was announced (phase Closing onward). */
    @SerialName("closing_at") val closingAt: ULong? = null,
    val anchor: Anchor? = null,
)

/**
 * The immutable part of a poll. Stored content-addressed; its SHA-256 IS
 * the poll id, so nothing voters relied on can be edited under them.
 */
@Serializable
data class PollDefinition(
    val title: String,
    val description: String,
    val options: List<String>,
    @SerialName("min_choices") val minChoices: UInt,
    @SerialName("max_choices") val maxChoices: UInt,
    /**
     * Accounts that hold the decryption key between them, in index order
     * (trustee `i` in this list has Shamir index `i + 1`).
     */
    val trustees: List<String>,
    /** How many trustees it takes to decrypt. 1..=trustees.len(). */
    val threshold: UInt,
    /** Accounts allowed to vote. Empty means any member of the context. */
    val voters: List<String>,
    val creator: String,
    /** Milliseconds. Also makes two otherwise identical polls distinct. */
    @SerialName("created_at") val createdAt: ULong,
    /**
     * Informational deadline in milliseconds. Node clocks are not a
     * consensus source, so closing is an explicit act of the creator.
     */
    @SerialName("closes_at") val closesAt: ULong? = null,
)

/**
 * A poll's lifecycle as read: the phase is derived from what has been
 * written, so a sealed poll can never go back to voting.
 */
@Serializable
data class PollState(
    val phase: Phase,
    val election: Election? = null,
    /** When the close was announced (phase Closing onward). */
    @SerialName("closing_at") val closingAt: ULong? = null,
    val closure: Closure? = null,
    val anchor: Anchor? = null,
)

@Serializable
data class PollSummary(
    @SerialName("poll_id") val pollId: String,
    val title: String,
    val creator: String,
    val phase: Phase,
    @SerialName("created_at") val createdAt: ULong,
    val ballots: UInt,
)

@Serializable
data class PollView(
    @SerialName("poll_id") val pollId: String,
    val definition: PollDefinition,
    val state: PollState,
    val trustees: List<TrusteeStatus>,
    val turnout: List<Turnout>,
    /** The caller's own receipt, if they have voted. */
    @SerialName("my_digest") val myDigest: String? = null,
    @SerialName("can_vote") val canVote: Boolean,
)

@Serializable
data class QualifiedDealing(
    val dealer: String,
    val dealing: WireDealing,
)

/** A ballot body, content-addressed. */
@Serializable
data class StoredBallot(
    @SerialName("poll_id") val pollId: String,
    val voter: String,
    val ballot: WireBallot,
)

@Serializable
data class StoredPartials(
    val options: List<WirePartial>,
)

/** What a trustee's browser needs to compute its partial decryptions. */
@Serializable
data class TallyInputs(
    val aggregate: List<WireCiphertext>,
    val counted: UInt,
)

/** Every input of the tally, for verification somewhere other than this node. */
@Serializable
data class Transcript(
    val protocol: String,
    @SerialName("poll_id") val pollId: String,
    val definition: PollDefinition,
    val state: PollState,
    val ballots: List<TranscriptBallot>,
    val partials: List<TranscriptPartial>,
    val report: AuditReport,
)

@Serializable
data class TranscriptBallot(
    val voter: String,
    val digest: String,
    val ballot: WireBallot,
    /**
     * Whether the voter's own slot still points at this ballot.
     * Informational: authorship is the body's owner stamp, checked by
     * the audit as "ballot authorship".
     */
    val endorsed: Boolean,
)

@Serializable
data class TranscriptPartial(
    val trustee: String,
    val index: UInt,
    val options: List<WirePartial>,
)

/** A trustee's transport key and its proof of knowledge. */
@Serializable
data class TransportKey(
    val key: String,
    val proof: WireBranch,
)

@Serializable
data class TrusteeStatus(
    val account: String,
    /** 1-based Shamir index. */
    val index: UInt,
    @SerialName("transport_published") val transportPublished: Boolean,
    @SerialName("dealing_published") val dealingPublished: Boolean,
    /** Valid complaints filed against this trustee's dealing. */
    @SerialName("complaints_against") val complaintsAgainst: UInt,
    /** Whether this trustee's dealing is part of the key (after open). */
    val qualified: Boolean? = null,
    @SerialName("partial_published") val partialPublished: Boolean,
)

/** Who has voted — never what. */
@Serializable
data class Turnout(
    val voter: String,
    val digest: String,
    @SerialName("cast_at") val castAt: ULong,
)

/** An encrypted ballot exactly as the browser built it. */
@Serializable
data class WireBallot(
    val choices: List<WireChoice>,
    @SerialName("sum_proof") val sumProof: List<WireBranch>,
)

/** One `(c, z)` pair of a proof, as 64-hex scalars. */
@Serializable
data class WireBranch(
    val c: String,
    val z: String,
)

/** One option's ciphertext and its 0-or-1 proof. */
@Serializable
data class WireChoice(
    val a: String,
    val b: String,
    val proof: List<WireBranch>,
)

@Serializable
data class WireCiphertext(
    val a: String,
    val b: String,
)

/** A trustee's contribution to the distributed key. */
@Serializable
data class WireDealing(
    /** `t` Feldman commitments, constant term first. */
    val commitments: List<String>,
    /** Proof of knowledge of the constant term. */
    val proof: WireBranch,
    /** One per trustee, in the poll's trustee order. */
    val shares: List<WireEncShare>,
)

/** One share of a dealing, encrypted to its recipient's transport key. */
@Serializable
data class WireEncShare(
    val r: String,
    val v: String,
)

/** A trustee's partial decryption of one option's aggregate. */
@Serializable
data class WirePartial(
    val d: String,
    val proof: WireBranch,
)

/**
 * Reads the contract's answers: each u64 field arrives as a decimal string and is turned back into
 * a number before decoding, as the web adapter's `decode` does. (Swift `VoteWireDecoding`.)
 */
object VoteWireDecoding {
    /** Every 64-bit field the contract answers, in any answer. */
    val U64_FIELDS: Set<String> = setOf("created_at", "closes_at", "opened_at", "closed_at", "closing_at", "anchored_at", "cast_at")

    private val json = Json { ignoreUnknownKeys = true }

    fun <T> decode(
        serializer: KSerializer<T>,
        response: String,
    ): T = json.decodeFromJsonElement(serializer, normalized(json.parseToJsonElement(response)))

    /** [element] with every u64 field's decimal string as a JSON number. */
    fun normalized(
        element: JsonElement,
        key: String? = null,
    ): JsonElement =
        when (element) {
            is JsonArray -> JsonArray(element.map { normalized(it) })
            is JsonObject -> JsonObject(element.mapValues { (k, v) -> normalized(v, k) })
            is JsonPrimitive ->
                // Timestamps in milliseconds: far below Long.MAX_VALUE.
                if (key in U64_FIELDS && element.isString && element.content.toLongOrNull()?.let { it >= 0 } == true) {
                    JsonPrimitive(element.content.toLong())
                } else {
                    element
                }
            else -> element
        }
}
