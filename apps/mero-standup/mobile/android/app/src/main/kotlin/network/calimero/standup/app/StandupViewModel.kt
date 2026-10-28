package network.calimero.standup.app

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
import network.calimero.standup.BuildConfig
import network.calimero.standup.core.StandupInvitation

/**
 * The app's session and which team is open. The session is the SDK's [MeroAppSession]: Cloud
 * sign-in, the account's relay, deep links and invitations, delegated end to end.
 */
class StandupViewModel(
    app: Application,
) : AndroidViewModel(app) {
    val session: MeroAppSession =
        MeroAppSession.create(
            app,
            packageName = StandupInvitation.PACKAGE_NAME,
            callbackUrl = BuildConfig.ENROL_CALLBACK_URL,
            config = config(),
            walletUrl = BuildConfig.WALLET_URL.ifEmpty { Enrolment.DEFAULT_WALLET_URL },
            scope = viewModelScope,
        )

    private val prefs = app.getSharedPreferences("mero-standup", Context.MODE_PRIVATE)

    private val _openTeam = MutableStateFlow<TeamSummary?>(null)

    /** The team on screen, or null for the team list. */
    val openTeam: StateFlow<TeamSummary?> = _openTeam.asStateFlow()

    init {
        viewModelScope.launch { session.restore() }
    }

    fun signIn(context: Context) = session.signIn(context)

    fun signOut() {
        _openTeam.value = null
        viewModelScope.launch { session.signOut() }
    }

    fun handleLink(url: String) {
        viewModelScope.launch { session.handle(url) }
    }

    fun open(team: TeamSummary?) {
        _openTeam.value = team
    }

    /** A team was joined: a relayless session now has the admitting relay. */
    suspend fun didJoin() = session.didJoinNamespace()

    /** Whether the first-run name prompt was skipped for this team. */
    fun welcomed(contextId: String): Boolean = prefs.getBoolean("welcomed:$contextId", false)

    fun markWelcomed(contextId: String) {
        prefs.edit().putBoolean("welcomed:$contextId", true).apply()
    }

    private fun config(): MeroAppConfig {
        var config = MeroAppConfig()
        if (BuildConfig.CLOUD_BASE_URL.isNotEmpty()) config = config.copy(cloudBaseUrl = BuildConfig.CLOUD_BASE_URL)
        if (BuildConfig.REGISTRY_URL.isNotEmpty()) config = config.copy(registryUrl = BuildConfig.REGISTRY_URL)
        return config
    }
}
