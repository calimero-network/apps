package network.calimero.models.app

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
import network.calimero.models.BuildConfig
import network.calimero.models.core.BlobLoading
import network.calimero.models.core.InvitationModel
import network.calimero.models.core.ModelsFormat
import java.io.IOException

/** A scene to open once the signed-in screens are up. */
data class SceneLink(
    val studioId: String,
    val contextId: String,
)

/**
 * The app's session, kept across configuration changes: Calimero Cloud sign-in, the account's
 * relay, invitations and links. Screens build their models from [MeroAppSession.backend].
 */
class ModelsAppViewModel(
    app: Application,
) : AndroidViewModel(app) {
    val session: MeroAppSession =
        MeroAppSession.create(
            app,
            packageName = ModelsFormat.PACKAGE_NAME,
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

    /** An invitation being confirmed or redeemed. */
    val invitation = InvitationModel()

    /** A scene a redeemed invitation asked to open. */
    private val _openScene = MutableStateFlow<SceneLink?>(null)
    val openScene: StateFlow<SceneLink?> = _openScene.asStateFlow()

    /** Blob bytes through the signed-in client's admin surface. */
    val blobs =
        BlobLoading { id, contextId ->
            val admin = session.client.admin ?: throw IOException("Not signed in")
            admin.getBlob(id, contextId)
        }

    init {
        viewModelScope.launch {
            session.restore()
            _restored.value = true
        }
    }

    fun handleLink(url: String) {
        viewModelScope.launch { session.handle(url) }
    }

    /** Read a pasted link, or one the session caught. */
    fun openInvitation(raw: String) {
        invitation.open(raw)
    }

    fun acceptInvitation() {
        viewModelScope.launch {
            invitation.accept(backend = { session.backend.value }, didJoin = { session.didJoinNamespace() })
        }
    }

    fun open(link: SceneLink) {
        _openScene.value = link
    }

    fun sceneOpened() {
        _openScene.value = null
    }

    fun signOut() {
        viewModelScope.launch { session.signOut() }
    }
}
