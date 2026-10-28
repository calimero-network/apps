package network.calimero.vote.core

import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import network.calimero.vote.crypto.RistrettoPoint
import network.calimero.vote.crypto.Rng
import network.calimero.vote.crypto.Scalar
import network.calimero.vote.crypto.VoteProtocol
import network.calimero.vote.generated.AuditReport
import network.calimero.vote.generated.Ceremony
import network.calimero.vote.generated.CountedBallot
import network.calimero.vote.generated.Phase
import network.calimero.vote.generated.PollDefinition
import network.calimero.vote.generated.PollView
import network.calimero.vote.generated.Transcript
import network.calimero.vote.generated.TrusteeStatus
import network.calimero.vote.generated.WirePartial

/** A share dealt to me, and whether it opens against its dealer's commitments. */
data class ReceivedShare(
    val dealer: String,
    val ok: Boolean,
    val complained: Boolean,
)

/**
 * One poll, everything shown about it and every action on it: casting a ballot, the trustee's
 * ceremony steps and decryption share, the creator's open / close / seal, the result with its
 * audit, a re-verification on this device, and the public anchor. All crypto runs here; nothing
 * secret leaves the device. (Swift `PollModel`; the web's `PollDetail`, `TrusteePanel`, `AuditPanel`.)
 */
