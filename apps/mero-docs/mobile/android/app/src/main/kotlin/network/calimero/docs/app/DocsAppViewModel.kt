package network.calimero.docs.app

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.calimero.mero.account.Enrolment
import com.calimero.mero.app.MeroAppBackend
import com.calimero.mero.cloud.CloudClient
import com.calimero.mero.compose.MeroAppConfig
import com.calimero.mero.compose.MeroAppSession
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import network.calimero.docs.BuildConfig
import network.calimero.docs.core.BlobLoading
import network.calimero.docs.core.DocTarget
import network.calimero.docs.core.DocsFormat
import java.io.IOException

/**
 * The app's session, kept across configuration changes: Calimero Cloud sign-in, the account's
 * relay, and links. Screens build their models from [MeroAppSession.backend].
 */
class DocsAppViewModel(
    app: Application,
) : AndroidViewModel(app) {
    val session: MeroAppSession =
        MeroAppSession.create(
            app,
            packageName = DocsFormat.PACKAGE_NAME,
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

    /** A document link waiting for the signed-in screens to open it. */
    private val _openDoc = MutableStateFlow<DocTarget?>(null)
    val openDoc: StateFlow<DocTarget?> = _openDoc.asStateFlow()

    /** Image bytes through the signed-in client's admin surface. */
    val blobs =
        BlobLoading { id, contextId ->
            val admin = session.client.admin ?: throw IOException("Not signed in")
            admin.getBlob(id, contextId)
        }

    /** What this phone opened last, per workspace. */
    val recents: RecentStore = PrefsRecentStore(app.getSharedPreferences("mero-docs", Context.MODE_PRIVATE))

    /** One [WorkspaceModel] per workspace for the session, shared by its screens. */
    private val workspaces = mutableMapOf<String, WorkspaceModel>()
    private var workspacesBackend: MeroAppBackend? = null

    fun workspaceModel(
        backend: MeroAppBackend,
        workspace: Workspace,
    ): WorkspaceModel {
        if (workspacesBackend !== backend) {
            workspaces.clear()
            workspacesBackend = backend
        }
        return workspaces.getOrPut(workspace.id) { WorkspaceModel(backend, workspace, recents) }
    }

    init {
        viewModelScope.launch {
            session.restore()
            _restored.value = true
        }
    }

    fun handleLink(url: String) {
        DocsFormat.parseDocLink(url)?.let {
            _openDoc.value = it
            return
        }
        viewModelScope.launch { session.handle(url) }
    }

    fun docOpened() {
        _openDoc.value = null
    }

    fun signOut() {
        viewModelScope.launch { session.signOut() }
    }
}
