package network.calimero.chat.app

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.conflate
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import network.calimero.chat.data.Channel
import network.calimero.chat.data.ChatArgs
import network.calimero.chat.data.ChatIdentity
import network.calimero.chat.data.ChatMessage
import network.calimero.chat.data.ChatRepository
import network.calimero.chat.data.ChatValidation
import network.calimero.chat.data.MessageWindow
import network.calimero.chat.data.describeChatError
import kotlin.coroutines.coroutineContext

/** How the open channel learns about changes. */
enum class LiveMode {
    /** Not following yet. */
    OFF,

    /** The relay's event stream (SSE over the relay session). */
    STREAM,

    /** No stream on this session (relay not attested yet): re-read the newest page periodically. */
    POLLING,
}

/** A reaction on a message, as a chip shows it. */
data class ReactionChip(
    val emoji: String,
    val count: Int,
    val mine: Boolean,
)

/** A message ready to show. */
data class MessageItem(
    val message: ChatMessage,
    val author: String,
    val mine: Boolean,
    val reactions: List<ReactionChip>,
) {
    val id: String get() = message.id
}

data class ChannelState(
    val title: String,
    val loading: Boolean = true,
    val messages: List<MessageItem> = emptyList(),
    val hasOlder: Boolean = false,
    val loadingOlder: Boolean = false,
    /** Texts sent and not yet read back from the channel. */
    val pending: List<String> = emptyList(),
    val error: String? = null,
    val notice: String? = null,
    val live: LiveMode = LiveMode.OFF,
)

/**
 * One open channel: paged history, sending, editing, deleting, reactions, the profile name, and
 * live updates. Every read and write goes through [ChatRepository], so through the relay.
 */
