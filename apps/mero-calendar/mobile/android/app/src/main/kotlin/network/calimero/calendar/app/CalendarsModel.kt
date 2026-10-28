package network.calimero.calendar.app

import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonObject
import network.calimero.calendar.data.ErrorText
import network.calimero.calendar.data.LocalNames

/** One calendar: a context, in its own subgroup or directly in the team. */
data class CalendarRef(
    val contextId: String,
    val groupId: String,
    val name: String,
)

data class CalendarsState(
    val loading: Boolean = true,
    val calendars: List<CalendarRef> = emptyList(),
    val error: String? = null,
    /** The calendar being joined before it opens. */
    val opening: String? = null,
)

/**
 * A team's calendars (the web app's `TeamCalendarsPage`): one open subgroup per calendar with
 * one context in it, plus any context made straight in the team.
 */
class CalendarsModel(
    private val backend: MeroAppBackend,
    val team: Team,
    private val names: LocalNames,
    val justJoined: Boolean = false,
    private val clock: () -> Long = System::currentTimeMillis,
    private val sleep: suspend (Long) -> Unit = { delay(it) },
) {
    private val _state = MutableStateFlow(CalendarsState())
    val state: StateFlow<CalendarsState> = _state.asStateFlow()

    suspend fun load() {
        _state.update { it.copy(loading = it.calendars.isEmpty(), error = null) }
        try {
            val found = linkedMapOf<String, CalendarRef>()
            for (sg in backend.listSubgroups(team.id)) {
                for (ctx in sg.contextIds) {
                    val name = sg.name?.trim()?.ifEmpty { null } ?: names.calendar(ctx) ?: placeholder(ctx)
                    found.putIfAbsent(ctx, CalendarRef(ctx, sg.groupId, name))
                }
            }
            runCatching { backend.listContexts(team.id) }.getOrDefault(emptyList()).forEach { ctx ->
                found.putIfAbsent(ctx, CalendarRef(ctx, team.id, names.calendar(ctx) ?: placeholder(ctx)))
            }
            _state.update { it.copy(loading = false, calendars = found.values.toList()) }
        } catch (e: Exception) {
            _state.update { it.copy(loading = false, error = ErrorText.of(e, "load this team's calendars")) }
        }
    }

    /** Create a calendar: an open subgroup, then the contract's context in it. */
    suspend fun create(name: String): CalendarRef {
        val calendarName = name.trim().ifEmpty { team.name }.take(TeamsModel.MAX_NAME)
        val group = backend.createSubgroup(team.id, calendarName, isPublic = true)
        val context = backend.createContext(group, team.applicationId, calendarName, JsonObject(emptyMap()))
        names.setCalendar(context, calendarName)
        val ref = CalendarRef(context, group, calendarName)
        _state.update { s -> s.copy(calendars = s.calendars.filter { it.contextId != context } + ref) }
        return ref
    }

    /**
     * Join [calendar] when the account is not in it yet. Right after a team join the relay may not
     * hold the calendar yet and refuses; the join is retried every 3 s, for up to 90 s when the
     * team was just joined, else 20 s (the web app's `joinCalendarWithRetry`).
     */
    suspend fun open(calendar: CalendarRef) {
        _state.update { it.copy(opening = calendar.contextId) }
        try {
            if (runCatching { backend.isMember(calendar.contextId) }.getOrDefault(false)) return
            joinWithRetry(calendar.contextId)
        } finally {
            _state.update { it.copy(opening = null) }
        }
    }

    private suspend fun joinWithRetry(contextId: String) {
        val deadline = clock() + if (justJoined) JUST_JOINED_WINDOW_MS else SETTLE_WINDOW_MS
        while (true) {
            val failure = runCatching { backend.joinContext(contextId) }.exceptionOrNull() ?: return
            if (clock() >= deadline) throw failure
            sleep(RETRY_MS)
        }
    }

    companion object {
        const val JUST_JOINED_WINDOW_MS = 90_000L
        const val SETTLE_WINDOW_MS = 20_000L
        const val RETRY_MS = 3_000L

        fun placeholder(contextId: String) = "Calendar ${contextId.take(6)}"
    }
}
