package network.calimero.standup.app

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import network.calimero.standup.core.Days
import network.calimero.standup.core.Digest
import network.calimero.standup.core.ErrorText
import network.calimero.standup.core.PersonWeek
import network.calimero.standup.generated.DayView
import java.time.Clock

/** The Week tab: a week of standups per person, shareable as Markdown (the web's `WeekDigest`). */
class WeekModel(
    val team: TeamModel,
    private val clock: Clock = Clock.systemDefaultZone(),
) {
    private val _start = MutableStateFlow(Days.weekStart(Days.today(clock)))
    val start: StateFlow<String> = _start.asStateFlow()
    private val _week = MutableStateFlow<List<DayView>?>(null)
    val week: StateFlow<List<DayView>?> = _week.asStateFlow()
    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()
    val error = MutableStateFlow<String?>(null)

    val isThisWeek: Boolean get() = _start.value == Days.weekStart(Days.today(clock))
    val range: String get() = Days.describeWeek(_start.value)
    val people: List<PersonWeek> get() = _week.value?.let(Digest::byPerson).orEmpty()
    val markdown: String get() = Digest.markdown(team.teamName.value, _start.value, _week.value.orEmpty())

    fun weekday(day: String): String = Days.weekdayShort(day)

    suspend fun shift(weeks: Int) {
        if (weeks > 0 && isThisWeek) return
        _start.value = Days.shift(_start.value, 7 * weeks)
        _week.value = null
        load()
    }

    suspend fun load() {
        _isLoading.value = true
        val start = _start.value
        try {
            val week = team.client.getWeek(start)
            if (start != _start.value) return
            _week.value = week
            error.value = null
        } catch (e: Exception) {
            error.value = ErrorText.describe(e)
        } finally {
            _isLoading.value = false
        }
    }
}
