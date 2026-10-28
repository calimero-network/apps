package network.calimero.updates.app

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import network.calimero.updates.core.Catalog
import network.calimero.updates.core.ErrorText
import network.calimero.updates.core.Format
import network.calimero.updates.generated.AskView
import network.calimero.updates.generated.ContributionView
import network.calimero.updates.generated.EngagementRow
import network.calimero.updates.generated.MetricSeries
import network.calimero.updates.generated.PersonView
import network.calimero.updates.generated.PostCard
import network.calimero.updates.generated.UpdatesClient
import java.time.Clock

/** Runs [body], putting any failure into [error] as words. False when it failed. */
private suspend fun attempt(
    error: MutableStateFlow<String?>,
    body: suspend () -> Unit,
): Boolean =
    try {
        body()
        error.value = null
        true
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        error.value = ErrorText.describe(e)
        false
    }

/** The Asks tab: every ask across the updates, by status, and the ledger of accepted offers. */
class AsksModel(
    val audience: AudienceModel,
) {
    private val _asks = MutableStateFlow<List<AskView>>(emptyList())
    val asks: StateFlow<List<AskView>> = _asks.asStateFlow()
    private val _contributions = MutableStateFlow<List<ContributionView>>(emptyList())
    val contributions: StateFlow<List<ContributionView>> = _contributions.asStateFlow()
    private val _hasLoaded = MutableStateFlow(false)
    val hasLoaded: StateFlow<Boolean> = _hasLoaded.asStateFlow()
    val error = MutableStateFlow<String?>(null)

    /** "open" or "resolved". */
    private val _status = MutableStateFlow("open")
    val status: StateFlow<String> = _status.asStateFlow()

    suspend fun load() {
        attempt(error) {
            coroutineScope {
                val asks = async { audience.client.listAsks(_status.value) }
                val contributions = async { audience.client.listContributions(0uL) }
                _asks.value = asks.await()
                _contributions.value = contributions.await()
            }
        }
        _hasLoaded.value = true
    }

    suspend fun show(status: String) {
        if (status == _status.value) return
        _status.value = status
        _asks.value = emptyList()
        load()
    }
}

/** The Q&A tab: questions anyone in the audience can ask and read. */
class QuestionsModel(
    val audience: AudienceModel,
) {
    private val _questions = MutableStateFlow<List<PostCard>>(emptyList())
    val questions: StateFlow<List<PostCard>> = _questions.asStateFlow()
    private val _hasLoaded = MutableStateFlow(false)
    val hasLoaded: StateFlow<Boolean> = _hasLoaded.asStateFlow()
    private val _isPosting = MutableStateFlow(false)
    val isPosting: StateFlow<Boolean> = _isPosting.asStateFlow()
    val error = MutableStateFlow<String?>(null)

    /** Unanswered only. */
    val openOnly = MutableStateFlow(false)

    fun shown(
        all: List<PostCard> = _questions.value,
        open: Boolean = openOnly.value,
    ): List<PostCard> = if (open) all.filter { it.status == "open" } else all

    suspend fun load() {
        attempt(error) { _questions.value = audience.client.listPosts("question", null, null, FeedModel.PAGE_SIZE).items }
        _hasLoaded.value = true
    }

    /** Post a question; returns its id to open it. */
    suspend fun ask(
        title: String,
        body: String,
    ): String? {
        if (title.isBlank()) return null
        _isPosting.value = true
        var id: String? = null
        attempt(error) { id = audience.askQuestion(title, body) }
        if (id != null) load()
        _isPosting.value = false
        return id
    }
}

/** The KPIs tab: one series per metric name across every update. */
class MetricsModel(
    val audience: AudienceModel,
) {
    private val _series = MutableStateFlow<List<MetricSeries>>(emptyList())
    val series: StateFlow<List<MetricSeries>> = _series.asStateFlow()
    private val _hasLoaded = MutableStateFlow(false)
    val hasLoaded: StateFlow<Boolean> = _hasLoaded.asStateFlow()
    val error = MutableStateFlow<String?>(null)

    suspend fun load() {
        attempt(error) { _series.value = audience.client.listMetrics().filter { it.points.isNotEmpty() } }
        _hasLoaded.value = true
    }
}

