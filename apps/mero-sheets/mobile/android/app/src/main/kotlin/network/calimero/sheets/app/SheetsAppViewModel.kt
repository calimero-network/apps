package network.calimero.sheets.app

import android.app.Activity
import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.calimero.mero.account.Enrolment
import com.calimero.mero.cloud.CloudClient
import com.calimero.mero.compose.MeroAppConfig
import com.calimero.mero.compose.MeroAppSession
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import network.calimero.sheets.BuildConfig
import network.calimero.sheets.core.MeroSheets
import network.calimero.sheets.core.PrefsSheetsStore
import network.calimero.sheets.core.SheetsInvitation
import network.calimero.sheets.core.SheetsStore
import network.calimero.sheets.core.WorkspaceModel

/** A workspace joined from an invitation, and the spreadsheet the link named. */
data class JoinedWorkspace(
    val namespaceId: String,
    val contextId: String?,
)

/**
 * The signed-in account for the app's life: Calimero Cloud sign-in, the relay-backed backend, and
 * the links the activity receives (the wallet's callback, workspace invitations).
 */
class SheetsAppViewModel(
    app: Application,
) : AndroidViewModel(app) {
    val session: MeroAppSession =
        MeroAppSession.create(
            app,
            packageName = MeroSheets.PACKAGE_NAME,
            callbackUrl = BuildConfig.ENROL_CALLBACK_URL,
            config =
                MeroAppConfig(
                    registryUrl = BuildConfig.REGISTRY_URL.ifBlank { null },
                    cloudBaseUrl = BuildConfig.CLOUD_BASE_URL.ifBlank { CloudClient.DEFAULT_BASE_URL },
                ),
            walletUrl = BuildConfig.WALLET_URL.ifBlank { Enrolment.DEFAULT_WALLET_URL },
            scope = viewModelScope,
        )

    val store: SheetsStore = PrefsSheetsStore(app)

    private val _justJoined = MutableStateFlow<JoinedWorkspace?>(null)

    /** A workspace joined from an invitation (its spreadsheets may not have arrived yet), and the one the link named. */
    val justJoined: StateFlow<JoinedWorkspace?> = _justJoined.asStateFlow()

    init {
        viewModelScope.launch { session.restore() }
    }

    fun handleLink(url: String) {
        viewModelScope.launch { session.handle(url) }
    }

    fun signIn(activity: Activity) = session.signIn(activity)

    fun signOut() {
        viewModelScope.launch { session.signOut() }
    }

    fun clearJustJoined() {
        _justJoined.value = null
    }

    /** Redeem an invitation, then reconnect (a relayless account now has the admitting relay). */
    suspend fun join(invitation: SheetsInvitation) {
        val backend = session.backend.value ?: return
        WorkspaceModel(backend, session.applicationId, store).join(invitation)
        _justJoined.value = JoinedWorkspace(invitation.namespaceId, invitation.contextId)
        session.didJoinNamespace()
        session.dismissPendingInvitation()
    }
}
