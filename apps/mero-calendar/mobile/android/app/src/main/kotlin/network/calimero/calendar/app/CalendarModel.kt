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
import network.calimero.calendar.data.HexIdTransport
import network.calimero.calendar.data.LocalNames
import network.calimero.calendar.data.PrivateEventStore
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
    /** No name stored for this calendar yet: ask for one. */
    val askName: Boolean = false,
)

/** One open calendar (the web app's `CalendarPage` + `Calendar`): events, members, your name, navigation. */
class CalendarModel(
    private val backend: MeroAppBackend,
    val team: Team,
    val calendar: CalendarRef,
    private val names: LocalNames,
    privateStore: PrivateEventStore,
    private val zone: ZoneId = ZoneId.systemDefault(),
    now: () -> Long = System::currentTimeMillis,
) {
    val account: String = backend.account.lowercase()
    private val repository =
        CalendarRepository(
            client = CalendarClient(HexIdTransport(backend.contract.bound(calendar.contextId))),
            privateStore = privateStore,
            account = account,
            namespaceId = team.id,
            contextId = calendar.contextId,
            now = now,
        )

    private val _state = MutableStateFlow(CalendarState())
    val state: StateFlow<CalendarState> = _state.asStateFlow()

    /** First open: register the stored name (or ask for one), then load. */
    suspend fun start() {
        val stored = names.username(calendar.contextId)
        if (stored != null) {
            runCatching { repository.setUsername(stored) }
        } else {
            _state.update { it.copy(askName = true) }
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

    /** The name the person goes by: [lastName] prefills the sheet. */
    val lastName: String get() = names.username(calendar.contextId) ?: names.lastUsername().orEmpty()

    suspend fun saveName(name: String) {
        val trimmed = name.trim()
        if (trimmed.isNotEmpty()) {
            repository.setUsername(trimmed)
            names.setUsername(calendar.contextId, trimmed)
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
        val member = _state.value.members.firstOrNull { it.id.equals(id, ignoreCase = true) }
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
