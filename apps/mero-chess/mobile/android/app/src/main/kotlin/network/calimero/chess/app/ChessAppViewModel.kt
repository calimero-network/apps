package network.calimero.chess.app

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
import network.calimero.chess.BuildConfig

/**
 * The app's one view model: the signed-in session ([MeroAppSession]), the invitation waiting to be
 * confirmed, and the player's name. Screens build their own [LobbyModel] / [TableModel] from
 * [session]'s backend.
 */
class ChessAppViewModel(
    app: Application,
) : AndroidViewModel(app) {
    val session: MeroAppSession =
        MeroAppSession.create(
            app,
            packageName = ChessConstants.PACKAGE_NAME,
            callbackUrl = BuildConfig.ENROL_CALLBACK_URL,
            config =
                MeroAppConfig(
                    registryUrl = BuildConfig.REGISTRY_URL.ifBlank { null },
                ).let { config -> BuildConfig.CLOUD_BASE_URL.ifBlank { null }?.let { config.copy(cloudBaseUrl = it) } ?: config },
            walletUrl = BuildConfig.WALLET_URL.ifBlank { Enrolment.DEFAULT_WALLET_URL },
            scope = viewModelScope,
        )

    val names: NameStore = PrefsNameStore(app)

    private val _restored = MutableStateFlow(false)

    /** [MeroAppSession.restore] has run once. */
    val restored: StateFlow<Boolean> = _restored.asStateFlow()

    private val _joining = MutableStateFlow<ChessInvitation?>(null)

    /** An invitation the player is being asked about. */
    val joining: StateFlow<ChessInvitation?> = _joining.asStateFlow()

    /** The table to open, kept here so a join that rebuilds the session keeps it. */
    private val _openTable = MutableStateFlow<TableRef?>(null)
    val openTable: StateFlow<TableRef?> = _openTable.asStateFlow()

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
            _openTable.value = null
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
        _joining.value = ChessInvitation.parse(link)
    }

    fun ask(invitation: ChessInvitation) {
        _joining.value = invitation
    }

    fun dismissJoin() {
        _joining.value = null
    }

    /** Redeem the invitation being asked about, then open its table. */
    suspend fun join(invitation: ChessInvitation) {
        val backend = session.backend.value ?: throw ChessException(ChessException.Kind.NO_RELAY)
        val ref = LobbyModel(backend, session.applicationId).join(invitation) { session.didJoinNamespace() }
        _joining.value = null
        _openTable.value = ref
    }

    fun open(ref: TableRef?) {
        _openTable.value = ref
    }
}

/** The player's name, in SharedPreferences under the web app's key. */
private class PrefsNameStore(
    context: Context,
) : NameStore {
    private val prefs = context.getSharedPreferences("mero-chess", Context.MODE_PRIVATE)
    override var name: String
        get() = prefs.getString(KEY, "").orEmpty()
        set(value) {
            prefs.edit().putString(KEY, value).apply()
        }

    companion object {
        const val KEY = "mero-chess:name"
    }
}
