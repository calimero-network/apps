package network.calimero.issues.app

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
import network.calimero.issues.BuildConfig
import network.calimero.issues.core.PrefsTrackerStore
import network.calimero.issues.core.Tracker
import network.calimero.issues.core.TrackerInvitation
import network.calimero.issues.core.TrackerStore
import network.calimero.issues.core.WorkspaceModel

/**
 * The signed-in account for the app's life: Calimero Cloud sign-in, the relay-backed backend, and
 * the links the activity receives (the wallet's callback, workspace invitations).
 */
class IssuesAppViewModel(
    app: Application,
) : AndroidViewModel(app) {
    val session: MeroAppSession =
        MeroAppSession.create(
            app,
            packageName = Tracker.PACKAGE_NAME,
            callbackUrl = BuildConfig.ENROL_CALLBACK_URL,
            config =
                MeroAppConfig(
                    registryUrl = BuildConfig.REGISTRY_URL.ifBlank { null },
                    cloudBaseUrl = BuildConfig.CLOUD_BASE_URL.ifBlank { CloudClient.DEFAULT_BASE_URL },
                ),
            walletUrl = BuildConfig.WALLET_URL.ifBlank { Enrolment.DEFAULT_WALLET_URL },
            scope = viewModelScope,
        )

    val store: TrackerStore = PrefsTrackerStore(app)

    private val _justJoined = MutableStateFlow<String?>(null)

    /** A workspace joined from an invitation whose repos may not have arrived yet. */
    val justJoined: StateFlow<String?> = _justJoined.asStateFlow()

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
    suspend fun join(invitation: TrackerInvitation) {
        val backend = session.backend.value ?: return
        WorkspaceModel(backend, session.applicationId, store).join(invitation)
        _justJoined.value = invitation.namespaceId
        session.didJoinNamespace()
        session.dismissPendingInvitation()
    }
}
