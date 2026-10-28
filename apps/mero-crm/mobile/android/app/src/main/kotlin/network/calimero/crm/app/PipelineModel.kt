package network.calimero.crm.app

import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import network.calimero.crm.core.Account
import network.calimero.crm.core.ActivityDraft
import network.calimero.crm.core.Assistant
import network.calimero.crm.core.Company
import network.calimero.crm.core.ContactDraft
import network.calimero.crm.core.CrmException
import network.calimero.crm.core.Days
import network.calimero.crm.core.DealDraft
import network.calimero.crm.core.DealHealth
import network.calimero.crm.core.ErrorText
import network.calimero.crm.core.Insights
import network.calimero.crm.core.Money
import network.calimero.crm.core.PipelineStats
import network.calimero.crm.core.SuggestedActivity
import network.calimero.crm.core.crmClient
import network.calimero.crm.generated.ActivityView
import network.calimero.crm.generated.AutomationView
import network.calimero.crm.generated.ContactView
import network.calimero.crm.generated.CrmClient
import network.calimero.crm.generated.DealDetail
import network.calimero.crm.generated.DealView
import network.calimero.crm.generated.NoteView
import network.calimero.crm.generated.Settings
import network.calimero.crm.generated.StageView
import java.time.ZoneId
import java.util.UUID

/** A one-line message after an action: "Deal saved", or what went wrong. */
data class Notice(
    val text: String,
    val isError: Boolean = false,
    val id: String = UUID.randomUUID().toString(),
)

/** The whole pipeline as last read, and how the read went. */
data class PipelineState(
    val stages: List<StageView> = emptyList(),
    val deals: List<DealView> = emptyList(),
    val contacts: List<ContactView> = emptyList(),
    val activities: List<ActivityView> = emptyList(),
    val automations: List<AutomationView> = emptyList(),
    val settings: Settings = PipelineModel.DEFAULT_SETTINGS,
    val hasLoaded: Boolean = false,
    val isLoading: Boolean = false,
    /** The context's state has not replicated here yet: "syncing", not an error. */
    val warmingUp: Boolean = false,
    val error: String? = null,
    /** Bumped after every successful read: a cheap "something changed" signal. */
    val version: Int = 0,
)

/**
 * One pipeline (one context), held whole: stages, every deal, people, activities, automations and
 * settings are read together, and every screen derives from that one snapshot (the web app's
 * `useCrm`). A live event from the context re-reads it; every write re-reads it after.
 */
