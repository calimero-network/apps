package network.calimero.chat.app

import com.calimero.mero.admin.GroupContextEntry
import com.calimero.mero.admin.Namespace
import com.calimero.mero.admin.SignedGroupOpenInvitation
import com.calimero.mero.admin.SubgroupEntry
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import network.calimero.chat.data.ChatBackend
import network.calimero.chat.data.ChatIdentity
import network.calimero.chat.data.ChatMessage
import network.calimero.chat.data.ChatMessagePage
import network.calimero.chat.data.ChatProfile
import network.calimero.chat.data.FoundWorkspace
import network.calimero.chat.data.JoinedWorkspace
import network.calimero.chat.data.chatJson
import java.util.concurrent.CopyOnWriteArrayList

/**
 * One channel's contract, in memory, behind [ChatBackend] — `get_messages` with the contract's
 * end-counted `page_window`, `get_messages_from` by absolute index — for the view-model logic
 * (paging, catch-up, live/poll switching). The wire path itself is covered against FakeNode.
 */
class InMemoryChat(
    accountHex: String = "ab".repeat(32),
    /** Null: no live stream, so the model polls. */
    var live: MutableSharedFlow<Unit>? = null,
) : ChatBackend {
    override val accountId: String = accountHex
    val me: String = ChatIdentity.userIdOf(accountHex)!!
    val messages = CopyOnWriteArrayList<ChatMessage>()
    val calls = CopyOnWriteArrayList<Pair<String, JsonObject>>()
    var failNext: Exception? = null

    /** What `get_profiles` answers; by default someone else and this account. */
    var profiles: List<ChatProfile>? = null

    fun post(
        text: String,
        sender: String = OTHER,
    ) {
        val index = messages.size.toLong()
        messages += ChatMessage(index = index, id = "id$index", text = text, sender = sender, timestamp = 1_000 + index)
    }

    override suspend fun view(
        contextId: String,
        method: String,
        args: JsonObject,
    ): JsonElement? {
        calls += method to args
        failNext?.let {
            failNext = null
            throw it
        }
        return when (method) {
            "get_messages" -> page(args["limit"]!!.jsonPrimitive.int, args["offset"]!!.jsonPrimitive.int)
            "get_messages_from" -> from(args["start"]!!.jsonPrimitive.long, args["limit"]!!.jsonPrimitive.int)
            "get_profiles" ->
                chatJson.encodeToJsonElement(ListSerializer(ChatProfile.serializer()), profiles ?: listOf(ChatProfile(OTHER, "alice"), ChatProfile(me, "droid")))
            else -> error("unexpected view $method")
        }
    }

    override suspend fun write(
        contextId: String,
        method: String,
        args: JsonObject,
    ): JsonElement? {
        calls += method to args
        when (method) {
            "send_message" -> post(args["message"]!!.jsonPrimitive.content, sender = me)
            "update_reaction" -> react(args["message_id"]!!.jsonPrimitive.content, args["emoji"]!!.jsonPrimitive.content, args["add"]!!.jsonPrimitive.boolean)
            "edit_message" -> replace(args["message_id"]!!.jsonPrimitive.content) { it.copy(text = args["new_message"]!!.jsonPrimitive.content, editedOn = 1) }
            "delete_message" -> replace(args["message_id"]!!.jsonPrimitive.content) { it.copy(text = "", deleted = true, reactions = null) }
            "mark_as_read", "set_profile" -> Unit
            else -> error("unexpected write $method")
        }
        return JsonPrimitive("ok")
    }

    fun methods(): List<String> = calls.map { it.first }

    private fun react(
        id: String,
        emoji: String,
        add: Boolean,
    ) = replace(id) { m ->
        val who =
            m.reactions
                .orEmpty()[emoji]
                .orEmpty()
                .toSet()
                .let { if (add) it + me else it - me }
        m.copy(reactions = m.reactions.orEmpty() + (emoji to who.toList()))
    }

    private fun replace(
        id: String,
        change: (ChatMessage) -> ChatMessage,
    ) {
        val i = messages.indexOfFirst { it.id == id }
        messages[i] = change(messages[i])
    }

    /** lib.rs `page_window`: counted back from the end. */
    private fun page(
        limit: Int,
        offset: Int,
    ): JsonElement {
        val total = messages.size
        val end = (total - offset).coerceAtLeast(0)
        val start = (end - limit).coerceAtLeast(0)
        return encode(ChatMessagePage(total.toLong(), messages.subList(start, end).toList(), offset.toLong()))
    }

    private fun from(
        start: Long,
        limit: Int,
    ): JsonElement {
        val total = messages.size
        val s = start.toInt().coerceAtMost(total)
        val e = (s + limit).coerceAtMost(total)
        return encode(ChatMessagePage(total.toLong(), messages.subList(s, e).toList(), start))
    }

    private fun encode(page: ChatMessagePage) = chatJson.encodeToJsonElement(ChatMessagePage.serializer(), page)

    override fun changes(contextId: String): Flow<Unit>? = live

    // ---- not used by the channel model -------------------------------------------------------

    override suspend fun listWorkspaces(): List<Namespace> = emptyList()

    override suspend fun listSubgroups(namespaceId: String): List<SubgroupEntry> = emptyList()

    override suspend fun listGroupContexts(groupId: String): List<GroupContextEntry> = emptyList()

    override suspend fun isMember(contextId: String): Boolean = true

    override suspend fun joinChannel(contextId: String) = Unit

    override suspend fun createSubgroup(
        namespaceId: String,
        name: String,
        public: Boolean,
    ): String = error("unused")

    override suspend fun createContext(
        groupId: String,
        name: String,
        initArgs: JsonObject,
    ): String = error("unused")

    override suspend fun foundWorkspace(name: String): FoundWorkspace = error("unused")

    override suspend fun createInvitation(namespaceId: String): SignedGroupOpenInvitation = error("unused")

    override suspend fun joinWorkspace(
        namespaceId: String,
        invitation: SignedGroupOpenInvitation,
    ): JoinedWorkspace = error("unused")

    companion object {
        const val OTHER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"
    }
}
