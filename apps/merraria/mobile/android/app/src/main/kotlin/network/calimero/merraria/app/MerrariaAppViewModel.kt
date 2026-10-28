package network.calimero.merraria.app

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
import network.calimero.merraria.BuildConfig

/**
 * The app's one view model: the signed-in session ([MeroAppSession]), the invitation waiting to be
 * confirmed, the world being played and the player's settings. Screens build their own
 * [WorldsModel] / [GameModel] from [session]'s backend.
 */
class MerrariaAppViewModel(
    app: Application,
) : AndroidViewModel(app) {
    val session: MeroAppSession =
        MeroAppSession.create(
            app,
            packageName = MerrariaConstants.PACKAGE_NAME,
            callbackUrl = BuildConfig.ENROL_CALLBACK_URL,
            config =
                MeroAppConfig(
                    registryUrl = BuildConfig.REGISTRY_URL.ifBlank { null },
                ).let { config -> BuildConfig.CLOUD_BASE_URL.ifBlank { null }?.let { config.copy(cloudBaseUrl = it) } ?: config },
            walletUrl = BuildConfig.WALLET_URL.ifBlank { Enrolment.DEFAULT_WALLET_URL },
            scope = viewModelScope,
        )

    val settings: PlayerSettings = PrefsPlayerSettings(app)

    private val _restored = MutableStateFlow(false)

    /** [MeroAppSession.restore] has run once. */
    val restored: StateFlow<Boolean> = _restored.asStateFlow()

    private val _joining = MutableStateFlow<WorldInvitation?>(null)

    /** An invitation the player is being asked about. */
    val joining: StateFlow<WorldInvitation?> = _joining.asStateFlow()

    /** The world being played, kept here so a join that rebuilds the session keeps it. */
    private val _playing = MutableStateFlow<WorldRef?>(null)
    val playing: StateFlow<WorldRef?> = _playing.asStateFlow()

    init {
        viewModelScope.launch {
            session.restore()
            _restored.value = true
            pickUpInvitation()
        }
        viewModelScope.launch {
            session.pendingInvitation.collect { pickUpInvitation() }
        }
        viewModelScope.launch {
            session.backend.collect { pickUpInvitation() }
        }
    }

    fun signIn(context: Context) = session.signIn(context)

    fun cancelSignIn() = session.cancelSignIn()

    fun signOut() {
        viewModelScope.launch {
            _playing.value = null
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
        _joining.value = WorldInvitation.parse(link)
    }

    fun ask(invitation: WorldInvitation) {
        _joining.value = invitation
    }

    fun dismissJoin() {
        _joining.value = null
    }

    /** Redeem the invitation being asked about, then open its world. */
    suspend fun join(invitation: WorldInvitation) {
        val backend = session.backend.value ?: throw MerrariaException(MerrariaException.Kind.NO_RELAY)
        val ref = WorldsModel(backend, session.applicationId).join(invitation) { session.didJoinNamespace() }
        _joining.value = null
        _playing.value = ref
    }

    fun play(ref: WorldRef?) {
        _playing.value = ref
    }
}

/** The player's settings, in SharedPreferences under the web app's keys. */
private class PrefsPlayerSettings(
    context: Context,
) : PlayerSettings {
    private val prefs = context.getSharedPreferences("merraria", Context.MODE_PRIVATE)

    override var name: String
        get() = prefs.getString("mt-name", null)?.trim()?.ifEmpty { null } ?: MerrariaConstants.DEFAULT_PLAYER_NAME
        set(value) {
            prefs.edit().putString("mt-name", value.trim().take(MerrariaConstants.MAX_PLAYER_NAME)).apply()
        }

    override var zoom: Double
        get() =
            prefs
                .getFloat("mt-zoom", MerrariaConstants.DEFAULT_ZOOM.toFloat())
                .toDouble()
                .takeIf { it in MerrariaConstants.MIN_ZOOM..MerrariaConstants.MAX_ZOOM } ?: MerrariaConstants.DEFAULT_ZOOM
        set(value) {
            prefs.edit().putFloat("mt-zoom", MerrariaConstants.clampZoom(value).toFloat()).apply()
        }
}
