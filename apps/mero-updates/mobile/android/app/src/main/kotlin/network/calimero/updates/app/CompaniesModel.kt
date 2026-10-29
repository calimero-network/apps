package network.calimero.updates.app

import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import network.calimero.updates.core.ErrorText
import network.calimero.updates.core.UpdatesInvitation

/** The company list: the account's namespaces for this app, founding one and joining one by invitation. */
class CompaniesModel(
    val backend: MeroAppBackend,
) {
    private val _companies = MutableStateFlow<List<CompanySummary>>(emptyList())
    val companies: StateFlow<List<CompanySummary>> = _companies.asStateFlow()
    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()
    private val _hasLoaded = MutableStateFlow(false)
    val hasLoaded: StateFlow<Boolean> = _hasLoaded.asStateFlow()
    private val _isWorking = MutableStateFlow(false)
    val isWorking: StateFlow<Boolean> = _isWorking.asStateFlow()
    val error = MutableStateFlow<String?>(null)

    /** Why the last founded company cannot be invited to yet (the cloud did not host it). */
    private val _hostingNote = MutableStateFlow<String?>(null)
    val hostingNote: StateFlow<String?> = _hostingNote.asStateFlow()

    /** Whether a relay serves the account. Without one only joining works. */
    val hasRelay: Boolean get() = backend.hasRelay

    suspend fun load() {
        if (!backend.hasRelay) {
            _companies.value = emptyList()
            _hasLoaded.value = true
            return
        }
        _isLoading.value = true
        try {
            _companies.value =
                backend
                    .listNamespaces()
                    .map { CompanySummary(it.id, it.name.orEmpty(), it.memberCount) }
                    .sortedWith(byTitle)
            error.value = null
        } catch (e: Exception) {
            error.value = ErrorText.describe(e)
        } finally {
            _isLoading.value = false
            _hasLoaded.value = true
        }
    }

    /** Found a company. No audience is made here: that is the next screen's job. */
    suspend fun create(name: String): CompanySummary? {
        val trimmed = name.trim()
        if (trimmed.isEmpty()) return null
        _isWorking.value = true
        return try {
            val founded = backend.foundNamespace(trimmed)
            _hostingNote.value =
                if (founded.haEnabled) null else founded.haError ?: "This company is not hosted yet — nobody can be invited to it."
            val company = CompanySummary(founded.namespaceId, trimmed, 1)
            _companies.value = (_companies.value.filter { it.id != company.id } + company).sortedWith(byTitle)
            error.value = null
            company
        } catch (e: Exception) {
            error.value = ErrorText.describe(e)
            null
        } finally {
            _isWorking.value = false
        }
    }

    /** Redeem an invitation: join its company, then land in the audience it names, else on its audience list. */
    suspend fun join(invitation: UpdatesInvitation): InvitationLanding? {
        _isWorking.value = true
        return try {
            backend.joinNamespace(invitation.namespaceId, invitation.invitation)
            val company = CompanySummary(invitation.namespaceId, invitation.companyName.orEmpty())
            if (_companies.value.none { it.id == company.id }) _companies.value = _companies.value + company
            error.value = null
            val audienceId = invitation.audienceId
            val contextId = invitation.contextId
            if (audienceId != null && contextId != null) {
                InvitationLanding.Audience(
                    AudienceSummary(
                        invitation.namespaceId,
                        audienceId,
                        contextId,
                        invitation.audienceName.orEmpty(),
                        invitation.companyName.orEmpty(),
                    ),
                )
            } else {
                InvitationLanding.Company(company)
            }
        } catch (e: Exception) {
            error.value = ErrorText.describe(e)
            null
        } finally {
            _isWorking.value = false
        }
    }

    private companion object {
        val byTitle = compareBy<CompanySummary, String>(String.CASE_INSENSITIVE_ORDER) { it.title }
    }
}
