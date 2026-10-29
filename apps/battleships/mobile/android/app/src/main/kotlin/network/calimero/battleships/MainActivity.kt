package network.calimero.battleships

import android.app.Application
import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.calimero.mero.compose.MeroAppConfig
import com.calimero.mero.compose.MeroAppSession
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import network.calimero.battleships.core.Battleships
import network.calimero.battleships.core.BoardStore
import network.calimero.battleships.core.InvitationModel
import network.calimero.battleships.core.StoredBoard
import network.calimero.battleships.ui.BattleshipsApp

/**
 * The one activity. Links arrive here, on the launch intent (cold start) or through [onNewIntent],
 * and go to [BattleshipsViewModel.handleLink]: the wallet's sign-in redirect, or an invitation
 * (`https://links.calimero.network/com.calimero.battleships/join?invitation=…`).
 */
class MainActivity : ComponentActivity() {
    private val vm: BattleshipsViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) consume(intent)
        setContent { BattleshipsApp(vm = vm, onSignIn = { vm.session.signIn(this) }) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        consume(intent)
    }

    private fun consume(intent: Intent?) {
        val url = intent?.data?.toString() ?: return
        vm.handleLink(url)
        // Handled once: a configuration change must not replay it.
        intent.data = null
    }
}

/** The session, the invitation being redeemed and the board store, for the app's life. */
class BattleshipsViewModel(
    app: Application,
) : AndroidViewModel(app) {
    val session: MeroAppSession =
        MeroAppSession.create(
            app,
            packageName = Battleships.PACKAGE_NAME,
            callbackUrl = BuildConfig.ENROL_CALLBACK_URL,
            config =
                MeroAppConfig(
                    registryUrl = BuildConfig.REGISTRY_URL.ifBlank { null },
                    cloudBaseUrl = BuildConfig.CLOUD_BASE_URL.ifBlank { MeroAppConfig().cloudBaseUrl },
                ),
            walletUrl = BuildConfig.WALLET_URL.ifBlank { com.calimero.mero.account.Enrolment.DEFAULT_WALLET_URL },
            scope = viewModelScope,
        )
    val invitation = InvitationModel()
    val boards: BoardStore = PrefsBoardStore(app)

    init {
        viewModelScope.launch { session.restore() }
    }

    /** Every link the activity receives. */
    fun handleLink(url: String) =
        viewModelScope.launch {
            session.handle(url)
            session.pendingInvitation.value?.let {
                invitation.open(it)
                session.dismissPendingInvitation()
            }
        }
}

/**
 * Boards in this app's private SharedPreferences: on this device only (the manifest turns backup
 * off), the web app's JSON under the web app's key.
 */
class PrefsBoardStore(
    context: Context,
) : BoardStore {
    private val prefs = context.getSharedPreferences("battleships-boards", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }

    override fun load(
        owner: String,
        matchId: String,
    ): StoredBoard? =
        prefs.getString(BoardStore.key(owner, matchId), null)?.let {
            runCatching { json.decodeFromString(StoredBoard.serializer(), it) }.getOrNull()
        }

    override fun save(
        board: StoredBoard,
        owner: String,
        matchId: String,
    ): Boolean = prefs.edit().putString(BoardStore.key(owner, matchId), json.encodeToString(StoredBoard.serializer(), board)).commit()

    override fun clear(
        owner: String,
        matchId: String,
    ) {
        prefs.edit().remove(BoardStore.key(owner, matchId)).apply()
    }
}
