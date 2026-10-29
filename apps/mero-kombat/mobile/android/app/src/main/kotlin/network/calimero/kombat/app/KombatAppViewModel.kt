package network.calimero.kombat.app

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
import network.calimero.kombat.BuildConfig

/** Where the app is past the arenas list. (iOS `Route`.) */
sealed class Route {
    data class Arena(
        val ref: ArenaRef,
    ) : Route()

    data object Practice : Route()
}

/**
 * The app's one view model: the signed-in session ([MeroAppSession]), the invitation waiting to be
 * confirmed, the screen opened past the arenas, and the player's name and fighter. Screens build their
 * own [LobbyModel] / [ArenaModel] from [session]'s backend.
 */
class KombatAppViewModel(
    app: Application,
) : AndroidViewModel(app) {
    val session: MeroAppSession =
        MeroAppSession.create(
            app,
            packageName = KombatConstants.PACKAGE_NAME,
            callbackUrl = BuildConfig.ENROL_CALLBACK_URL,
            config =
                MeroAppConfig(
                    registryUrl = BuildConfig.REGISTRY_URL.ifBlank { null },
                ).let { config -> BuildConfig.CLOUD_BASE_URL.ifBlank { null }?.let { config.copy(cloudBaseUrl = it) } ?: config },
            walletUrl = BuildConfig.WALLET_URL.ifBlank { Enrolment.DEFAULT_WALLET_URL },
            scope = viewModelScope,
        )

    val store: PlayerStore = PrefsPlayerStore(app)

    private val _restored = MutableStateFlow(false)

    /** [MeroAppSession.restore] has run once. */
    val restored: StateFlow<Boolean> = _restored.asStateFlow()

    private val _joining = MutableStateFlow<KombatInvitation?>(null)

    /** An invitation the player is being asked about. */
    val joining: StateFlow<KombatInvitation?> = _joining.asStateFlow()

    /** The screen past the arenas, kept here so a join that rebuilds the session keeps it. */
    private val _route = MutableStateFlow<Route?>(null)
    val route: StateFlow<Route?> = _route.asStateFlow()

    init {
        viewModelScope.launch {
            session.restore()
            _restored.value = true
            pickUpInvitation()
        }
        viewModelScope.launch { session.pendingInvitation.collect { pickUpInvitation() } }
        viewModelScope.launch { session.backend.collect { pickUpInvitation() } }
    }

    fun signIn(context: Context) = session.signIn(context)

    fun cancelSignIn() = session.cancelSignIn()

    fun signOut() {
        viewModelScope.launch {
            _route.value = null
            session.signOut()
        }
    }

    /** Every link the activity receives. */
    fun handleLink(url: String) {
        viewModelScope.launch { session.handle(url) }
    }

    /** An invitation link the system handed the app is asked about once signed in. */
    private fun pickUpInvitation() {
        if (!_restored.value || !session.isSignedIn) return
        val link = session.pendingInvitation.value ?: return
        session.dismissPendingInvitation()
        _joining.value = KombatInvitation.parse(link)
    }

    fun ask(invitation: KombatInvitation) {
        _joining.value = invitation
    }

    fun dismissJoin() {
        _joining.value = null
    }

    /** Redeem the invitation being asked about, then open its arena. */
    suspend fun join(invitation: KombatInvitation) {
        val backend = session.backend.value ?: throw KombatException(KombatException.Kind.NO_RELAY)
        val ref = LobbyModel(backend, session.applicationId).join(invitation) { session.didJoinNamespace() }
        _joining.value = null
        _route.value = Route.Arena(ref)
    }

    fun open(route: Route?) {
        _route.value = route
    }
}

/** The player's name, fighter and sound, in SharedPreferences under the web app's keys. */
private class PrefsPlayerStore(
    context: Context,
) : PlayerStore {
    private val prefs = context.getSharedPreferences("mero-kombat", Context.MODE_PRIVATE)
    override var name: String
        get() = prefs.getString("mero-kombat:name", "").orEmpty()
        set(value) {
            prefs.edit().putString("mero-kombat:name", value).apply()
        }
    override var fighter: String
        get() = prefs.getString("mero-kombat:fighter", null)?.ifEmpty { null } ?: "kinetic"
        set(value) {
            prefs.edit().putString("mero-kombat:fighter", value).apply()
        }
    override var muted: Boolean
        get() = prefs.getBoolean("mero-kombat:muted", false)
        set(value) {
            prefs.edit().putBoolean("mero-kombat:muted", value).apply()
        }
}