@Suppress("TooManyFunctions")
class PipelineModel(
    val pipeline: PipelineRef,
    val backend: MeroAppBackend,
) {
    private val _state = MutableStateFlow(PipelineState())
    val state: StateFlow<PipelineState> = _state.asStateFlow()
    val notice = MutableStateFlow<Notice?>(null)

    val client: CrmClient = crmClient(backend, pipeline.contextId)

    /** The signed-in account, 64 hex. */
    val me: String = Account.canonical(backend.account) ?: backend.account.lowercase()
    var now: () -> ULong = { System.currentTimeMillis().toULong() }
    var zone: ZoneId = ZoneId.systemDefault()

    /** How long a burst of events is coalesced into one read. */
    var coalesceMs = 250L
    var warmupRetryMs = 1_500L

    /** When the relay cannot stream events, how often to re-read. */
    var pollMs = 20_000L

    private val mutex = Mutex()

    @Volatile private var pending = false

    @Volatile private var joinChecked = false

    private val s: PipelineState get() = _state.value
    val stages: List<StageView> get() = s.stages
    val deals: List<DealView> get() = s.deals
    val contacts: List<ContactView> get() = s.contacts
    val currency: String get() = s.settings.currency
    val rottingDays: Int get() = s.settings.rottingDays.toInt()

    // Reading

    /** Read the whole pipeline. Reads never overlap; a change during a read costs one more read. */
    suspend fun load() {
        if (mutex.isLocked) {
            pending = true
            return
        }
        mutex.withLock { read() }
        if (pending) {
            pending = false
            load()
        }
    }

    private suspend fun read() {
        _state.update { it.copy(isLoading = true) }
        joinIfNeeded()
        try {
            coroutineScope {
                val st = async { client.listStages() }
                val ds = async { client.listDeals() }
                val cs = async { client.listContacts() }
                val ac = async { client.listActivities() }
                val au = async { client.listAutomations() }
                val se = async { client.getSettings() }
                val next =
                    s.copy(
                        stages = st.await().sortedBy { it.position },
                        deals = ds.await(),
                        contacts = cs.await().sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name }),
                        activities = ac.await(),
                        automations = au.await(),
                        settings = se.await(),
                        hasLoaded = true,
                        isLoading = false,
                        warmingUp = false,
                        error = null,
                        version = s.version + 1,
                    )
                _state.value = next
            }
        } catch (e: CancellationException) {
            _state.update { it.copy(isLoading = false) }
            throw e
        } catch (e: Exception) {
            _state.update {
                if (ErrorText.isWarmingUp(e)) {
                    it.copy(isLoading = false, warmingUp = true, error = null)
                } else {
                    it.copy(isLoading = false, warmingUp = false, error = ErrorText.describe(e))
                }
            }
        }
    }

    /** A pipeline in an open workspace is joined on first open (the web's `joinContext(activePipeline)`); best effort. */
    private suspend fun joinIfNeeded() {
        if (joinChecked) return
        joinChecked = true
        try {
            if (!backend.isMember(pipeline.contextId)) backend.joinContext(pipeline.contextId)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // The read says the rest.
        }
    }

    /**
     * Load, then keep the snapshot live until cancelled: re-read on the context's events (or on a
     * timer when the relay cannot stream), and retry while the context is still syncing.
     */
    @OptIn(FlowPreview::class)
    suspend fun run() {
        load()
        coroutineScope {
            launch {
                if (backend.canSubscribe) {
                    try {
                        backend.events(pipeline.contextId).debounce(coalesceMs).collect { load() }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        // Falls back to polling.
                    }
                }
                while (isActive) {
                    delay(pollMs)
                    load()
                }
            }
            launch {
                while (isActive) {
                    delay(warmupRetryMs)
                    if (s.warmingUp) load()
                }
            }
        }
    }

    /** One deal with its person, activities and notes. */
    suspend fun detail(dealId: String): DealDetail = client.getDeal(dealId)

    // People and ownership

    /** Whether `id` is the signed-in account, in either spelling. */
    fun isMe(id: String?): Boolean = Account.same(id, me)

    /** The label for a stored owner: "You", a short account, or a name an older deal stored. */
    fun ownerLabel(owner: String?): String =
        when {
            owner.isNullOrEmpty() -> "Unassigned"
            isMe(owner) -> "You"
            Account.canonical(owner) != null -> Account.short(owner)
            else -> owner
        }

    /** The label for an author or creator. */
    fun personLabel(id: String): String =
        when {
            isMe(id) -> "You"
            Account.canonical(id) != null -> Account.short(id)
            else -> id
        }

    /** Who a deal can be given to: you, then everyone already owning a deal here. */
    val ownerOptions: List<String>
        get() {
            val seen = mutableSetOf(me)
            val out = mutableListOf(me)
            for (d in deals) {
                val o = d.owner?.ifEmpty { null } ?: continue
                if (seen.add(Account.canonical(o) ?: o)) out += o
            }
            return out
        }

    fun stage(id: String): StageView? = stages.firstOrNull { it.id == id }

    fun contact(id: String?): ContactView? = id?.let { cid -> contacts.firstOrNull { it.id == cid } }

    fun deal(id: String): DealView? = deals.firstOrNull { it.id == id }

    fun health(deal: DealView): DealHealth = Assistant.health(deal, rottingDays, now(), zone)

    val openDeals: List<DealView> get() = deals.filter { it.status == "open" }

    fun openDeals(stageId: String): List<DealView> = openDeals.filter { it.stageId == stageId }.sortedByDescending { it.createdAt }

    fun stats(): PipelineStats = Insights.stats(deals, stages, now(), zone)

    fun companies(): List<Company> = Insights.companies(contacts, deals)

    // Writing

    /** Run a write, re-read, and report. Returns the write's result, or null after reporting the failure. */
    suspend fun <T> act(
        success: String? = null,
        body: suspend (CrmClient) -> T,
    ): T? =
        try {
            val result = body(client)
            load()
            if (success != null) notice.value = Notice(success)
            result
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            notice.value = Notice(ErrorText.describe(e), isError = true)
            null
        }

    private fun invalid(e: Exception): Boolean {
        notice.value = Notice(e.message.orEmpty(), isError = true)
        return false
    }

    /** Create a deal (and its new person, when the draft makes one). Returns the deal's id. */
    suspend fun createDeal(draft: DealDraft): String? {
        val value = draft.parsedValue ?: return null.also { invalid(CrmException.InvalidValue()) }
        val close = draft.closeMs(zone)
        return act("Deal added") { c ->
            var contactId = draft.contactId
            if (draft.creatingContact) {
                contactId = c.createContact(draft.newContactName.trim(), draft.newContactEmail.trim(), "", draft.organization.trim(), "")
            }
            c.createDeal(
                title = draft.title.trim(),
                value = value,
                organization = draft.organization.trim(),
                contactId = contactId,
                stageId = draft.stageId,
                owner = draft.owner,
                expectedClose = close,
                source = draft.source.trim(),
            )
        }
    }

    suspend fun updateDeal(
        id: String,
        draft: DealDraft,
    ): Boolean {
        val value = draft.parsedValue ?: return invalid(CrmException.InvalidValue())
        val close = draft.closeMs(zone)
        return act("Deal saved") { c ->
            c.updateDeal(
                dealId = id,
                title = draft.title.trim(),
                value = value,
                organization = draft.organization.trim(),
                contactId = draft.contactId,
                owner = draft.owner,
                expectedClose = close,
                source = draft.source.trim(),
            )
        } != null
    }

    suspend fun move(
        deal: DealView,
        stageId: String,
    ): Boolean {
        if (stageId == deal.stageId) return true
        val name = stage(stageId)?.name ?: "the stage"
        return act("Moved to $name") { it.moveDeal(deal.id, stageId) } != null
    }

    suspend fun markWon(deal: DealView): Boolean = act("Won “${deal.title}” — ${Money.format(deal.value, currency)}") { it.markWon(deal.id) } != null

    suspend fun markLost(
        deal: DealView,
        reason: String,
    ): Boolean = act("Marked as lost") { it.markLost(deal.id, reason.trim()) } != null

    suspend fun reopen(deal: DealView): Boolean = act("Deal reopened") { it.reopenDeal(deal.id) } != null

    suspend fun deleteDeal(deal: DealView): Boolean = act("Deal deleted") { it.deleteDeal(deal.id) } != null

    /** Schedule an activity. Owner: the deal's, else you (as the web does). */
    suspend fun schedule(draft: ActivityDraft): Boolean {
        val deal = draft.dealId?.let { deal(it) }
        val owner = deal?.owner?.ifEmpty { null } ?: me
        val subject = draft.subject.trim()
        return act("Scheduled: $subject") { c ->
            c.addActivity(draft.dealId, deal?.contactId, draft.kind.raw, subject, draft.due, owner, draft.note)
        } != null
    }

    /** One tap on a suggested next step: scheduled `dueInDays` from today at 10:00. */
    suspend fun schedule(
        suggestion: SuggestedActivity,
        deal: DealView,
    ): Boolean =
        schedule(
            ActivityDraft(
                kind = suggestion.kind,
                subject = suggestion.subject,
                due = Days.dueIn(suggestion.dueInDays, now(), zone),
                dealId = deal.id,
            ),
        )

    suspend fun setDone(
        activity: ActivityView,
        done: Boolean,
    ): Boolean = act(if (done) "Done: ${activity.subject}" else null) { it.setActivityDone(activity.id, done) } != null

    /** Snooze to tomorrow at 10:00. */
    suspend fun snooze(activity: ActivityView): Boolean {
        val due = Days.dueIn(1, now(), zone)
        return act("Moved to tomorrow") { it.rescheduleActivity(activity.id, due) } != null
    }

    suspend fun deleteActivity(activity: ActivityView): Boolean = act("Activity deleted") { it.deleteActivity(activity.id) } != null

    suspend fun addNote(
        dealId: String,
        body: String,
    ): Boolean {
        val text = body.trim()
        if (text.isEmpty()) return false
        return act("Note added") { it.addNote(dealId, text) } != null
    }

    suspend fun deleteNote(note: NoteView): Boolean = act("Note deleted") { it.deleteNote(note.id) } != null

    suspend fun createContact(draft: ContactDraft): String? =
        act("Added ${draft.name.trim()}") {
            it.createContact(draft.name.trim(), draft.email.trim(), draft.phone.trim(), draft.organization.trim(), draft.jobTitle.trim())
        }

    suspend fun updateContact(
        id: String,
        draft: ContactDraft,
    ): Boolean =
        act("Saved") {
            it.updateContact(id, draft.name.trim(), draft.email.trim(), draft.phone.trim(), draft.organization.trim(), draft.jobTitle.trim())
        } != null

    suspend fun deleteContact(contact: ContactView): Boolean = act("Deleted ${contact.name}") { it.deleteContact(contact.id) } != null

    // Pipeline setup

    suspend fun addStage(
        name: String,
        probability: Int,
    ): Boolean {
        val n = name.trim()
        return act("Added $n") { it.addStage(n, probability.coerceIn(0, 100).toUInt()) } != null
    }

    suspend fun updateStage(
        stage: StageView,
        name: String,
        probability: Int,
    ): Boolean = act("Stage saved") { it.updateStage(stage.id, name.trim(), probability.coerceIn(0, 100).toUInt()) } != null

    suspend fun deleteStage(stage: StageView): Boolean = act("Stage deleted") { it.deleteStage(stage.id) } != null

    /** Move a stage one place up (-1) or down (+1). */
    suspend fun moveStage(
        stage: StageView,
        offset: Int,
    ): Boolean {
        val ids = stages.map { it.id }.toMutableList()
        val i = ids.indexOf(stage.id)
        val j = i + offset
        if (i < 0 || j !in ids.indices) return false
        ids[i] = ids[j].also { ids[j] = ids[i] }
        return act { it.reorderStages(ids) } != null
    }

    suspend fun setCurrency(code: String): Boolean {
        if (!Money.isValidCode(code)) return invalid(CrmException.InvalidCurrency())
        val c = code.trim().uppercase()
        return act("Currency set to $c") { it.setCurrency(c) } != null
    }

    suspend fun setRottingDays(days: Int): Boolean = act("Saved") { it.setRottingDays(days.coerceAtLeast(0).toUInt()) } != null

    companion object {
        val DEFAULT_SETTINGS = Settings("USD", 14u)
    }
}
