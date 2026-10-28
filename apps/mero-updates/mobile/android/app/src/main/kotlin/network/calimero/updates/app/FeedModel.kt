package network.calimero.updates.app

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import network.calimero.updates.core.ErrorText
import network.calimero.updates.generated.DraftView
import network.calimero.updates.generated.PostCard

/**
 * The Updates tab. Same screen for both sides, weighted differently: the team sees what is due,
 * templates, drafts and the setup checklist; an investor sees unread first and the category filter.
 */
class FeedModel(
    val audience: AudienceModel,
) {
    private val _posts = MutableStateFlow<List<PostCard>>(emptyList())
    val posts: StateFlow<List<PostCard>> = _posts.asStateFlow()
    private val _drafts = MutableStateFlow<List<DraftView>>(emptyList())
    val drafts: StateFlow<List<DraftView>> = _drafts.asStateFlow()
    private val _investorCount = MutableStateFlow(0)
    val investorCount: StateFlow<Int> = _investorCount.asStateFlow()
    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()
    private val _hasLoaded = MutableStateFlow(false)
    val hasLoaded: StateFlow<Boolean> = _hasLoaded.asStateFlow()
    val error = MutableStateFlow<String?>(null)

    /** The category filter, null for all. */
    private val _category = MutableStateFlow<String?>(null)
    val category: StateFlow<String?> = _category.asStateFlow()

    suspend fun load() {
        _isLoading.value = true
        val client = audience.client
        try {
            _posts.value = client.listPosts("update", _category.value, null, PAGE_SIZE).items
            error.value = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error.value = ErrorText.describe(e)
        }
        if (audience.isTeam) {
            // Drafts and the investor count only feed the team's panel: best effort.
            runCatching { client.listDrafts() }.onSuccess { _drafts.value = it }
            runCatching { client.listPeople() }.onSuccess { people -> _investorCount.value = people.count { !it.isTeam } }
        } else {
            _drafts.value = emptyList()
        }
        _isLoading.value = false
        _hasLoaded.value = true
    }

    suspend fun select(category: String?) {
        _category.value = if (_category.value == category) null else category
        load()
    }

    suspend fun discard(draft: DraftView) {
        _drafts.value = _drafts.value.filter { it.id != draft.id }
        try {
            audience.deleteDraft(draft.id)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error.value = ErrorText.describe(e)
        }
    }

    /** One step of the team's "Getting started" list. */
    data class SetupStep(
        val label: String,
        val done: Boolean,
        val target: Target,
    ) {
        enum class Target { SETTINGS, COMPOSE, INVITE }
    }

    val setupSteps: List<SetupStep>
        get() =
            listOf(
                SetupStep(
                    "Name your company and set a cadence",
                    !audience.overview.value
                        ?.companyName
                        .isNullOrEmpty(),
                    SetupStep.Target.SETTINGS,
                ),
                SetupStep(
                    "Add categories (Monthly, Fundraising, Product…)",
                    audience.categories.value.isNotEmpty(),
                    SetupStep.Target.SETTINGS,
                ),
                SetupStep("Publish your first update", (audience.overview.value?.updatesTotal ?: 0uL) > 0uL, SetupStep.Target.COMPOSE),
                SetupStep("Invite your investors", _investorCount.value > 0, SetupStep.Target.INVITE),
            )

    val setupDone: Boolean get() = setupSteps.all { it.done }

    companion object {
        const val PAGE_SIZE = 100u
    }
}
