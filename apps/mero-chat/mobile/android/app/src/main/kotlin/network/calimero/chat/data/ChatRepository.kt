package network.calimero.chat.data

import com.calimero.mero.app.AppContextEntry
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.SerializationException
import network.calimero.chat.generated.client.ChatClient

/** An org running chat. */
data class Workspace(
    val id: String,
    val name: String,
    val memberCount: Int = 0,
)

/** An app instance of chat: a channel, or a DM (same contract, `contextType: Dm`). */
data class Channel(
    val contextId: String,
    /** The group it lives in: the org itself (an open channel or a DM), or a team (a private channel). */
    val groupId: String,
    val workspaceId: String,
    val name: String,
    val isDm: Boolean = false,
    /** Whether the account reaches it, i.e. can read and write. */
    val joined: Boolean = true,
    val unread: Int = 0,
)

/** One workspace's conversations. */
data class ChannelListing(
    val channels: List<Channel>,
    val dms: List<Channel>,
)

/**
 * The chat app's operations, in terms of the contract and the delegated session. Holds no state of
 * its own; the view models do. Contract calls go through the generated [ChatClient] of each app
 * instance, and its typed answers become the app's models in ChatWire.kt.
 */
@Suppress("TooManyFunctions")
class ChatRepository(
    private val backend: ChatBackend,
    /** Seconds since the epoch: what the contract's timestamps are in. */
    private val nowSecs: () -> Long = { System.currentTimeMillis() / MILLIS_PER_SECOND },
) {
    /** The signed-in account as the contract names it (the account id), or null. */
    val myUserId: String? get() = ChatIdentity.userIdOf(backend.accountId)

    // ---- workspaces ----------------------------------------------------------------------

    suspend fun workspaces(): List<Workspace> =
        backend
            .listWorkspaces()
            .map { ns -> Workspace(ns.id, ns.name?.ifEmpty { null } ?: "Workspace ${ns.id.take(SHORT_ID)}", ns.memberCount) }
            .sortedBy { it.name.lowercase() }

    /**
     * Found a workspace and open `#general` in it, as the web app does, so whoever joins lands
     * somewhere. A failed `#general` does not undo the workspace; it comes back as the warning.
     */
    suspend fun createWorkspace(
        name: String,
        username: String,
    ): FoundWorkspace {
        val founded = backend.foundWorkspace(name.trim())
        val general =
            try {
                createChannel(founded.namespaceId, GENERAL_CHANNEL, public = true, username = username)
                null
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                "#$GENERAL_CHANNEL could not be created: ${describeChatError(e)}"
            }
        return founded.copy(warning = listOfNotNull(founded.warning, general).joinToString(" ").ifEmpty { null })
    }

    /** A shareable invitation link to [workspace]: an org invite token (a passkey step-up). */
    suspend fun invitationLink(workspace: Workspace): String = ChatInvites.link(backend.createInvitation(workspace.id), workspace.name)

    suspend fun joinWorkspace(invitation: ChatInvitation): JoinedWorkspace = backend.joinWorkspace(invitation.namespaceId, invitation.invitation)

    // ---- channels ------------------------------------------------------------------------

    /**
     * The workspace's conversations: the org's own app instances (open channels and DMs, as the
     * web app makes them) and those of each of its teams (private channels), named by the
     * contract's `getInfo` where the account can read it. DMs are told apart by `contextType` or
     * by their `DM_CONTEXT_` name.
     */
    suspend fun channels(workspaceId: String): ChannelListing =
        coroutineScope {
            val subgroups = backend.listSubgroups(workspaceId)
            val rootEntries = async { optional { backend.listGroupContexts(workspaceId) }.orEmpty().map { Triple(workspaceId, null as String?, it) } }
            val subgroupEntries =
                subgroups.map { sg ->
                    async { backend.listGroupContexts(sg.groupId).map { Triple(sg.groupId, sg.name, it) } }
                }
            val entries = (rootEntries.await() + subgroupEntries.awaitAll().flatten()).distinctBy { it.third.id }
            val described = entries.map { (groupId, groupName, entry) -> async { describe(workspaceId, groupId, groupName, entry) } }.awaitAll()
            ChannelListing(
                channels = described.filterNot { it.isDm }.sortedBy { it.name.lowercase() },
                dms = described.filter { it.isDm }.sortedBy { it.name.lowercase() },
            )
        }

    private suspend fun describe(
        workspaceId: String,
        groupId: String,
        groupName: String?,
        entry: AppContextEntry,
    ): Channel {
        val contextId = entry.id
        val alias = groupName ?: entry.name.orEmpty()
        val joined = optional { backend.isMember(contextId) } ?: false
        val info = if (joined) optional { info(contextId) } else null
        val isDm = alias.startsWith(DM_ALIAS_PREFIX) || info?.isDm == true
        val name =
            if (isDm) {
                optional { dmName(contextId) } ?: info?.name?.ifEmpty { null } ?: "Direct message"
            } else {
                info?.name?.ifEmpty { null } ?: entry.name?.ifEmpty { null } ?: groupName?.ifEmpty { null } ?: "channel"
            }
        val unread = if (joined) optional { unreadCount(contextId) } ?: 0 else 0
        return Channel(contextId, groupId, workspaceId, name, isDm = isDm, joined = joined, unread = unread)
    }

    /** A DM is named for the other people in it. */
    private suspend fun dmName(contextId: String): String? {
        val me = myUserId
        return profiles(contextId)
            .filter { it.identity != me && it.username.isNotBlank() }
            .joinToString(", ") { it.username }
            .ifEmpty { null }
    }

    /**
     * Create a channel the web app's way (`api/platform.ts`): an open channel is one app instance
     * of chat in the org itself; a private one gets its own team that admits by invitation, with
     * the instance inside it. Then the creator's name in it.
     */
    suspend fun createChannel(
        workspaceId: String,
        name: String,
        public: Boolean,
        username: String,
    ): Channel {
        val clean = name.trim().removePrefix("#")
        val groupId = if (public) workspaceId else backend.createSubgroup(workspaceId, clean, public = false)
        val contextId = backend.createContext(groupId, clean, ChatArgs.channelInit(clean, username.trim()))
        if (username.isNotBlank()) optional { setProfile(contextId, username) }
        return Channel(contextId, groupId, workspaceId, clean)
    }

    /** Join an open channel the account does not reach yet, and register its name there. */
    suspend fun joinChannel(
        channel: Channel,
        username: String,
    ): Channel {
        backend.joinChannel(channel.contextId)
        if (username.isNotBlank()) optional { setProfile(channel.contextId, username) }
        return channel.copy(joined = true)
    }

    // ---- contract reads ------------------------------------------------------------------

    suspend fun info(contextId: String): ChatContextInfo = read("getInfo") { chat(contextId).getInfo().toChatContextInfo() }

    /** The newest page: `getMessages` at offset 0. */
    suspend fun newestMessages(
        contextId: String,
        limit: Int = ChatArgs.PAGE_SIZE,
    ): ChatMessagePage = read("getMessages") { chat(contextId).getMessages(limit = limit.toUInt(), offset = 0u).toChatMessagePage() }

    /** Messages by absolute position: `getMessagesFrom(start, limit)`. */
    suspend fun messagesFrom(
        contextId: String,
        start: Long,
        limit: Int,
    ): ChatMessagePage =
        read("getMessagesFrom") {
            chat(contextId).getMessagesFrom(start.coerceAtLeast(0).toULong(), limit.toUInt()).toChatMessagePage()
        }

    suspend fun profiles(contextId: String): List<ChatProfile> = read("getProfiles") { chat(contextId).getProfiles().map { it.toChatProfile() } }

    suspend fun unreadCount(contextId: String): Int = read("getUnreadCount") { chat(contextId).getUnreadCount().toInt() }

    // ---- contract writes -----------------------------------------------------------------

    /** Send [text]; the message as the contract stored it, or null when its answer cannot be read. */
    suspend fun send(
        contextId: String,
        text: String,
    ): ChatMessage? {
        ChatValidation.messageError(text)?.let { throw IllegalArgumentException(it) }
        val client = chat(contextId)
        return try {
            val sent = client.sendMessage(message = text, mentions = emptyList(), mentionsUsernames = emptyList(), timestamp = nowSecs().toTimestamp())
            sent.toChatMessage()
        } catch (_: SerializationException) {
            null
        }
    }

    suspend fun edit(
        contextId: String,
        messageId: String,
        text: String,
    ) {
        ChatValidation.messageError(text)?.let { throw IllegalArgumentException(it) }
        written { chat(contextId).editMessage(messageId, text, nowSecs().toTimestamp()) }
    }

    suspend fun delete(
        contextId: String,
        messageId: String,
    ) {
        written { chat(contextId).deleteMessage(messageId) }
    }

    suspend fun react(
        contextId: String,
        messageId: String,
        emoji: String,
        add: Boolean,
    ) {
        ChatValidation.emojiError(emoji)?.let { throw IllegalArgumentException(it) }
        written { chat(contextId).updateReaction(messageId, emoji, add) }
    }

    /**
     * Register [username] in [contextId]. The contract keeps the FIRST name a member registers in a
     * context (later calls change only the avatar), so this names a newcomer, not a rename.
     */
    suspend fun setProfile(
        contextId: String,
        username: String,
    ) {
        ChatValidation.usernameError(username)?.let { throw IllegalArgumentException(it) }
        written { chat(contextId).setProfile(username.trim(), avatar = null) }
    }

    /**
     * Register [username] in [contextId] unless the account already has a name there. A member of
     * an open channel can read and write it without ever joining it explicitly (namespace members
     * inherit open subgroups), and then nothing else names them — the web app's auto-join sweep
     * does this for the same reason. Returns whether it registered one.
     */
    suspend fun ensureProfile(
        contextId: String,
        username: String,
    ): Boolean {
        if (ChatValidation.usernameError(username) != null) return false
        val me = myUserId ?: return false
        if (profiles(contextId).any { it.identity == me }) return false
        setProfile(contextId, username)
        return true
    }

    /** Record that the account has read [contextId] up to now (`markAsRead`, cross-device). */
    suspend fun markRead(contextId: String) {
        written { chat(contextId).markAsRead(nowSecs().toTimestamp()) }
    }

    fun changes(contextId: String): Flow<Unit>? = backend.changes(contextId)

    // ---- helpers ---------------------------------------------------------------------------

    private fun chat(contextId: String): ChatClient = backend.chat(contextId)

    /** A view's answer as the app's model; one this app cannot read is an [IllegalStateException] naming [method]. */
    private suspend fun <T> read(
        method: String,
        block: suspend () -> T,
    ): T =
        try {
            block()
        } catch (e: SerializationException) {
            throw IllegalStateException("$method answered something this app cannot read: ${e.message}", e)
        }

    /** A call whose answer (the contract's acknowledgement, or the changed message) the app does not read. */
    private suspend fun written(block: suspend () -> Any?) {
        try {
            block()
        } catch (_: SerializationException) {
            // The call went through; only its answer is not one this app reads.
        }
    }

    /** Seconds since the epoch as the contract's `u64` (a clock before 1970 reads as 0). */
    private fun Long.toTimestamp(): ULong = coerceAtLeast(0).toULong()

    private suspend fun <T> optional(block: suspend () -> T): T? =
        try {
            block()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            null
        }

    companion object {
        /** The channel every workspace starts with (app/src/utils/createChannel.ts `GENERAL_CHANNEL`). */
        const val GENERAL_CHANNEL = "general"

        /** A DM's subgroup alias prefix (app/src/utils/dmContext.ts `DM_CONTEXT_ALIAS_PREFIX`). */
        const val DM_ALIAS_PREFIX = "DM_CONTEXT_"

        private const val MILLIS_PER_SECOND = 1000L
        private const val SHORT_ID = 8
    }
}
