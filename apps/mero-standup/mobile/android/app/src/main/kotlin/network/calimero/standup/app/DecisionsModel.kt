package network.calimero.standup.app

import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import network.calimero.standup.core.Days
import network.calimero.standup.core.DecisionDraft
import network.calimero.standup.core.ErrorText
import network.calimero.standup.generated.DecisionView
import network.calimero.standup.generated.TagCount
import java.time.ZoneId

/** A month of the timeline. */
data class TimelineMonth(
    val title: String,
    val items: List<DecisionView>,
)

/**
 * The Decisions tab: the log, searched and filtered, its tags, logging a decision and superseding
 * one (the web's `DecisionLog`). Decisions are never edited, only superseded.
 */
class DecisionsModel(
    val team: TeamModel,
    private val zone: ZoneId = ZoneId.systemDefault(),
) {
    val search = MutableStateFlow("")
    val tag = MutableStateFlow<String?>(null)
    val standingOnly = MutableStateFlow(false)
    private val _pages = MutableStateFlow(1u)
    val pages: StateFlow<UInt> = _pages.asStateFlow()
    private val _items = MutableStateFlow<List<DecisionView>>(emptyList())
    val items: StateFlow<List<DecisionView>> = _items.asStateFlow()
    private val _hasMore = MutableStateFlow(false)
    val hasMore: StateFlow<Boolean> = _hasMore.asStateFlow()
    private val _tags = MutableStateFlow<List<TagCount>>(emptyList())
    val tags: StateFlow<List<TagCount>> = _tags.asStateFlow()
    private val _hasLoaded = MutableStateFlow(false)
    val hasLoaded: StateFlow<Boolean> = _hasLoaded.asStateFlow()
    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()
    val error = MutableStateFlow<String?>(null)

    val isFiltered: Boolean get() = search.value.isNotBlank() || tag.value != null || standingOnly.value

    suspend fun load() {
        _isLoading.value = true
        val query = search.value.trim()
        val tag = tag.value
        val standingOnly = standingOnly.value
        val limit = PAGE * _pages.value
        try {
            coroutineScope {
                val page = async { team.client.listDecisions(search = query.ifEmpty { null }, tag = tag, standingOnly = standingOnly, limit = limit) }
                val tags = async { team.client.tags() }
                val p = page.await()
                val t = tags.await()
                if (query != search.value.trim() || tag != this@DecisionsModel.tag.value || standingOnly != this@DecisionsModel.standingOnly.value) {
                    return@coroutineScope
                }
                _items.value = p.items
                _hasMore.value = p.nextCursor != null
                _tags.value = t
                error.value = null
                _hasLoaded.value = true
            }
        } catch (e: Exception) {
            error.value = ErrorText.describe(e)
        } finally {
            _isLoading.value = false
        }
    }

    /** A filter changed: start again from the first page. */
    suspend fun refilter() {
        _pages.value = 1u
        load()
    }

    suspend fun toggleTag(t: String) {
        tag.value = if (tag.value == t) null else t
        refilter()
    }

    suspend fun showOlder() {
        _pages.value += 1u
        load()
    }

    /** Clear every filter, so a linked decision is in the list. */
    suspend fun clearFilters() {
        search.value = ""
        tag.value = null
        standingOnly.value = false
        refilter()
    }

    /** Log [draft]. Returns the new decision's id. */
    suspend fun log(draft: DecisionDraft): String {
        val id =
            team.act {
                it.logDecision(
                    title = draft.title.trim(),
                    decision = draft.decision.trim(),
                    rationale = draft.rationale.trim(),
                    supersedes = draft.supersedes?.id,
                    tags = draft.tags,
                    with = draft.with.sorted(),
                    fromDay = draft.fromDay,
                )
            }
        load()
        return id
    }

    /** A decision in the list, or read on its own (a link to one filtered out). */
    suspend fun decision(id: String): DecisionView? = _items.value.firstOrNull { it.id == id } ?: runCatching { team.client.getDecision(id) }.getOrNull()

    fun title(id: String): String? = _items.value.firstOrNull { it.id == id }?.title

    /** The log grouped by month, newest first, for the timeline. */
    val months: List<TimelineMonth>
        get() {
            val out = mutableListOf<TimelineMonth>()
            for (d in _items.value) {
                val title = Days.monthTitle(d.createdAt, zone)
                val last = out.lastOrNull()
                if (last?.title == title) out[out.size - 1] = last.copy(items = last.items + d) else out += TimelineMonth(title, listOf(d))
            }
            return out
        }

    companion object {
        const val PAGE: UInt = 25u
    }
}
