package network.calimero.blocks.app

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
import network.calimero.blocks.BuildConfig

/**
 * The app's one view model: the signed-in session ([MeroAppSession]), the invitation waiting to be
 * confirmed, the world being played and the player's settings. Screens build their own
 * [WorldsModel] / [GameModel] from [session]'s backend.
 */
class BlocksAppViewModel(
    app: Application,
) : AndroidViewModel(app) {
    val session: MeroAppSession =
        MeroAppSession.create(
            app,
            packageName = BlocksConstants.PACKAGE_NAME,
            callbackUrl = BuildConfig.ENROL_CALLBACK_URL,
            config =
                MeroAppConfig(
                    registryUrl = BuildConfig.REGISTRY_URL.ifBlank { null },
                ).let { config -> BuildConfig.CLOUD_BASE_URL.ifBlank { null }?.let { config.copy(cloudBaseUrl = it) } ?: config },
            walletUrl = BuildConfig.WALLET_URL.ifBlank { Enrolment.DEFAULT_WALLET_URL },
            scope = viewModelScope,
        )

    val settings = PlayerSettings(PrefsSettingsStore(app))

    private val _restored = MutableStateFlow(false)

    /** [MeroAppSession.restore] has run once. */
    val restored: StateFlow<Boolean> = _restored.asStateFlow()

    private val _joining = MutableStateFlow<BlocksInvitation?>(null)

    /** An invitation the player is being asked about. */
    val joining: StateFlow<BlocksInvitation?> = _joining.asStateFlow()

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

    /** "Me" as the contract keys players: this device's signing key. */
    val myId: String get() =
        session.client.account.deviceKeys
            .load()
            ?.signPublicKey
            .orEmpty()

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
        _joining.value = BlocksInvitation.parse(link)
    }

    fun ask(invitation: BlocksInvitation) {
        _joining.value = invitation
    }

    fun dismissJoin() {
        _joining.value = null
    }

    /** Redeem the invitation being asked about, then open its world. */
    suspend fun join(invitation: BlocksInvitation) {
        val backend = session.backend.value ?: throw BlocksException(BlocksException.Kind.NO_RELAY)
        val ref = WorldsModel(backend, session.applicationId).join(invitation) { session.didJoinNamespace() }
        _joining.value = null
        _playing.value = ref
    }

    fun play(ref: WorldRef?) {
        _playing.value = ref
    }
}

private class PrefsSettingsStore(
    context: Context,
) : SettingsStore {
    private val prefs = context.getSharedPreferences("mero-blocks", Context.MODE_PRIVATE)

    override fun string(key: String): String? = prefs.getString(key, null)

    override fun double(key: String): Double? = if (prefs.contains(key)) prefs.getFloat(key, 1f).toDouble() else null

    override fun put(
        key: String,
        value: String,
    ) = prefs.edit().putString(key, value).apply()

    override fun put(
        key: String,
        value: Double,
    ) = prefs.edit().putFloat(key, value.toFloat()).apply()
}
