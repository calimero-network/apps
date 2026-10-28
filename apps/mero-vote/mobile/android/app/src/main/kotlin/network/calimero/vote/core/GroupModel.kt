package network.calimero.vote.core

import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.isActive
import network.calimero.vote.generated.Member
import network.calimero.vote.generated.Phase
import network.calimero.vote.generated.PollSummary
import kotlin.coroutines.coroutineContext

/** What the new-poll sheet collects. (Swift `PollDraft`; the web's `CreatePoll`.) */
data class PollDraft(
    val title: String = "",
    val details: String = "",
    val options: List<String> = listOf("", ""),
    val mode: Mode = Mode.SINGLE,
    val maxChoices: Int = 2,
    val trustees: Set<String>,
    /** Null: the default, a majority of however many trustees are picked. */
    val thresholdPick: Int? = null,
    val everyone: Boolean = true,
    val voters: Set<String>,
    /** Milliseconds since the epoch, shown to voters; the creator still closes the poll. */
    val closesAt: ULong? = null,
) {
    enum class Mode { SINGLE, MULTI }

    constructor(me: String, roster: List<Member>) : this(trustees = setOf(me), voters = roster.map { it.account }.toSet())

    val filled: List<String> get() = options.map { it.trim() }.filter { it.isNotEmpty() }

    val maxC: Int get() = maxChoices.coerceAtLeast(1).coerceAtMost(filled.size.coerceAtLeast(1))

    val threshold: Int get() {
        val n = trustees.size
        return (thresholdPick ?: (n / 2 + 1)).coerceAtLeast(1).coerceAtMost(n.coerceAtLeast(1))
    }

    val hasDuplicates: Boolean get() = filled.toSet().size != filled.size

    val isValid: Boolean
        get() = title.isNotBlank() && filled.size >= 2 && !hasDuplicates && trustees.isNotEmpty() && (everyone || voters.isNotEmpty())

    /** The warning (or note) under the trustee picker, as the web shows it: text and whether it warns. */
    fun trusteeNote(me: String): Pair<String, Boolean>? {
        val n = trustees.size
        return when {
            n == 1 && me in trustees ->
                "With yourself as the only trustee, you alone could decrypt individual ballots. Fine for a quick poll — add trustees for a secret one." to true
            threshold == 1 && n > 1 -> "A threshold of 1 lets any single trustee decrypt individual ballots." to true
            threshold == n && n > 1 -> "All $n must take part to count: most private, least available." to false
            else -> null
        }
    }
}

/**
 * One voting group: who you are, who else is here, its polls; naming yourself, creating a poll,
 * inviting people. (Swift `GroupModel`; the web's `VotePanel`.)
 */
class GroupModel(
    val backend: MeroAppBackend,
    val group: GroupRef,
) {
    val client = voteClient(backend.contract, group.contextId)

    private val _me = MutableStateFlow<String?>(null)
    val me: StateFlow<String?> = _me.asStateFlow()
    private val _roster = MutableStateFlow<List<Member>>(emptyList())
    val roster: StateFlow<List<Member>> = _roster.asStateFlow()
    private val _polls = MutableStateFlow<List<PollSummary>>(emptyList())
    val polls: StateFlow<List<PollSummary>> = _polls.asStateFlow()
    private val _phase = MutableStateFlow<LoadPhase>(LoadPhase.Loading)
    val phase: StateFlow<LoadPhase> = _phase.asStateFlow()

    /** A failed action, for a banner. */
    val notice = MutableStateFlow<String?>(null)

    suspend fun refresh() {
        if (_me.value == null && _polls.value.isEmpty()) _phase.value = LoadPhase.Loading
        attempt {
            coroutineScope {
                val who = async { client.whoami() }
                val members = async { client.roster() }
                val list = async { client.listPolls() }
                Triple(who.await(), members.await(), list.await())
            }
        }.onSuccess { (w, r, p) ->
            _me.value = w.account
            _roster.value = r
            _polls.value = p.sortedByDescending { it.createdAt }
            _phase.value = LoadPhase.Loaded
        }.onFailure {
            if (_me.value == null) _phase.value = LoadPhase.Failed(VoteErrorText.describe(it)) else notice.value = VoteErrorText.describe(it)
        }
    }

    /** Re-read whenever the group changes: live events, or a poll when the relay cannot stream. */
    suspend fun watch() = VoteWatch.run(backend, group.contextId) { refresh() }

    val myName: String?
        get() =
            _me.value?.let { me ->
                _roster.value
                    .firstOrNull { it.account == me }
                    ?.name
                    ?.nullIfBlank()
            }

    /** The roster name, else the short account id. */
    fun label(account: String): String =
        _roster.value
            .firstOrNull { it.account == account }
            ?.name
            ?.nullIfBlank() ?: VoteFormat.short(account)

    fun count(vararg phases: Phase): Int = _polls.value.count { it.phase in phases }

    /** Everyone a poll can name as a trustee or voter: the roster, and you even before you join it. */
    val people: List<Member>
        get() {
            val me = _me.value ?: return _roster.value
            if (_roster.value.any { it.account == me }) return _roster.value
            return listOf(Member(me, "You")) + _roster.value
        }

    /** Join the roster (or rename yourself): how others can name you as a voter or trustee. */
    suspend fun setName(name: String) {
        val trimmed = name.trim()
        if (trimmed.isEmpty()) throw VoteModelException("Type a name first.")
        if (trimmed.length > VoteConstants.MAX_NAME) throw VoteModelException("A name is at most ${VoteConstants.MAX_NAME} characters.")
        worded { client.setName(trimmed) }
        refresh()
    }

    /** Create a poll. Everything in it is frozen: its hash is the poll id. */
    suspend fun createPoll(draft: PollDraft): String {
        if (!draft.isValid) {
            throw VoteModelException(if (draft.hasDuplicates) "Two options say the same thing." else "Add a question, two options and a trustee.")
        }
        val single = draft.mode == PollDraft.Mode.SINGLE
        val id =
            worded {
                client.createPoll(
                    title = draft.title.trim(),
                    description = draft.details.trim(),
                    options = draft.filled,
                    minChoices = if (single) 1u else 0u,
                    maxChoices = (if (single) 1 else draft.maxC).toUInt(),
                    trustees = draft.trustees.sorted(),
                    threshold = draft.threshold.toUInt(),
                    voters = if (draft.everyone) emptyList() else draft.voters.sorted(),
                    closesAt = draft.closesAt,
                )
            }
        refresh()
        return id
    }

    /** An invitation link to this voting group (it grants its workspace). */
    suspend fun inviteLink(): String = worded { VoteInvitation(backend.createInvitation(group.namespaceId), group.contextId).link() }
}

/** Live events for one context, else a ten-second poll. Runs until cancelled. */
internal object VoteWatch {
    suspend fun run(
        backend: MeroAppBackend,
        contextId: String,
        refresh: suspend () -> Unit,
    ) {
        if (backend.canSubscribe) {
            backend.events(contextId).catch { }.collect { refresh() }
        }
        while (coroutineContext.isActive) {
            delay(VoteConstants.POLL_INTERVAL_MS)
            refresh()
        }
    }
}
