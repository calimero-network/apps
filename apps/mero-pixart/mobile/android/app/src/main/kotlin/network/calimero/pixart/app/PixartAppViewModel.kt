package network.calimero.pixart.app

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
import network.calimero.pixart.BuildConfig
import network.calimero.pixart.core.BlobLoading
import network.calimero.pixart.core.BlobStore
import network.calimero.pixart.core.InvitationModel
import network.calimero.pixart.core.PixartFormat
import java.io.IOException

/** Where a link or a joined invitation asks to go. */
sealed interface Destination {
    data class Project(
        val teamId: String,
        val contextId: String,
    ) : Destination

    data class Team(
        val teamId: String,
        val name: String,
    ) : Destination
}

/**
 * The app's session, kept across configuration changes: Calimero Cloud sign-in, the account's relay,
 * links and invitations. Screens build their models from [MeroAppSession.backend].
 */
class PixartAppViewModel(
    app: Application,
) : AndroidViewModel(app) {
    val session: MeroAppSession =
        MeroAppSession.create(
            app,
            packageName = PixartFormat.PACKAGE_NAME,
            callbackUrl = BuildConfig.ENROL_CALLBACK_URL,
            config =
                MeroAppConfig(
                    registryUrl = BuildConfig.REGISTRY_URL.ifBlank { null },
                    cloudBaseUrl = BuildConfig.CLOUD_BASE_URL.ifBlank { CloudClient.DEFAULT_BASE_URL },
                ),
            walletUrl = BuildConfig.WALLET_URL.ifBlank { Enrolment.DEFAULT_WALLET_URL },
            scope = viewModelScope,
        )

    private val _restored = MutableStateFlow(false)
    val restored: StateFlow<Boolean> = _restored.asStateFlow()

    /** A place a link asked to open, waiting for the signed-in screens. */
    private val _destination = MutableStateFlow<Destination?>(null)
    val destination: StateFlow<Destination?> = _destination.asStateFlow()

    /** An invitation link being confirmed and redeemed. */
    val invitation = InvitationModel()

    /** Decoded blobs through the signed-in client's admin surface, shared by every screen. */
    val blobs =
        BlobStore(
            BlobLoading { id, contextId ->
                val admin = session.client.admin ?: throw IOException("Not signed in")
                admin.getBlob(id, contextId)
            },
            Compositor,
        )

    init {
        viewModelScope.launch {
            session.restore()
            _restored.value = true
        }
        viewModelScope.launch {
            session.pendingInvitation.collect { raw ->
                if (raw != null) {
                    invitation.open(raw)
                    session.dismissPendingInvitation()
                }
            }
        }
        viewModelScope.launch {
            invitation.stage.collect { stage ->
                if (stage is InvitationModel.Stage.Joined) {
                    _destination.value = Destination.Team(stage.teamId, stage.name)
                    invitation.reset()
                }
            }
        }
    }

    fun handleLink(url: String) {
        PixartFormat.parseProjectLink(url)?.let { (team, project) ->
            _destination.value = Destination.Project(team, project)
            return
        }
        viewModelScope.launch { session.handle(url) }
    }

    fun acceptInvitation() {
        viewModelScope.launch {
            invitation.accept(backend = { session.backend.value }, didJoin = { session.didJoinNamespace() })
        }
    }

    fun destinationOpened() {
        _destination.value = null
    }

    fun signOut() {
        viewModelScope.launch { session.signOut() }
    }
}
