package network.calimero.calendar.app

import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import network.calimero.calendar.data.CalEvent
import network.calimero.calendar.data.CalMember
import network.calimero.calendar.data.CalendarRepository
import network.calimero.calendar.data.ErrorText
import network.calimero.calendar.data.EventDraft
import network.calimero.calendar.data.LocalNames
import network.calimero.calendar.data.shortId
import network.calimero.calendar.generated.CalendarClient
import java.time.LocalDate
import java.time.ZoneId

enum class CalendarMode(
    val label: String,
) {
    MONTH("Month"),
    WEEK("Week"),
    DAY("Day"),
    AGENDA("Agenda"),
}

data class CalendarState(
    val loading: Boolean = true,
    val events: List<CalEvent> = emptyList(),
    val members: List<CalMember> = emptyList(),
    val error: String? = null,
    val mode: CalendarMode = CalendarMode.MONTH,
    val selected: LocalDate = LocalDate.now(),
    /** No name on the team yet (or "Your name" was picked): ask for one, for the team. */
    val askName: Boolean = false,
)

/** One open calendar (the web app's `CalendarPage` + `Calendar`): events, members, your name, navigation. */
class CalendarModel(
    private val backend: MeroAppBackend,
    val team: Team,
    val calendar: CalendarRef,
    private val names: LocalNames,
    private val zone: ZoneId = ZoneId.systemDefault(),
) {
    /** The signed-in account id. */
    val account: String = backend.account
    private val repository = CalendarRepository(CalendarClient(backend.contract.bound(calendar.contextId)))

    private val _state = MutableStateFlow(CalendarState())
    val state: StateFlow<CalendarState> = _state.asStateFlow()

    /** Your name on the team, once read. */
    private var teamName: String? = null

    /**
     * First open: your name is the team's, copied into this calendar's roster without asking. Only a
     * team with no name for you (made before names were asked on create and join) asks, once.
     */
    suspend fun start() {
        val roster = runCatching { repository.members() }.getOrNull()?.firstOrNull { it.id == account }?.name
        val stored = names.username(calendar.contextId)
        val onTeam = backend.myTeamName(team.id)
        teamName = onTeam?.ifEmpty { null }

        // Only when it differs: every rename is an event to everyone in the calendar.
        suspend fun register(name: String) {
            if (roster != name) runCatching { repository.setUsername(name) }
        }
        when (val decision = decideSelfName(onTeam, listOf(roster, stored), names.lastUsername().orEmpty())) {
            is SelfName.Use -> register(decision.name)
            is SelfName.Adopt -> {
                runCatching { backend.setMemberName(team.id, decision.name) }.onSuccess { teamName = decision.name }
                names.setLastUsername(decision.name)
                register(decision.name)
            }
            is SelfName.Ask -> _state.update { it.copy(askName = true) }
            // The team could not be read: keep what this device knew, ask nothing.
            SelfName.Wait -> stored?.let { register(it) }
        }
        load()
    }

    suspend fun load() {
        try {
            val events = repository.events()
            val members = runCatching { repository.members() }.getOrDefault(_state.value.members)
            _state.update { it.copy(loading = false, events = events, members = members, error = null) }
        } catch (e: Exception) {
            _state.update { it.copy(loading = false, error = ErrorText.of(e, "load this calendar")) }
        }
    }

    /** Reload on every live event; poll every 10 s when the relay cannot stream. Runs until cancelled. */
    suspend fun watch() {
        if (backend.canSubscribe) {
            runCatching { backend.events(calendar.contextId).collect { load() } }
        }
        while (true) {
            delay(POLL_MS)
            load()
        }
    }

    /** The name the person goes by in the team: [lastName] prefills the sheet. */
    val lastName: String get() = teamName ?: names.lastUsername().orEmpty()

    /** Your name on the team (every calendar in it), and in this calendar's roster. */
    suspend fun saveName(name: String) {
        val trimmed = name.trim()
        if (trimmed.isNotEmpty()) {
            // Best effort: the calendar still shows it, and the team asks again next time.
            runCatching { backend.setMemberName(team.id, trimmed) }.onSuccess { teamName = trimmed }
            repository.setUsername(trimmed)
            names.setLastUsername(trimmed)
        }
        _state.update { it.copy(askName = false) }
        if (trimmed.isNotEmpty()) load()
    }

    fun skipName() = _state.update { it.copy(askName = false) }

    fun askName() = _state.update { it.copy(askName = true) }

    /** Create ([existing] null) or save an event. */
    suspend fun save(
        existing: CalEvent?,
        draft: EventDraft,
    ) {
        draft.error?.let { throw IllegalArgumentException(it) }
        val fields = draft.fields(zone)
        if (existing == null) repository.create(fields) else repository.update(existing, fields)
        load()
    }

    suspend fun delete(event: CalEvent) {
        repository.delete(event)
        _state.update { s -> s.copy(events = s.events.filter { it.id != event.id }) }
        load()
    }

    fun canEdit(event: CalEvent): Boolean = event.isOwnedBy(account)

    /** A member's name in this calendar, else a short id. */
    fun nameOf(id: String): String {
        val member = _state.value.members.firstOrNull { it.id == id }
        return member?.name?.ifEmpty { null } ?: shortId(id)
    }

    // ---- navigation -----------------------------------------------------------------------

    fun setMode(mode: CalendarMode) = _state.update { it.copy(mode = mode) }

    fun select(day: LocalDate) = _state.update { it.copy(selected = day) }

    fun today() = select(LocalDate.now(zone))

    /** One period back (-1) or forward (+1) in the current mode. */
    fun step(direction: Int) =
        _state.update {
            val d = direction.toLong()
            val next =
                when (it.mode) {
                    CalendarMode.MONTH -> it.selected.plusMonths(d).withDayOfMonth(1)
                    CalendarMode.WEEK -> it.selected.plusWeeks(d)
                    CalendarMode.DAY -> it.selected.plusDays(d)
                    CalendarMode.AGENDA -> it.selected.plusMonths(d)
                }
            it.copy(selected = next)
        }

    companion object {
        const val POLL_MS = 10_000L
    }
}
