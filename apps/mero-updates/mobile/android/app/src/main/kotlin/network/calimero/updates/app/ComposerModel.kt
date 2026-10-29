package network.calimero.updates.app

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import network.calimero.updates.core.Composer
import network.calimero.updates.core.ComposerStart
import network.calimero.updates.core.ComposerState
import network.calimero.updates.core.ErrorText
import network.calimero.updates.core.Format
import network.calimero.updates.core.Limits
import network.calimero.updates.core.Metrics
import network.calimero.updates.core.UpdateTemplate
import network.calimero.updates.generated.ContributionView
import network.calimero.updates.generated.MetricSeries
import java.time.Clock

/**
 * Write an update. Opened four ways (a template, "reuse the last one", a draft, or editing a
 * published update), all landing in one [ComposerState]. Edits to a new update autosave as a draft
 * in the contract's private storage, which never replicates to investors.
 */
class ComposerModel(
    val audience: AudienceModel,
    val start: ComposerStart,
    private val scope: CoroutineScope,
    private val clock: Clock = Clock.systemDefaultZone(),
) {
    private val _state = MutableStateFlow<ComposerState?>(null)
    val state: StateFlow<ComposerState?> = _state.asStateFlow()
    private val _draftId = MutableStateFlow((start as? ComposerStart.Draft)?.id)
    val draftId: StateFlow<String?> = _draftId.asStateFlow()
    private val _savedAt = MutableStateFlow<ULong?>(null)
    val savedAt: StateFlow<ULong?> = _savedAt.asStateFlow()
    private val _series = MutableStateFlow<List<MetricSeries>>(emptyList())
    val series: StateFlow<List<MetricSeries>> = _series.asStateFlow()
    private val _contributions = MutableStateFlow<List<ContributionView>>(emptyList())
    val contributions: StateFlow<List<ContributionView>> = _contributions.asStateFlow()
    private val _isPublishing = MutableStateFlow(false)
    val isPublishing: StateFlow<Boolean> = _isPublishing.asStateFlow()
    val error = MutableStateFlow<String?>(null)

    /** Idle time before an edit is saved as a draft. */
    var autosaveDelayMs = AUTOSAVE_MS
    private var saveJob: Job? = null

    val editId: String? get() = (start as? ComposerStart.Edit)?.id
    val isEditing: Boolean get() = editId != null
    val blocker: String? get() = _state.value?.publishBlocker ?: "Loading…"

    /** "Thank N contributors": offers accepted since the last update. */
    val thanks: ComposerState.SectionDraft? get() = Composer.thanksSection(_contributions.value)
    val hasThanks: Boolean get() = _state.value?.sections?.any { it.kind == "thanks" } ?: false

    /** Load what the composer starts from. */
    suspend fun load() {
        if (_state.value != null) return
        val client = audience.client
        _series.value = runCatching { client.listMetrics() }.getOrDefault(emptyList())
        val since = audience.overview.value?.lastUpdateAt ?: 0uL
        _contributions.value = runCatching { client.listContributions(since) }.getOrDefault(emptyList())
        try {
            _state.value =
                when (start) {
                    is ComposerStart.Edit -> Composer.fromPost(client.getPost(start.id))
                    is ComposerStart.Draft -> {
                        val draft = client.listDrafts().firstOrNull { it.id == start.id }
                        _savedAt.value = draft?.updatedAt
                        draft?.let { ComposerState.parse(it.payload) } ?: fresh(UpdateTemplate.of(null))
                    }
                    ComposerStart.ReuseLatest -> {
                        val latest = client.listPosts("update", null, null, 1u).items.firstOrNull()
                        if (latest != null) Composer.fromPrevious(client.getPost(latest.id), clock) else fresh(UpdateTemplate.of(null))
                    }
                    is ComposerStart.Template -> fresh(UpdateTemplate.of(start.id))
                }
            error.value = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error.value = ErrorText.describe(e)
        }
    }

    private fun fresh(template: UpdateTemplate) = Composer.fromTemplate(template, _series.value, clock = clock)

    /** Change the draft; a new update autosaves after a pause. */
    fun update(change: (ComposerState) -> ComposerState) {
        val current = _state.value ?: return
        val next = change(current)
        if (next == current) return
        _state.value = next
        scheduleSave()
    }

    private fun scheduleSave() {
        if (isEditing) return
        saveJob?.cancel()
        saveJob =
            scope.launch {
                delay(autosaveDelayMs)
                saveDraft()
            }
    }

    /** Save now. Failure is quiet: the next edit retries, and publishing never depends on a draft. */
    suspend fun saveDraft() {
        if (isEditing) return
        val state = _state.value ?: return
        try {
            _draftId.value = audience.client.saveDraft(_draftId.value, state.title, state.payload())
            _savedAt.value = Format.nowMs(clock)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // Quiet on purpose.
        }
    }

    /** Flush a pending autosave when the composer closes. */
    suspend fun flush() {
        val pending = saveJob ?: return
        pending.cancel()
        saveJob = null
        saveDraft()
    }

    /** Publish (or save the edit). Returns the post's id. */
    suspend fun publish(): String? {
        val state = _state.value ?: return null
        if (state.publishBlocker != null || _isPublishing.value) return null
        saveJob?.cancel()
        saveJob = null
        _isPublishing.value = true
        return try {
            val input = state.toInput()
            val edit = editId
            val id =
                if (edit != null) {
                    audience.act { it.editUpdate(edit, input) }
                    edit
                } else {
                    val published = audience.act { it.publishUpdate(input) }
                    _draftId.value?.let { draft -> runCatching { audience.client.deleteDraft(draft) } }
                    _draftId.value = null
                    published
                }
            error.value = null
            id
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error.value = ErrorText.describe(e)
            null
        } finally {
            _isPublishing.value = false
        }
    }

    // Editing helpers

    fun lastValue(name: String): String? = Metrics.last(name, _series.value)

    /** KPIs reported before that are not in this update yet: one tap adds each. */
    val knownMetrics: List<MetricSeries>
        get() {
            val present =
                _state.value
                    ?.metrics
                    .orEmpty()
                    .map { it.name.lowercase() }
                    .toSet()
            return _series.value.filter { it.name.lowercase() !in present }
        }

    /** The sections the "Add section" row offers. */
    val sectionSuggestions: List<UpdateTemplate.SectionShape>
        get() {
            val kinds =
                _state.value
                    ?.sections
                    .orEmpty()
                    .map { it.kind }
                    .toSet()
            return UpdateTemplate.suggestions.filter { it.title.isEmpty() || it.kind !in kinds }
        }

    fun addSection(shape: UpdateTemplate.SectionShape) = update { it.copy(sections = it.sections + ComposerState.SectionDraft(shape.kind, shape.title, "")) }

    fun moveSectionUp(index: Int) =
        update { s ->
            if (index <= 0 || index >= s.sections.size) {
                s
            } else {
                val list = s.sections.toMutableList()
                list[index - 1] = s.sections[index]
                list[index] = s.sections[index - 1]
                s.copy(sections = list)
            }
        }

    fun removeSection(index: Int) = update { s -> s.copy(sections = s.sections.filterIndexed { i, _ -> i != index }) }

    fun setSection(
        index: Int,
        change: (ComposerState.SectionDraft) -> ComposerState.SectionDraft,
    ) = update { s -> s.copy(sections = s.sections.mapIndexed { i, x -> if (i == index) change(x) else x }) }

    fun insertThanks() {
        val section = thanks ?: return
        if (hasThanks) return
        update { it.copy(sections = it.sections + section) }
    }

    fun addMetric(
        name: String = "",
        unit: String = "",
    ) = update { it.copy(metrics = it.metrics + ComposerState.MetricDraft(name, "", unit)) }

    fun removeMetric(index: Int) = update { s -> s.copy(metrics = s.metrics.filterIndexed { i, _ -> i != index }) }

    fun setMetric(
        index: Int,
        change: (ComposerState.MetricDraft) -> ComposerState.MetricDraft,
    ) = update { s -> s.copy(metrics = s.metrics.mapIndexed { i, x -> if (i == index) change(x) else x }) }

    val canAddAsk: Boolean get() = (_state.value?.asks?.size ?: 0) < Limits.MAX_ASKS

    fun addAsk() {
        if (!canAddAsk) return
        update { it.copy(asks = it.asks + ComposerState.AskDraft(null, "intro", "", "")) }
    }

    fun removeAsk(index: Int) = update { s -> s.copy(asks = s.asks.filterIndexed { i, _ -> i != index }) }

    fun setAsk(
        index: Int,
        change: (ComposerState.AskDraft) -> ComposerState.AskDraft,
    ) = update { s -> s.copy(asks = s.asks.mapIndexed { i, x -> if (i == index) change(x) else x }) }

    /** "Draft saved · 2m ago", or what drafts are, before the first save. Null while editing a published update. */
    fun draftStatus(clock: Clock = this.clock): String? {
        if (isEditing) return null
        val saved = _savedAt.value ?: return "Drafts stay private until you publish"
        return "Draft saved · ${Format.timeAgo(saved, clock)}"
    }

    private companion object {
        const val AUTOSAVE_MS = 1_500L
    }
}