/** The People tab: the team, the investors, your profile and what you follow; for the team also engagement. */
class PeopleModel(
    val audience: AudienceModel,
) {
    private val _people = MutableStateFlow<List<PersonView>>(emptyList())
    val people: StateFlow<List<PersonView>> = _people.asStateFlow()
    private val _engagement = MutableStateFlow<List<EngagementRow>>(emptyList())
    val engagement: StateFlow<List<EngagementRow>> = _engagement.asStateFlow()
    private val _hasLoaded = MutableStateFlow(false)
    val hasLoaded: StateFlow<Boolean> = _hasLoaded.asStateFlow()

    /** The account a teammate change is in flight for. */
    private val _pending = MutableStateFlow<String?>(null)
    val pending: StateFlow<String?> = _pending.asStateFlow()
    val error = MutableStateFlow<String?>(null)

    suspend fun load() {
        attempt(error) {
            _people.value = audience.client.listPeople()
            _engagement.value = if (audience.isTeam) audience.client.getEngagement() else emptyList()
        }
        _hasLoaded.value = true
    }

    /** Admins make a member a teammate, or take them off the team. */
    suspend fun toggleTeam(person: PersonView) {
        _pending.value = person.account
        if (attempt(error) { audience.setTeammate(person.account, !person.isTeam) }) load()
        _pending.value = null
    }

    companion object {
        /** "Read 3/4 (75%) · last read 2d ago · 1 reply · 2 offers (1 accepted)". */
        fun engagementLine(
            p: PersonView,
            clock: Clock = Clock.systemDefaultZone(),
        ): String {
            val pct = Format.percent(p.updatesRead, p.updatesTotal)
            var line =
                "Read ${p.updatesRead}/${p.updatesTotal} ($pct%) · last read ${Format.timeAgo(p.lastReadAt, clock)} · " +
                    "${Format.plural(p.comments, "reply", "replies")} · ${Format.plural(p.offers, "offer")}"
            if (p.acceptedOffers > 0uL) line += " (${p.acceptedOffers} accepted)"
            return line
        }
    }
}

/** Settings (team only): how the company appears and how updates are filed. */
class SettingsModel(
    val audience: AudienceModel,
) {
    val companyName = MutableStateFlow("")
    val cadenceDays = MutableStateFlow(DEFAULT_CADENCE)
    private val _hasLoaded = MutableStateFlow(false)
    val hasLoaded: StateFlow<Boolean> = _hasLoaded.asStateFlow()
    private val _isSaving = MutableStateFlow(false)
    val isSaving: StateFlow<Boolean> = _isSaving.asStateFlow()
    private val _saved = MutableStateFlow(false)
    val saved: StateFlow<Boolean> = _saved.asStateFlow()
    val error = MutableStateFlow<String?>(null)

    suspend fun load() {
        if (_hasLoaded.value) return
        if (
            attempt(error) {
                val settings = audience.client.getSettings()
                companyName.value = settings.companyName
                // An audience never saved has cadence 0 and updated_at 0: offer monthly.
                cadenceDays.value = if (settings.updatedAt > 0uL) settings.cadenceDays else DEFAULT_CADENCE
            }
        ) {
            _hasLoaded.value = true
        }
    }

    suspend fun save(): Boolean {
        _isSaving.value = true
        val name = companyName.value.trim()
        val cadence = cadenceDays.value
        val ok = attempt(error) { audience.act { it.setSettings(name, cadence) } }
        if (ok) _saved.value = true
        _isSaving.value = false
        return ok
    }

    suspend fun createCategory(
        name: String,
        emoji: String,
        color: String,
    ) = write { it.createCategory(name.trim(), emoji.trim(), color) }

    suspend fun editCategory(
        id: String,
        name: String,
        emoji: String,
        color: String,
    ) = write { it.editCategory(id, name.trim(), emoji.trim(), color) }

    suspend fun archiveCategory(id: String) = write { it.archiveCategory(id) }

    /** Monthly, Fundraising, Product, Hiring, Board: the ones not there yet. */
    suspend fun addStarters(): Boolean {
        val existing =
            audience.categories.value
                .map { it.name.lowercase() }
                .toSet()
        val missing = Catalog.starterCategories.filter { it.name.lowercase() !in existing }
        return write { client -> missing.forEach { client.createCategory(it.name, it.emoji, it.color) } }
    }

    private suspend fun write(body: suspend (UpdatesClient) -> Unit): Boolean = attempt(error) { audience.act(body) }

    private companion object {
        const val DEFAULT_CADENCE = 30u
    }
}
