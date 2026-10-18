package network.calimero.chat.app

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import network.calimero.chat.data.Channel
import network.calimero.chat.data.ChatRepository
import network.calimero.chat.data.ChatValidation
import network.calimero.chat.data.Workspace
import network.calimero.chat.data.describeChatError

data class ChannelsState(
    val loading: Boolean = false,
    val loaded: Boolean = false,
    val channels: List<Channel> = emptyList(),
    val dms: List<Channel> = emptyList(),
    val busy: String? = null,
    val error: String? = null,
    val notice: String? = null,
) {
    fun find(contextId: String): Channel? = channels.firstOrNull { it.contextId == contextId } ?: dms.firstOrNull { it.contextId == contextId }
}

/** One workspace's channel list: load, create a channel, join an open one. */
class ChannelsModel(
    private val repo: ChatRepository,
    private val scope: CoroutineScope,
    private val profile: ProfileStore,
    val workspace: Workspace,
) {
    private val _state = MutableStateFlow(ChannelsState())
    val state: StateFlow<ChannelsState> = _state.asStateFlow()

    fun refresh(): Job =
        scope.launch {
            _state.update { it.copy(loading = true, error = null) }
            try {
                val listing = repo.channels(workspace.id)
                _state.update { it.copy(loading = false, loaded = true, channels = listing.channels, dms = listing.dms) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, loaded = true, error = describeChatError(e)) }
            }
        }

    /** Create a channel; [onCreated] gets it once it exists (to open it). */
    fun create(
        name: String,
        public: Boolean,
        onCreated: (Channel) -> Unit = {},
    ): Job =
        scope.launch {
            val problem = ChatValidation.channelNameError(name)
            if (problem != null) {
                _state.update { it.copy(error = problem) }
                return@launch
            }
            step("Creating #${name.trim().removePrefix("#")}") {
                val created = repo.createChannel(workspace.id, name, public, profile.displayName.value)
                _state.update { it.copy(channels = (it.channels + created).sortedBy { c -> c.name.lowercase() }) }
                onCreated(created)
            }
        }

    /**
     * Open [channel]: a channel the account is only an inherited member of is joined first (as the
     * web app's first sweep does), then [onReady] gets it.
     */
    fun open(
        channel: Channel,
        onReady: (Channel) -> Unit,
    ): Job =
        scope.launch {
            if (channel.joined) {
                onReady(channel)
                return@launch
            }
            step("Joining #${channel.name}") {
                val joined = repo.joinChannel(channel, profile.displayName.value)
                replace(joined)
                onReady(joined)
            }
        }

    /** The channel's unread count is now zero (it was just read). */
    fun markSeen(contextId: String) = _state.update { s -> s.copy(channels = s.channels.map { if (it.contextId == contextId) it.copy(unread = 0) else it }, dms = s.dms.map { if (it.contextId == contextId) it.copy(unread = 0) else it }) }

    fun clearMessages() = _state.update { it.copy(error = null, notice = null) }

    private fun replace(channel: Channel) =
        _state.update { s ->
            s.copy(
                channels = s.channels.map { if (it.contextId == channel.contextId) channel else it },
                dms = s.dms.map { if (it.contextId == channel.contextId) channel else it },
            )
        }

    private suspend fun step(
        what: String,
        body: suspend () -> Unit,
    ) {
        _state.update { it.copy(busy = "$what…", error = null, notice = null) }
        try {
            body()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _state.update { it.copy(error = describeChatError(e)) }
        } finally {
            _state.update { it.copy(busy = null) }
        }
    }
}
