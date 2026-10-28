package network.calimero.calendar.app

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
import network.calimero.calendar.BuildConfig
import network.calimero.calendar.data.CalendarConstants
import network.calimero.calendar.data.LocalNames
import network.calimero.calendar.data.PrefsKeyValueStore
import network.calimero.calendar.data.PrivateEventStore

/** Where the app is: the teams list, a team's calendars, or one calendar. */
sealed interface Screen {
    data object Teams : Screen

    data class TeamCalendars(
        val team: Team,
    ) : Screen

    data class Calendar(
        val team: Team,
        val calendar: CalendarRef,
    ) : Screen
}

/**
 * The app's one Android view model: it owns the [MeroAppSession] (sign-in, restore, links, the
 * backend), the device-local stores, and the navigation stack.
 */
class CalendarAppViewModel(
    app: Application,
) : AndroidViewModel(app) {
    val session: MeroAppSession =
        MeroAppSession.create(
            app,
            packageName = CalendarConstants.PACKAGE_NAME,
            callbackUrl = BuildConfig.ENROL_CALLBACK_URL,
            config =
                MeroAppConfig(
                    packageName = CalendarConstants.PACKAGE_NAME,
                    registryUrl = BuildConfig.REGISTRY_URL.ifBlank { null },
                    cloudBaseUrl = BuildConfig.CLOUD_BASE_URL.ifBlank { MeroAppConfig().cloudBaseUrl },
                ),
            walletUrl = BuildConfig.WALLET_URL.ifBlank { Enrolment.DEFAULT_WALLET_URL },
            scope = viewModelScope,
        )

    private val prefs = PrefsKeyValueStore(app.getSharedPreferences("mero-calendar", Context.MODE_PRIVATE))
    val names = LocalNames(prefs)
    val privateStore = PrivateEventStore(prefs)

    private val _restored = MutableStateFlow(false)
    val restored: StateFlow<Boolean> = _restored.asStateFlow()

    private val _stack = MutableStateFlow<List<Screen>>(listOf(Screen.Teams))
    val stack: StateFlow<List<Screen>> = _stack.asStateFlow()

    /** Teams joined in this run (their calendars may still be syncing). */
    val justJoined = mutableSetOf<String>()

    init {
        viewModelScope.launch {
            session.restore()
            _restored.value = true
        }
    }

    fun signIn(context: Context) = session.signIn(context)

    fun signOut() =
        viewModelScope.launch {
            session.signOut()
            _stack.value = listOf(Screen.Teams)
        }

    fun handleLink(url: String) = viewModelScope.launch { session.handle(url) }

    fun push(screen: Screen) {
        _stack.value = _stack.value + screen
    }

    fun pop(): Boolean {
        if (_stack.value.size <= 1) return false
        _stack.value = _stack.value.dropLast(1)
        return true
    }

    /** After redeeming an invitation: reconnect a relayless session, then open the team. */
    suspend fun didJoin(team: Team) {
        justJoined += team.id
        session.didJoinNamespace()
        _stack.value = listOf(Screen.Teams, Screen.TeamCalendars(team))
    }
}
