package network.calimero.standup.app

import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import network.calimero.standup.core.Days
import network.calimero.standup.core.ErrorText
import network.calimero.standup.core.People
import network.calimero.standup.core.UpdateDraft
import network.calimero.standup.generated.DayView
import network.calimero.standup.generated.DecisionView
import network.calimero.standup.generated.MemberView
import network.calimero.standup.generated.UpdateView
import java.time.Clock

/**
 * The Standup tab: one day's updates, your own, the week strip around it, who has not posted,
 * what blocks the team right now and what was decided that day (the web's `StandupBoard`).
 */
class BoardModel(
    val team: TeamModel,
    private val clock: Clock = Clock.systemDefaultZone(),
) {
    private val _day = MutableStateFlow(Days.today(clock))
    val day: StateFlow<String> = _day.asStateFlow()
    private val _dayView = MutableStateFlow<DayView?>(null)
    val dayView: StateFlow<DayView?> = _dayView.asStateFlow()
    private val _week = MutableStateFlow<List<DayView>>(emptyList())
    val week: StateFlow<List<DayView>> = _week.asStateFlow()
    private val _blockers = MutableStateFlow<List<UpdateView>>(emptyList())
    val blockers: StateFlow<List<UpdateView>> = _blockers.asStateFlow()
    private val _decided = MutableStateFlow<List<DecisionView>>(emptyList())
    val decided: StateFlow<List<DecisionView>> = _decided.asStateFlow()
    private val _previous = MutableStateFlow<UpdateView?>(null)

    /** Your last update before [day], when you have not posted for it: the carry-forward source. */
    val previous: StateFlow<UpdateView?> = _previous.asStateFlow()
    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()
    val error = MutableStateFlow<String?>(null)

    val today: String get() = Days.today(clock)
    val isToday: Boolean get() = _day.value == today
    val weekStart: String get() = Days.weekStart(_day.value)
    val weekDays: List<String> get() = Days.weekDays(weekStart)
    val dayTitle: String get() = Days.describe(_day.value, clock)

    val updates: List<UpdateView> get() =
        _dayView.value
            ?.takeIf { it.day == _day.value }
            ?.updates
            .orEmpty()
    val mine: UpdateView? get() = updates.firstOrNull { it.author == team.me.value }
    val others: List<UpdateView> get() = updates.filter { it.author != team.me.value }

    /** Who the contract knows and has not posted. Today only. */
    val waiting: List<MemberView>
        get() = if (!isToday || _dayView.value == null) emptyList() else People.notYetPosted(team.members.value, updates)

    /** The week strip's dot for [d]: how many posted, and whether anyone was blocked. */
    fun summary(d: String): Pair<Int, Boolean> {
        val view = _week.value.firstOrNull { it.day == d } ?: return 0 to false
        return view.updates.size to view.updates.any { it.blockers.isNotEmpty() }
    }

    fun isFuture(d: String): Boolean = d > today

    /** What the update sheet opens with: your posted update, else your last one carried forward. */
    val draft: UpdateDraft get() = mine?.let { UpdateDraft(it) } ?: UpdateDraft.carryForward(_previous.value)

    /** The day the draft was carried from, when it was. */
    val carriedFrom: String? get() = if (mine == null) _previous.value?.day else null

    fun describe(d: String): String = Days.describe(d, clock)

    suspend fun select(d: String) {
        if (isFuture(d) || d == _day.value) return
        _day.value = d
        _dayView.value = null
        _previous.value = null
        _decided.value = emptyList()
        load()
    }

    suspend fun shift(delta: Int) = select(Days.shift(_day.value, delta))

    suspend fun load() {
        // Mine and the carry-forward need to know who you are, even on first open.
        if (team.me.value == null) team.load()
        _isLoading.value = true
        val client = team.client
        val day = _day.value
        val start = weekStart
        try {
            coroutineScope {
                val dayView = async { client.getDay(day) }
                val week = async { client.getWeek(start) }
                val blockers = async { client.currentBlockers() }
                val decided = async { client.listDecisions(fromDay = day, standingOnly = false, limit = 10u) }
                val d = dayView.await()
                val w = week.await()
                val b = blockers.await()
                val dec = decided.await()
                if (day != _day.value) return@coroutineScope
                _dayView.value = d
                _week.value = w
                _blockers.value = b
                _decided.value = dec.items
            }
            if (day == _day.value) {
                error.value = null
                loadPrevious()
            }
        } catch (e: Exception) {
            if (day == _day.value) error.value = ErrorText.describe(e)
        } finally {
            _isLoading.value = false
        }
    }

    /** Your last update before this day, for the carry-forward. */
    private suspend fun loadPrevious() {
        val me = team.me.value
        val last =
            team.members.value
                .firstOrNull { it.account == me }
                ?.lastDay
        if (mine != null || me == null || last.isNullOrEmpty() || last >= _day.value) {
            _previous.value = null
            return
        }
        val view = runCatching { team.client.getDay(last) }.getOrNull()
        _previous.value = view?.updates?.firstOrNull { it.author == me }
    }

    // ---- Writes ----

    suspend fun post(draft: UpdateDraft) {
        val day = _day.value
        team.act { it.postUpdate(day, draft.done, draft.next, draft.blockers) }
        load()
    }

    suspend fun withdraw() {
        val day = _day.value
        team.act { it.clearUpdate(day) }
        load()
    }

    suspend fun offerHelp(
        update: UpdateView,
        note: String,
    ) {
        team.act { it.offerHelp(update.day, update.author, note.trim()) }
        load()
    }

    suspend fun withdrawHelp(update: UpdateView) {
        team.act { it.withdrawHelp(update.day, update.author) }
        load()
    }

    /** Whether you offered help on [update]. */
    fun offered(update: UpdateView): Boolean = update.helpers.any { it.account == team.me.value }
}
