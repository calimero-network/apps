package network.calimero.updates.app

import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.JsonObject
import network.calimero.updates.core.ErrorText
import network.calimero.updates.core.UpdatesException
import network.calimero.updates.core.UpdatesInvitation

/** One company: its audiences, making one, inviting people, entering one. */
class CompanyModel(
    val company: CompanySummary,
    val backend: MeroAppBackend,
    private val applicationId: String?,
    /** Just joined: an empty list means "still syncing", not "no audiences". */
    val justJoined: Boolean = false,
) {
    private val _audiences = MutableStateFlow<List<AudienceSummary>>(emptyList())
    val audiences: StateFlow<List<AudienceSummary>> = _audiences.asStateFlow()
    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()
    private val _hasLoaded = MutableStateFlow(false)
    val hasLoaded: StateFlow<Boolean> = _hasLoaded.asStateFlow()

    /** What is in flight: "create", "invite", "invite:<audience>", "enter:<audience>". */
    private val _pending = MutableStateFlow<String?>(null)
    val pending: StateFlow<String?> = _pending.asStateFlow()
    val error = MutableStateFlow<String?>(null)

    val isSyncing: Boolean get() = justJoined && _hasLoaded.value && _audiences.value.isEmpty()

    suspend fun load() {
        _isLoading.value = true
        try {
            _audiences.value =
                backend
                    .listSubgroups(company.id)
                    .map { AudienceSummary(company.id, it.groupId, it.contextIds.firstOrNull(), it.name.orEmpty(), company.name) }
                    .sortedWith(byTitle)
            error.value = null
        } catch (e: Exception) {
            error.value = ErrorText.describe(e)
        } finally {
            _isLoading.value = false
            _hasLoaded.value = true
        }
    }

    /** While a just-joined company has no audiences listed, re-read every few seconds (the web's join sync). */
    suspend fun syncWhileEmpty(intervalMs: Long = SYNC_MS) {
        while (justJoined && _audiences.value.isEmpty()) {
            delay(intervalMs)
            load()
        }
    }

    /** Create an audience: an open subgroup (every company member can reach it) and the context that holds its updates. */
    suspend fun create(name: String): AudienceSummary? {
        val trimmed = name.trim()
        if (trimmed.isEmpty()) return null
        return attempt("create") {
            val groupId = backend.createSubgroup(company.id, trimmed, isPublic = true)
            val contextId = backend.createContext(groupId, applicationId(), trimmed, JsonObject(emptyMap()))
            val audience = AudienceSummary(company.id, groupId, contextId, trimmed, company.name)
            _audiences.value = (_audiences.value + audience).sortedWith(byTitle)
            audience
        }
    }

    /** Open an audience: join its context first when the account is not in it yet. */
    suspend fun enter(audience: AudienceSummary): AudienceSummary? {
        val contextId = audience.contextId
        if (contextId == null) {
            error.value = UpdatesException.NoAudienceContext(audience.title).message
            return null
        }
        return attempt("enter:${audience.audienceId}") {
            if (!backend.isMember(contextId)) backend.joinContext(contextId)
            audience
        }
    }

    /** A link that joins the whole company and lands on its audience list. */
    suspend fun companyInvitation(): UpdatesInvitation? =
        attempt("invite") {
            UpdatesInvitation(backend.createInvitation(company.id), UpdatesInvitation.Kind.NAMESPACE, company.id, companyName = company.name)
        }

    /** A link that joins the company and lands in one audience. */
    suspend fun audienceInvitation(audience: AudienceSummary): UpdatesInvitation? =
        attempt("invite:${audience.audienceId}") {
            UpdatesInvitation(
                backend.createInvitation(company.id),
                UpdatesInvitation.Kind.AUDIENCE,
                company.id,
                companyName = company.name,
                audienceId = audience.audienceId,
                contextId = audience.contextId,
                audienceName = audience.name,
            )
        }

    private suspend fun applicationId(): String {
        if (!applicationId.isNullOrEmpty()) return applicationId
        return backend
            .listNamespaces()
            .firstOrNull { it.id == company.id }
            ?.applicationId
            ?.ifEmpty { null } ?: throw UpdatesException.NoApplication()
    }

    private suspend fun <T> attempt(
        key: String,
        body: suspend () -> T,
    ): T? {
        _pending.value = key
        return try {
            val value = body()
            error.value = null
            value
        } catch (e: Exception) {
            error.value = ErrorText.describe(e)
            null
        } finally {
            _pending.value = null
        }
    }

    private companion object {
        const val SYNC_MS = 3_000L
        val byTitle = compareBy<AudienceSummary, String>(String.CASE_INSENSITIVE_ORDER) { it.title }
    }
}
