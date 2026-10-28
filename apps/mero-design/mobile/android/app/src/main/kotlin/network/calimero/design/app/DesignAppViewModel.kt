package network.calimero.design.app

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
import network.calimero.design.BuildConfig
import network.calimero.design.core.BlobLoading
import network.calimero.design.core.DesignFormat
import java.io.IOException

/** A board a link asked to open. */
data class BoardLink(
    val teamId: String,
    val contextId: String,
)

/**
 * The app's session, kept across configuration changes: Calimero Cloud sign-in, the account's
 * relay, and links. Screens build their models from [MeroAppSession.backend].
 */
class DesignAppViewModel(
    app: Application,
) : AndroidViewModel(app) {
    val session: MeroAppSession =
        MeroAppSession.create(
            app,
            packageName = DesignFormat.PACKAGE_NAME,
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

    /** A board link waiting for the signed-in screens to open it. */
    private val _openBoard = MutableStateFlow<BoardLink?>(null)
    val openBoard: StateFlow<BoardLink?> = _openBoard.asStateFlow()

    /** Image bytes through the signed-in client's admin surface. */
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
        DesignFormat.parseBoardLink(url)?.let { (team, board) ->
            _openBoard.value = BoardLink(team, board)
            return
        }
        viewModelScope.launch { session.handle(url) }
    }

    fun boardOpened() {
        _openBoard.value = null
    }

    fun signOut() {
        viewModelScope.launch { session.signOut() }
    }
}
