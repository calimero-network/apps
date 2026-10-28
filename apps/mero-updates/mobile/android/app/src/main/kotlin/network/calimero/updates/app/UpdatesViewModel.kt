package network.calimero.updates.app

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.calimero.mero.account.Enrolment
import com.calimero.mero.compose.MeroAppConfig
import com.calimero.mero.compose.MeroAppSession
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import network.calimero.updates.BuildConfig
import network.calimero.updates.core.UpdatesInvitation

/**
 * The app's session and where the person is: the company list, one company's audiences, or an open
 * audience. The session is the SDK's [MeroAppSession]: Cloud sign-in, the account's relay, deep
 * links and invitations, delegated end to end.
 */
class UpdatesViewModel(
    app: Application,
) : AndroidViewModel(app) {
    val session: MeroAppSession =
        MeroAppSession.create(
            app,
            packageName = UpdatesInvitation.PACKAGE_NAME,
            callbackUrl = BuildConfig.ENROL_CALLBACK_URL,
            config = config(),
            walletUrl = BuildConfig.WALLET_URL.ifEmpty { Enrolment.DEFAULT_WALLET_URL },
            scope = viewModelScope,
        )

    private val prefs = app.getSharedPreferences("mero-updates", Context.MODE_PRIVATE)

    private val _audience = MutableStateFlow(restoreAudience())

    /** The audience on screen, or null for the companies. */
    val audience: StateFlow<AudienceSummary?> = _audience.asStateFlow()

    private val _company = MutableStateFlow<CompanyRoute?>(null)

    /** The company whose audiences are on screen, or null for the company list. */
    val company: StateFlow<CompanyRoute?> = _company.asStateFlow()

    init {
        viewModelScope.launch { session.restore() }
    }

    fun signIn(context: Context) = session.signIn(context)

    fun signOut() {
        close()
        _company.value = null
        viewModelScope.launch { session.signOut() }
    }

    fun handleLink(url: String) {
        viewModelScope.launch { session.handle(url) }
    }

    fun open(audience: AudienceSummary) {
        _audience.value = audience
        prefs.edit().putString(KEY_AUDIENCE, Json.encodeToString(AudienceSummary.serializer(), audience)).apply()
    }

    fun openCompany(route: CompanyRoute?) {
        _company.value = route
    }

    /** Back to the audience list of the company this audience is in. */
    fun switchAudience() {
        val current = _audience.value ?: return
        close()
        _company.value = CompanyRoute(CompanySummary(current.companyId, current.companyName))
    }

    fun land(landing: InvitationLanding) {
        when (landing) {
            is InvitationLanding.Audience -> open(landing.audience)
            is InvitationLanding.Company -> {
                close()
                _company.value = CompanyRoute(landing.company, justJoined = true)
            }
        }
    }

    /** A company was joined: a relayless session now has the admitting relay. */
    suspend fun didJoin() = session.didJoinNamespace()

    private fun close() {
        _audience.value = null
        prefs.edit().remove(KEY_AUDIENCE).apply()
    }

    private fun restoreAudience(): AudienceSummary? =
        prefs.getString(KEY_AUDIENCE, null)?.let { raw ->
            runCatching { Json.decodeFromString(AudienceSummary.serializer(), raw) }.getOrNull()
        }

    private fun config(): MeroAppConfig {
        var config = MeroAppConfig()
        if (BuildConfig.CLOUD_BASE_URL.isNotEmpty()) config = config.copy(cloudBaseUrl = BuildConfig.CLOUD_BASE_URL)
        if (BuildConfig.REGISTRY_URL.isNotEmpty()) config = config.copy(registryUrl = BuildConfig.REGISTRY_URL)
        return config
    }

    private companion object {
        const val KEY_AUDIENCE = "openAudience"
    }
}