@Suppress("TooManyFunctions")
class PollModel(
    val backend: MeroAppBackend,
    val group: GroupRef,
    val pollId: String,
    private val keys: TrusteeKeyStore,
    private val rng: Rng = VoteProtocol.secureRng,
    private val crypto: CoroutineDispatcher = Dispatchers.Default,
) {
    val client = voteClient(backend.contract, group.contextId)

    private val _view = MutableStateFlow<PollView?>(null)
    val view: StateFlow<PollView?> = _view.asStateFlow()
    private val _report = MutableStateFlow<AuditReport?>(null)
    val report: StateFlow<AuditReport?> = _report.asStateFlow()
    private val _ceremony = MutableStateFlow<Ceremony?>(null)
    val ceremony: StateFlow<Ceremony?> = _ceremony.asStateFlow()
    private val _phase = MutableStateFlow<LoadPhase>(LoadPhase.Loading)
    val phase: StateFlow<LoadPhase> = _phase.asStateFlow()
    private val _selection = MutableStateFlow<List<Boolean>>(emptyList())
    val selection: StateFlow<List<Boolean>> = _selection.asStateFlow()

    /** The action in flight (`cast`, `transport`, `deal`, `complain:<dealer>`, `partial`, `open`, `close`, `seal`, `anchor`, `verify`). */
    private val _busy = MutableStateFlow<String?>(null)
    val busy: StateFlow<String?> = _busy.asStateFlow()

    /** What just happened, in a success banner. */
    val note = MutableStateFlow<String?>(null)

    /** What just failed, in an error banner. */
    val error = MutableStateFlow<String?>(null)
    private val _trusteeKey = MutableStateFlow<TrusteeKey?>(null)
    val trusteeKey: StateFlow<TrusteeKey?> = _trusteeKey.asStateFlow()
    private val _localAudit = MutableStateFlow<LocalAudit?>(null)
    val localAudit: StateFlow<LocalAudit?> = _localAudit.asStateFlow()

    var account: String? = null
        private set

    // ── reading ────────────────────────────────────────────────────────────

    suspend fun load() {
        if (_view.value == null) _phase.value = LoadPhase.Loading
        attempt {
            if (account == null) account = client.whoami().account
            val v = client.getPoll(pollId)
            _view.value = v
            if (_selection.value.size != v.definition.options.size) _selection.value = List(v.definition.options.size) { false }
            _report.value = if (v.state.phase == Phase.Closed) client.getResult(pollId) else null
            _ceremony.value = if (v.state.phase == Phase.KeyCeremony) client.ceremony(pollId) else null
            val me = account
            if (me != null && _trusteeKey.value == null) _trusteeKey.value = keys.load(group.contextId, pollId, me)
            _phase.value = LoadPhase.Loaded
        }.onFailure {
            if (_view.value == null) _phase.value = LoadPhase.Failed(VoteErrorText.describe(it)) else error.value = VoteErrorText.describe(it)
        }
    }

    suspend fun watch() = VoteWatch.run(backend, group.contextId) { if (_busy.value == null) load() }

    // ── derived ────────────────────────────────────────────────────────────

    val definition: PollDefinition? get() = _view.value?.definition
    val pollPhase: Phase get() = _view.value?.state?.phase ?: Phase.KeyCeremony
    val isCreator: Boolean get() = account != null && account == _view.value?.definition?.creator
    val myIndex: Int get() =
        account?.let { me ->
            _view.value
                ?.definition
                ?.trustees
                ?.indexOf(me)
                ?.let { it + 1 }
        } ?: 0
    val amTrustee: Boolean get() = myIndex > 0
    val mine: TrusteeStatus? get() = _view.value?.trustees?.firstOrNull { it.account == account }
    val allTransport: Boolean get() = _view.value?.trustees?.all { it.transportPublished } ?: false
    val qualifiedNow: Int get() = _view.value?.trustees?.count { it.dealingPublished && it.complaintsAgainst == 0u } ?: 0
    val chosen: Int get() = _selection.value.count { it }
    val canCast: Boolean
        get() {
            val v = _view.value ?: return false
            if (!v.canVote || _busy.value != null) return false
            return chosen >= v.definition.minChoices.toInt() && chosen <= v.definition.maxChoices.toInt()
        }
    val counted: List<CountedBallot> get() =
        _view.value
            ?.state
            ?.closure
            ?.counted ?: emptyList()
    val myCounted: Boolean get() = _view.value?.myDigest?.let { d -> counted.any { it.digest == d } } ?: false

    /** Who voted: the counted set once sealed, the turnout before. */
    val voterList: List<String>
        get() =
            if (pollPhase == Phase.Closed) {
                counted.map { it.voter }
            } else {
                _view.value
                    ?.turnout
                    ?.map { it.voter }
                    .orEmpty()
            }
    val publishedPartials: Int get() = _view.value?.trustees?.count { it.partialPublished } ?: 0

    /** Trustees matter most during the ceremony and while the totals await decryption. */
    val trusteesLast: Boolean
        get() = pollPhase == Phase.Voting || pollPhase == Phase.Closing || (pollPhase == Phase.Closed && _report.value?.counts != null)

    /** My transport key as published (the frozen election's, or the ceremony's). */
    val myTransport: String?
        get() {
            val index = myIndex
            if (index <= 0) return null
            _view.value
                ?.state
                ?.election
                ?.let { e -> if (e.transport.size >= index) return e.transport[index - 1] }
            return _ceremony.value
                ?.trustees
                ?.firstOrNull { it.index.toInt() == index }
                ?.transport
        }

    /** The shares dealt to me so far, checked with my transport secret. */
    val received: List<ReceivedShare>
        get() {
            val key = _trusteeKey.value
            val ceremony = _ceremony.value
            if (!amTrustee || key == null || ceremony == null) return emptyList()
            val e = attempt { Scalar.fromHex(key.secret) }.getOrNull() ?: return emptyList()
            return ceremony.trustees.mapNotNull { t ->
                val wire = t.dealing ?: return@mapNotNull null
                val ok = attempt { VoteProtocol.openShare(pollId, t.account, myIndex, e, VoteWire.dealing(wire)) }.getOrNull() != null
                val complained = ceremony.complaints.any { it.recipient == account && it.dealer == t.account }
                ReceivedShare(t.account, ok, complained)
            }
        }

    /** The creator's line beside "Open voting". */
    val ceremonyStatus: String
        get() {
            val def = _view.value?.definition ?: return ""
            val n = def.trustees.size
            val t = def.threshold.toInt()
            val q = qualifiedNow
            return when {
                !allTransport -> "Waiting for every trustee's transport key."
                q < t -> "$q honest dealing${if (q == 1) "" else "s"} so far; the key needs at least $t."
                q < n -> {
                    val missing = n - q
                    "Ready. $missing trustee${if (missing == 1) " hasn't" else "s haven't"} dealt — waiting for them adds their randomness to the key."
                }
                else -> "Every trustee has dealt."
            }
        }

    val canOpenVoting: Boolean
        get() {
            val def = _view.value?.definition ?: return false
            return allTransport && qualifiedNow >= def.threshold.toInt() && _busy.value == null
        }

    fun toggle(index: Int) {
        val def = _view.value?.definition ?: return
        val current = _selection.value
        if (index !in current.indices) return
        _selection.value =
            if (VoteFormat.isSingleChoice(def)) current.indices.map { it == index } else current.mapIndexed { i, s -> if (i == index) !s else s }
    }

    // ── acting ─────────────────────────────────────────────────────────────

    private suspend fun act(
        name: String,
        done: String?,
        work: suspend () -> Unit,
    ) {
        _busy.value = name
        error.value = null
        note.value = null
        attempt { work() }
            .onSuccess {
                if (done != null) note.value = done
                _busy.value = null
                load()
            }.onFailure {
                _busy.value = null
                error.value = VoteErrorText.describe(it)
            }
    }

    /** Encrypt, prove and cast. The plaintext is forgotten once it is sent. */
    suspend fun cast() {
        val v = _view.value ?: return
        val me = account ?: return
        val election = v.state.election ?: return
        if (!canCast) return
        val selections = _selection.value
        val rules = VoteWire.rules(v.definition)
        act("cast", "Ballot cast. It left this device encrypted — your node and every other member see only ciphertexts and proofs.") {
            val wire =
                withContext(crypto) {
                    val pk = VoteWire.point(election.key, "election key")
                    VoteWire.ballot(VoteProtocol.castBallot(pk, pollId, me, rules, selections, rng))
                }
            client.castBallot(pollId, wire)
            _selection.value = List(selections.size) { false }
        }
    }

    /** Step 1: a fresh transport secret, kept on this device; its public key with a proof. */
    suspend fun publishTransportKey() {
        val me = account ?: return
        act("transport", "Transport key published. Save a key backup now — without it this device is the only place your trustee key exists.") {
            val e = rng()
            val key = TrusteeKey(contextId = group.contextId, pollId = pollId, account = me, secret = e.hex())
            if (!keys.save(key)) throw VoteModelException("This device can't store your trustee key.")
            _trusteeKey.value = key
            val (pub, proof) = VoteProtocol.makeTransportKey(pollId, me, e, rng)
            client.publishTransportKey(pollId, pub.hex(), VoteWire.branch(proof))
        }
    }

    /** Step 2: shares of a fresh random polynomial, one encrypted to each trustee. */
    suspend fun publishDealing() {
        val me = account ?: return
        val ceremony = _ceremony.value ?: return
        val def = _view.value?.definition ?: return
        val transports = ceremony.trustees.sortedBy { it.index }.map { it.transport }
        act("deal", "Shares dealt. Each trustee received one, encrypted to them alone.") {
            val wire =
                withContext(crypto) {
                    val recipients =
                        transports.map {
                            VoteWire.point(it ?: throw VoteModelException("Waiting for every trustee's transport key."), "transport key")
                        }
                    // The polynomial lives only inside this call.
                    VoteWire.dealing(VoteProtocol.deal(pollId, me, def.threshold.toInt(), recipients, rng))
                }
            client.publishDealing(pollId, wire)
        }
    }

    /** Prove that [dealer]'s share to me was bad; their dealing is then left out of the key. */
    suspend fun complain(
        dealer: String,
        label: String,
    ) {
        val me = account ?: return
        val key = _trusteeKey.value ?: return
        val wire =
            _ceremony.value
                ?.trustees
                ?.firstOrNull { it.account == dealer }
                ?.dealing ?: return
        val index = myIndex
        act(
            "complain:$dealer",
            "Complaint filed. It proves $label's share to you was bad, and their dealing will be left out of the key.",
        ) {
            val e = VoteWire.scalar(key.secret, "trustee key")
            val (secret, proof) = VoteProtocol.makeComplaint(pollId, me, dealer, index, e, VoteWire.dealing(wire), rng)
            client.fileComplaint(pollId, dealer, secret.hex(), VoteWire.branch(proof))
        }
    }

    /** My decryption share of each option's total, under my combined key, re-derived from the frozen dealings. */
    suspend fun publishPartial(label: (String) -> String) {
        val me = account ?: return
        val key = _trusteeKey.value ?: return
        val election = _view.value?.state?.election ?: return
        val def = _view.value?.definition ?: return
        val index = myIndex
        act("partial", "Decryption share published. It decrypts only the per-option totals, never a single ballot.") {
            val e = VoteWire.scalar(key.secret, "trustee key")
            var x = Scalar.ZERO
            for (q in election.qualified) {
                val s =
                    VoteProtocol.openShare(pollId, q.dealer, index, e, VoteWire.dealing(q.dealing))
                        ?: throw VoteModelException(
                            "${label(q.dealer)}'s share to you does not verify, so you cannot decrypt — any ${def.threshold} other trustees can.",
                        )
                x += s
            }
            val inputs = client.tallyInputs(pollId)
            val partials =
                withContext(crypto) {
                    inputs.aggregate.mapIndexed { j, ct ->
                        val (d, proof) = VoteProtocol.partialDecrypt(pollId, me, j, x, VoteWire.point(ct.a, "aggregate"), rng)
                        WirePartial(d.hex(), VoteWire.branch(proof))
                    }
                }
            client.publishPartial(pollId, partials)
        }
    }

    /** Put a trustee key back from a backup (the web's file, as text). */
    fun restoreKey(raw: String) {
        val me = account ?: throw VoteModelException("Still loading. Try again in a moment.")
        val key = TrusteeKey.parse(raw, group.contextId, pollId, me)
        myTransport?.let { published ->
            val derived = attempt { RistrettoPoint.BASE.multiply(Scalar.fromHex(key.secret)).hex() }.getOrNull()
            if (derived != published) throw VoteModelException("This key does not match the transport key you published.")
        }
        if (!keys.save(key)) throw VoteModelException("This device can't store your trustee key.")
        _trusteeKey.value = key
        note.value = "Trustee key restored on this device."
        error.value = null
    }

    suspend fun openVoting() = act("open", "Voting is open. The election key is frozen.") { client.openVoting(pollId) }

    suspend fun closePoll() =
        act("close", "Poll closed to new ballots. Seal the count once ballots in flight have arrived.") { client.closePoll(pollId) }

    suspend fun sealPoll() = act("seal", "Count sealed. Trustees can now decrypt the totals.") { client.sealPoll(pollId) }

    suspend fun anchor(
        network: String,
        reference: String,
    ) {
        val n = network.trim()
        val r = reference.trim()
        if (n.isEmpty() || r.isEmpty()) return
        act("anchor", "Anchor recorded.") { client.anchorResult(pollId, n, r) }
    }

    /** Re-run every check on this device from the raw transcript, and compare with the node. */
    suspend fun reverify() {
        _busy.value = "verify"
        error.value = null
        attempt {
            val transcript = client.getTranscript(pollId)
            withContext(crypto) { TranscriptAudit.verify(transcript) }
        }.onSuccess { _localAudit.value = it }.onFailure { error.value = VoteErrorText.describe(it) }
        _busy.value = null
    }

    /** The transcript as pretty JSON, for sharing. */
    suspend fun transcriptJson(): String = pretty.encodeToString(Transcript.serializer(), client.getTranscript(pollId))

    private companion object {
        val pretty =
            Json {
                prettyPrint = true
                encodeDefaults = true
            }
    }
}
