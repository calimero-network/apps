package network.calimero.chat.app

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.calimero.mero.account.ApplicationIds
import com.calimero.mero.account.Enrolment
import com.calimero.mero.cloud.CloudClient
import com.calimero.mero.compose.MeroAppConfig
import com.calimero.mero.compose.MeroClient
import com.calimero.mero.compose.SharedPreferencesStore
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import network.calimero.chat.BuildConfig
import network.calimero.chat.data.Channel
import network.calimero.chat.data.ChatInvites
import network.calimero.chat.data.ChatRepository
import network.calimero.chat.data.MeroChatBackend
import network.calimero.chat.data.Workspace

/**
 * Owns the app's one [MeroClient] (keys, session and nonces in the SDK's Keystore-backed stores)
 * and the view models built on it, for the activity's lifetime.
 */
class ChatAppViewModel(
    app: Application,
) : AndroidViewModel(app) {
    private val cloudBaseUrl = BuildConfig.CLOUD_BASE_URL.ifEmpty { CloudClient.DEFAULT_BASE_URL }
    private val registryUrl = BuildConfig.REGISTRY_URL.ifEmpty { ApplicationIds.DEFAULT_REGISTRY_URL }

    val client: MeroClient =
        MeroClient.create(
            app,
            cloudBaseUrl = cloudBaseUrl,
            walletUrl = BuildConfig.WALLET_URL.ifEmpty { Enrolment.DEFAULT_WALLET_URL },
            config = MeroAppConfig(packageName = ChatInvites.APP_SLUG, registryUrl = registryUrl, cloudBaseUrl = cloudBaseUrl),
        )

    val profile = ProfileStore(SharedPreferencesStore(app, PREFS))
    val repository = ChatRepository(MeroChatBackend(client, ChatInvites.APP_SLUG, registryUrl))
    val workspaces = WorkspacesModel(repository, viewModelScope, profile)

    val session: StateFlow<SessionStage> =
        client.state.map(::sessionStage).stateIn(viewModelScope, SharingStarted.Eagerly, sessionStage(client.state.value))

    private val channelLists = mutableMapOf<String, ChannelsModel>()
    private val openChannels = mutableMapOf<String, ChannelModel>()

    /** A wallet redirect that arrived before [restore] finished (cold start from the wallet). */
    private var pendingCallback: String? = null
    private var restored = false

    init {
        viewModelScope.launch {
            runCatching { client.restore() }
            restored = true
            pendingCallback?.let { url ->
                pendingCallback = null
                client.handleDeepLink(url)
            }
        }
    }

    /** Open the Calimero wallet to approve this device (it redirects to [BuildConfig.ENROL_CALLBACK_URL]). */
    fun signIn(context: Context) = client.signInWithCloud(context, BuildConfig.ENROL_CALLBACK_URL)

    /** The person came back without answering: stop the spinner. */
    fun cancelSignIn() = client.cancelPendingSignIn()

    /**
     * Any link the activity received: a wallet redirect, or a workspace invitation (held for the
     * person to confirm in the workspaces list).
     */
    fun handleLink(url: String) {
        if (url.startsWith(BuildConfig.ENROL_CALLBACK_URL) || client.account.isEnrolmentCallback(url)) {
            if (restored) viewModelScope.launch { client.handleDeepLink(url) } else pendingCallback = url
            return
        }
        workspaces.offerInvite(url)
    }

    fun signOut() =
        viewModelScope.launch {
            openChannels.values.forEach { it.stop() }
            openChannels.clear()
            channelLists.clear()
            workspaces.reset()
            client.signOut()
        }

    fun channels(workspace: Workspace): ChannelsModel = channelLists.getOrPut(workspace.id) { ChannelsModel(repository, viewModelScope, profile, workspace) }

    fun channelsOf(workspaceId: String): ChannelsModel? = channelLists[workspaceId]

    fun channel(channel: Channel): ChannelModel =
        openChannels.getOrPut(channel.contextId) {
            ChannelModel(repository, viewModelScope, channel, onRead = { id -> channelLists[channel.workspaceId]?.markSeen(id) })
        }

    fun channelOf(contextId: String): ChannelModel? = openChannels[contextId]

    override fun onCleared() {
        openChannels.values.forEach { it.stop() }
        super.onCleared()
    }

    private companion object {
        const val PREFS = "mero_chat"
    }
}
