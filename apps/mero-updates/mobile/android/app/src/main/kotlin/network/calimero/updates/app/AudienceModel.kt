package network.calimero.updates.app

import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import network.calimero.updates.core.ErrorText
import network.calimero.updates.core.UpdatesInvitation
import network.calimero.updates.core.updatesClient
import network.calimero.updates.generated.CategoryView
import network.calimero.updates.generated.MeView
import network.calimero.updates.generated.Overview
import network.calimero.updates.generated.UpdatesClient

/**
 * One open audience: who you are in it, its overview and categories, every write, and a [version]
 * that moves whenever its state may have changed (a write from here, a contract event, or the
 * poll). Every tab re-reads when it moves — the web's `AudienceShell` revision.
 */
class AudienceModel(
    val audience: AudienceSummary,
    val contextId: String,
    val backend: MeroAppBackend,
) {
    val client: UpdatesClient = updatesClient(backend, contextId)

    private val _me = MutableStateFlow<MeView?>(null)
    val me: StateFlow<MeView?> = _me.asStateFlow()
    private val _overview = MutableStateFlow<Overview?>(null)
    val overview: StateFlow<Overview?> = _overview.asStateFlow()
    private val _categories = MutableStateFlow<List<CategoryView>>(emptyList())
    val categories: StateFlow<List<CategoryView>> = _categories.asStateFlow()
    private val _version = MutableStateFlow(0)
    val version: StateFlow<Int> = _version.asStateFlow()
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()
    private val _hasLoaded = MutableStateFlow(false)
    val hasLoaded: StateFlow<Boolean> = _hasLoaded.asStateFlow()

    /** How often to re-read with a live stream up, and without one. */
    var pollWithStreamMs = 30_000L
    var pollWithoutStreamMs = 8_000L

    val isTeam: Boolean get() = _me.value?.isTeam ?: false
    val isAdmin: Boolean get() = _me.value?.isAdmin ?: false

    /** "Admin", "Team" or "Investor". */
    val roleLabel: String?
        get() = _me.value?.let { if (it.isTeam) (if (it.isAdmin) "Admin" else "Team") else "Investor" }

    val companyTitle: String
        get() = _overview.value?.companyName?.ifEmpty { null } ?: audience.companyName.ifEmpty { "Your company" }

    /** Whether to ask "who are you?": the contract knows you and you have no name. */
    val needsProfile: Boolean get() = _me.value?.name?.isBlank() ?: false

    fun category(id: String): CategoryView? = if (id.isEmpty()) null else _categories.value.firstOrNull { it.id == id }

    /** Re-read who you are, the overview and the categories. */
    suspend fun load() {
        try {
            coroutineScope {
                val me = async { client.getMe() }
                val overview = async { client.getOverview() }
                val categories = async { client.listCategories() }
                _me.value = me.await()
                _overview.value = overview.await()
                _categories.value = categories.await()
            }
            _error.value = null
            _hasLoaded.value = true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _error.value = ErrorText.describe(e)
        }
    }

    /** Something may have changed: every tab re-reads. */
    fun bump() {
        _version.value += 1
    }

    /** Run one write, then re-read everything. */
    suspend fun <T> act(write: suspend (UpdatesClient) -> T): T {
        try {
            return write(client)
        } finally {
            bump()
            runCatching { load() }
        }
    }

    // You

    suspend fun setProfile(
        name: String,
        firm: String,
    ) = act { it.setProfile(name.trim(), firm.trim()) }

    /** Mute or unmute one category; muted ones stop counting as unread. */
    suspend fun toggleMuted(category: CategoryView) {
        val muted = _categories.value.filter { it.muted }.map { it.id }
        val next = if (category.muted) muted.filter { it != category.id } else muted + category.id
        act { it.setMutedCategories(next) }
    }

    // Posts

    suspend fun react(
        postId: String,
        emoji: String,
        on: Boolean,
    ) = act { it.react(postId, emoji, on) }

    suspend fun deletePost(postId: String) = act { it.deletePost(postId) }

    suspend fun setQuestionStatus(
        postId: String,
        answered: Boolean,
    ) = act { it.setQuestionStatus(postId, if (answered) "answered" else "open") }

    suspend fun askQuestion(
        title: String,
        body: String,
    ): String = act { it.askQuestion(title.trim(), body.trim(), null) }

    // Replies

    suspend fun addComment(
        postId: String,
        parentId: String?,
        body: String,
    ) {
        act { it.addComment(postId, parentId, body.trim()) }
    }

    suspend fun editComment(
        commentId: String,
        body: String,
    ) = act { it.editComment(commentId, body.trim()) }

    suspend fun deleteComment(commentId: String) = act { it.deleteComment(commentId) }

    // Asks and offers

    suspend fun offerHelp(
        askId: String,
        note: String,
    ) = act { it.offerHelp(askId, note.trim()) }

    suspend fun withdrawOffer(askId: String) = act { it.withdrawOffer(askId) }

    /** "accepted", "declined", or "offered" to undo. */
    suspend fun setOfferStatus(
        askId: String,
        account: String,
        status: String,
    ) = act { it.setOfferStatus(askId, account, status) }

    suspend fun setAskStatus(
        askId: String,
        resolved: Boolean,
    ) = act { it.setAskStatus(askId, if (resolved) "resolved" else "open") }

    // Team

    suspend fun setTeammate(
        account: String,
        on: Boolean,
    ) = act { if (on) it.addTeammate(account) else it.removeTeammate(account) }

    suspend fun deleteDraft(draftId: String) = act { it.deleteDraft(draftId) }

    /** A link that joins this audience's company and lands in this audience. */
    suspend fun invitation(): UpdatesInvitation =
        UpdatesInvitation(
            backend.createInvitation(audience.companyId),
            UpdatesInvitation.Kind.AUDIENCE,
            audience.companyId,
            companyName = companyTitle,
            audienceId = audience.audienceId,
            contextId = contextId,
            audienceName = audience.name,
        )

    // Live

    /**
     * Follow the audience while it is open: the relay's event stream when it has one, coalesced (a
     * publish emits several events), and a poll either way, since a dropped stream would otherwise
     * leave the feed stale with nothing saying so. Runs until cancelled.
     */
    suspend fun follow() {
        coroutineScope {
            launch { listen() }
            launch { poll() }
        }
    }

    private suspend fun listen() {
        if (!backend.canSubscribe) return
        coroutineScope {
            var nudge: Job? = null
            try {
                backend.events(contextId).collect {
                    nudge?.cancel()
                    nudge =
                        launch {
                            delay(NUDGE_MS)
                            bump()
                            load()
                        }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // The poll carries on.
            }
        }
    }

    private suspend fun poll() {
        coroutineScope {
            while (isActive) {
                delay(if (backend.canSubscribe) pollWithStreamMs else pollWithoutStreamMs)
                bump()
                load()
            }
        }
    }

    private companion object {
        const val NUDGE_MS = 250L
    }
}
