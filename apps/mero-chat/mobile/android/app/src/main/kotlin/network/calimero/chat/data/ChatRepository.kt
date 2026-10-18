package network.calimero.chat.data

import com.calimero.mero.admin.GroupContextEntry
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.longOrNull

/** A namespace running chat. */
data class Workspace(
    val id: String,
    val name: String,
    val memberCount: Int = 0,
)

/** A context running chat: a channel, or a DM (same contract, `context_type: Dm`). */
data class Channel(
    val contextId: String,
    /** The group it lives in: its own subgroup in the web app's 1-group-per-channel model. */
    val groupId: String,
    val workspaceId: String,
    val name: String,
    val isDm: Boolean = false,
    /** Whether the account is a direct member, i.e. can read and write. */
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
 * its own; the view models do. Every argument object comes from [ChatArgs], every result is decoded
 * with the models in ChatWire.kt.
 */
@Suppress("TooManyFunctions")
class ChatRepository(
    private val backend: ChatBackend,
    /** Seconds since the epoch: what the contract's timestamps are in. */
    private val nowSecs: () -> Long = { System.currentTimeMillis() / MILLIS_PER_SECOND },
) {
    /** The signed-in account as the contract names it (base58), or null. */
    val myUserId: String? get() = ChatIdentity.userIdOf(backend.accountId)

    // ---- workspaces ----------------------------------------------------------------------

    suspend fun workspaces(): List<Workspace> =
        backend
            .listWorkspaces()
            .map { ns -> Workspace(ns.namespaceId, ns.name?.ifEmpty { null } ?: "Workspace ${ns.namespaceId.take(SHORT_ID)}", ns.memberCount) }
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

    /** A shareable invitation link to [workspace], in the web app's format. */
    suspend fun invitationLink(workspace: Workspace): String = ChatInvites.link(backend.createInvitation(workspace.id), workspace.name)

    suspend fun joinWorkspace(invitation: ChatInvitation): JoinedWorkspace = backend.joinWorkspace(invitation.namespaceId, invitation.invitation)

    // ---- channels ------------------------------------------------------------------------

    /**
     * The workspace's conversations, found the way the web app finds them: every subgroup under
     * the namespace and the contexts in each (plus any context on the namespace root itself),
     * named by the contract's `get_info` where the account can read it. DMs are told apart by
     * `context_type` or by their subgroup's `DM_CONTEXT_` alias.
     */
    suspend fun channels(workspaceId: String): ChannelListing =
        coroutineScope {
            val subgroups = backend.listSubgroups(workspaceId)
            val rootEntries = async { optional { backend.listGroupContexts(workspaceId) }.orEmpty().map { Triple(workspaceId, null as String?, it) } }
            val subgroupEntries =
                subgroups.map { sg ->
                    async { backend.listGroupContexts(sg.groupId).map { Triple(sg.groupId, sg.name, it) } }
                }
            val entries = (rootEntries.await() + subgroupEntries.awaitAll().flatten()).distinctBy { it.third.contextId }
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
        entry: GroupContextEntry,
    ): Channel {
        val contextId = entry.contextId
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
     * Create a channel the web app's way (app/src/utils/createChannel.ts): its own subgroup under
     * the namespace, then chat's context inside it, initialised with the creator's name.
     */
    suspend fun createChannel(
        workspaceId: String,
        name: String,
        public: Boolean,
        username: String,
    ): Channel {
        val clean = name.trim().removePrefix("#")
        val groupId = backend.createSubgroup(workspaceId, clean, public)
        val contextId = backend.createContext(groupId, clean, ChatArgs.channelInit(clean, nowSecs(), username.trim()))
        if (username.isNotBlank()) optional { setProfile(contextId, username) }
        return Channel(contextId, groupId, workspaceId, clean)
    }

    /** Join an open channel the account is not a direct member of yet, and register its name there. */
    suspend fun joinChannel(
        channel: Channel,
        username: String,
    ): Channel {
        backend.joinChannel(channel.contextId)
        if (username.isNotBlank()) optional { setProfile(channel.contextId, username) }
        return channel.copy(joined = true)
    }

    // ---- contract reads ------------------------------------------------------------------

    suspend fun info(contextId: String): ChatContextInfo = view(contextId, ChatMethods.GET_INFO, ChatArgs.none(), ChatContextInfo.serializer())

    /** The newest page: `get_messages` at offset 0. */
    suspend fun newestMessages(
        contextId: String,
        limit: Int = ChatArgs.PAGE_SIZE,
    ): ChatMessagePage = view(contextId, ChatMethods.GET_MESSAGES, ChatArgs.getMessages(limit = limit, offset = 0), ChatMessagePage.serializer())

    /** Messages by absolute position: `get_messages_from(start, limit)`. */
    suspend fun messagesFrom(
        contextId: String,
        start: Long,
        limit: Int,
    ): ChatMessagePage = view(contextId, ChatMethods.GET_MESSAGES_FROM, ChatArgs.getMessagesFrom(start, limit), ChatMessagePage.serializer())

    suspend fun profiles(contextId: String): List<ChatProfile> =
        view(contextId, ChatMethods.GET_PROFILES, ChatArgs.none(), ListSerializer(ChatProfile.serializer()))

    suspend fun unreadCount(contextId: String): Int {
        val out = backend.view(contextId, ChatMethods.GET_UNREAD_COUNT, ChatArgs.none())
        return ((out as? JsonPrimitive)?.longOrNull ?: 0L).toInt()
    }

    // ---- contract writes -----------------------------------------------------------------

    suspend fun send(
        contextId: String,
        text: String,
    ): ChatMessage? {
        ChatValidation.messageError(text)?.let { throw IllegalArgumentException(it) }
        return decodeOrNull(backend.write(contextId, ChatMethods.SEND_MESSAGE, ChatArgs.sendMessage(text, nowSecs())), ChatMessage.serializer())
    }

    suspend fun edit(
        contextId: String,
        messageId: String,
        text: String,
    ) {
        ChatValidation.messageError(text)?.let { throw IllegalArgumentException(it) }
        backend.write(contextId, ChatMethods.EDIT_MESSAGE, ChatArgs.editMessage(messageId, text, nowSecs()))
    }

    suspend fun delete(
        contextId: String,
        messageId: String,
    ) {
        backend.write(contextId, ChatMethods.DELETE_MESSAGE, ChatArgs.deleteMessage(messageId))
    }

    suspend fun react(
        contextId: String,
        messageId: String,
        emoji: String,
        add: Boolean,
    ) {
        ChatValidation.emojiError(emoji)?.let { throw IllegalArgumentException(it) }
        backend.write(contextId, ChatMethods.UPDATE_REACTION, ChatArgs.updateReaction(messageId, emoji, add))
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
        backend.write(contextId, ChatMethods.SET_PROFILE, ChatArgs.setProfile(username.trim()))
    }

    /** Record that the account has read [contextId] up to now (`mark_as_read`, cross-device). */
    suspend fun markRead(contextId: String) {
        backend.write(contextId, ChatMethods.MARK_AS_READ, ChatArgs.markAsRead(nowSecs()))
    }

    fun changes(contextId: String): Flow<Unit>? = backend.changes(contextId)

    // ---- helpers ---------------------------------------------------------------------------

    private suspend fun <T> view(
        contextId: String,
        method: String,
        args: JsonObject,
        serializer: KSerializer<T>,
    ): T {
        val out = backend.view(contextId, method, args) ?: JsonNull
        return try {
            chatJson.decodeFromJsonElement(serializer, out)
        } catch (e: IllegalArgumentException) {
            throw IllegalStateException("$method answered something this app cannot read: ${e.message}", e)
        }
    }

    private fun <T> decodeOrNull(
        out: JsonElement?,
        serializer: KSerializer<T>,
    ): T? = out?.takeUnless { it is JsonNull }?.let { runCatching { chatJson.decodeFromJsonElement(serializer, it) }.getOrNull() }

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