@Suppress("TooManyFunctions")
class ChannelModel(
    private val repo: ChatRepository,
    private val scope: CoroutineScope,
    val channel: Channel,
    private val pollIntervalMs: Long = DEFAULT_POLL_MS,
    private val onRead: (String) -> Unit = {},
) {
    private val _state = MutableStateFlow(ChannelState(title = channel.name))
    val state: StateFlow<ChannelState> = _state.asStateFlow()

    private val lock = Mutex()
    private var window = MessageWindow()
    private var names: Map<String, String> = emptyMap()
    private var follower: Job? = null
    private val contextId: String get() = channel.contextId

    /** Load the newest page, mark the channel read and start following it. Idempotent. */
    fun start(): Job =
        scope.launch {
            if (follower != null) return@launch
            loadNewest()
            follower = scope.launch { follow() }
        }

    /** Stop following (the screen went away). */
    fun stop() {
        follower?.cancel()
        follower = null
        _state.update { it.copy(live = LiveMode.OFF) }
    }

    /** Re-read the newest page (pull to refresh, or a live signal). */
    fun refresh(): Job = scope.launch { refreshNow() }

    /** Read the page before the oldest message held. */
    fun loadOlder(): Job =
        scope.launch {
            val request = lock.withLock { window.olderRequest() } ?: return@launch
            if (_state.value.loadingOlder) return@launch
            _state.update { it.copy(loadingOlder = true) }
            try {
                val page = repo.messagesFrom(contextId, request.start, request.limit)
                lock.withLock { window = window.merge(page.messages, page.totalCount) }
                ensureNames(page.messages)
                publish()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(error = describeChatError(e)) }
            } finally {
                _state.update { it.copy(loadingOlder = false) }
            }
        }

    fun send(text: String): Job =
        scope.launch {
            ChatValidation.messageError(text)?.let { problem ->
                _state.update { it.copy(error = problem) }
                return@launch
            }
            _state.update { it.copy(pending = it.pending + text, error = null) }
            try {
                repo.send(contextId, text)
                refreshNow()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(error = "Not sent: ${describeChatError(e)}") }
            } finally {
                _state.update { s -> s.copy(pending = s.pending - text) }
            }
        }

    fun edit(
        messageId: String,
        text: String,
    ): Job =
        write("Couldn't edit") {
            requireOwn(messageId)
            repo.edit(contextId, messageId, text)
        }

    fun delete(messageId: String): Job =
        write("Couldn't delete") {
            requireOwn(messageId)
            repo.delete(contextId, messageId)
        }

    /** Add [emoji] to a message, or take it back off when it is already this account's. */
    fun toggleReaction(
        messageId: String,
        emoji: String,
    ): Job =
        write("Couldn't react") {
            val mine =
                _state.value.messages
                    .firstOrNull { it.id == messageId }
                    ?.reactions
                    ?.any { it.emoji == emoji && it.mine } == true
            repo.react(contextId, messageId, emoji, add = !mine)
        }

    /** Register the name others see in this channel (kept by the contract after the first one). */
    fun setProfileName(name: String): Job =
        write("Couldn't set your name") {
            repo.setProfile(contextId, name)
            _state.update { it.copy(notice = "Name registered in this channel.") }
            names = emptyMap()
        }

    fun clearMessages() = _state.update { it.copy(error = null, notice = null) }

    // ---- internals -------------------------------------------------------------------------

    private suspend fun loadNewest() {
        _state.update { it.copy(loading = true, error = null) }
        try {
            val page = repo.newestMessages(contextId)
            lock.withLock { window = MessageWindow().merge(page.messages, page.totalCount) }
            ensureNames(page.messages)
            publish()
            markRead()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _state.update { it.copy(error = describeChatError(e)) }
        } finally {
            _state.update { it.copy(loading = false) }
        }
    }

    /**
     * The newest page, folded into what is held; when the channel moved further than one page
     * since the last read, the gap is read too (or, past [MAX_CATCH_UP], the window restarts at
     * the newest page rather than fetching all of it).
     */
    internal suspend fun refreshNow() {
        try {
            val page = repo.newestMessages(contextId)
            val gap = lock.withLock { window.gapBefore(page.messages) }
            val filler =
                when {
                    gap == null -> emptyList()
                    gap.limit > MAX_CATCH_UP -> null
                    else -> repo.messagesFrom(contextId, gap.start, gap.limit).messages
                }
            lock.withLock {
                window =
                    if (filler == null) {
                        MessageWindow().merge(page.messages, page.totalCount)
                    } else {
                        window.merge(filler + page.messages, page.totalCount)
                    }
            }
            ensureNames(page.messages + filler.orEmpty())
            publish()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _state.update { it.copy(error = describeChatError(e)) }
        }
    }

    private suspend fun follow() {
        val changes = repo.changes(contextId)
        if (changes != null) {
            _state.update { it.copy(live = LiveMode.STREAM) }
            try {
                changes.conflate().collect { refreshNow() }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // The stream gave up; fall through to polling.
            }
        }
        _state.update { it.copy(live = LiveMode.POLLING) }
        while (coroutineContext.isActive) {
            delay(pollIntervalMs)
            refreshNow()
        }
    }

    private suspend fun markRead() {
        try {
            repo.markRead(contextId)
            onRead(contextId)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // Best-effort: an unread count that stays up is not worth an error banner.
        }
    }

    private fun write(
        failure: String,
        body: suspend () -> Unit,
    ): Job =
        scope.launch {
            _state.update { it.copy(error = null) }
            try {
                body()
                refreshNow()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(error = "$failure: ${describeChatError(e)}") }
            }
        }

    private fun requireOwn(messageId: String) {
        val item = _state.value.messages.firstOrNull { it.id == messageId }
        require(item != null && item.mine) { "You can only change your own messages." }
    }

    /** Look up names for senders not known yet (`get_profiles`, one call for all of them). */
    private suspend fun ensureNames(messages: List<ChatMessage>) {
        if (messages.none { it.sender !in names }) return
        try {
            names = repo.profiles(contextId).associate { it.identity to it.username }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // Senders show by short id until profiles can be read.
        }
    }

    private suspend fun publish() {
        val me = repo.myUserId
        val held = lock.withLock { window }
        val items =
            held.messages.map { m ->
                MessageItem(
                    message = m,
                    author = names[m.sender]?.ifEmpty { null } ?: ChatIdentity.short(m.sender),
                    mine = me != null && m.sender == me,
                    reactions =
                        m.reactions
                            .orEmpty()
                            .filterValues { it.isNotEmpty() }
                            .map { (emoji, who) -> ReactionChip(emoji, who.size, me != null && me in who) }
                            .sortedBy { it.emoji },
                )
            }
        _state.update { it.copy(messages = items, hasOlder = held.hasOlder) }
    }

    companion object {
        const val DEFAULT_POLL_MS = 5_000L

        /** Past this many missed messages a refresh restarts at the newest page instead of reading them all. */
        const val MAX_CATCH_UP = ChatArgs.PAGE_SIZE * 5

        /** The quick reactions offered on a message. */
        val QUICK_REACTIONS: List<String> = listOf("👍", "❤️", "😂", "🎉", "😮", "🙏")
    }
}
