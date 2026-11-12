package network.calimero.chat.app

import com.calimero.mero.app.AppContextEntry
import com.calimero.mero.app.AppNamespace
import com.calimero.mero.app.AppSubgroup
import com.calimero.mero.app.OrgInvitation
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import network.calimero.chat.data.ChatAbi
import network.calimero.chat.data.ChatBackend
import network.calimero.chat.data.ChatIdentity
import network.calimero.chat.data.ChatMessage
import network.calimero.chat.data.ChatMessagePage
import network.calimero.chat.data.ChatProfile
import network.calimero.chat.data.FoundWorkspace
import network.calimero.chat.data.JoinedWorkspace
import network.calimero.chat.data.RecordingChatContract
import network.calimero.chat.generated.client.ChatClient
import java.util.concurrent.CopyOnWriteArrayList

/**
 * One channel's contract, in memory, behind the generated `ChatClient` — `getMessages` with the
 * contract's end-counted `page_window`, `getMessagesFrom` by absolute index — for the view-model
 * logic (paging, catch-up, live/poll switching). Every view and call is recorded in the ABI's names
 * ([calls], [methods]); the wire path through the SDK is covered in `CloudBackendTest`.
 */
class InMemoryChat(
    accountHex: String = "ab".repeat(32),
    /** Null: no live stream, so the model polls. */
    var live: MutableSharedFlow<Unit>? = null,
) : ChatBackend {
    override val accountId: String = accountHex
    val me: String = ChatIdentity.userIdOf(accountHex)!!
    val messages = CopyOnWriteArrayList<ChatMessage>()
    private val contract = RecordingChatContract { method, args -> answer(method, args) }

    /** Each view and call, as (ABI method name, ABI arguments). */
    val calls: List<Pair<String, JsonObject>> get() = contract.calls.map { it.method to it.args }

    /** Thrown by the next view or call instead of answering. */
    var failNext: Exception?
        get() = contract.failNext
        set(value) {
            contract.failNext = value
        }

    /** What `getProfiles` answers; by default someone else and this account. */
    var profiles: List<ChatProfile>? = null

    fun post(
        text: String,
        sender: String = OTHER,
    ) {
        val index = messages.size.toLong()
        messages += ChatMessage(index = index, id = "id$index", text = text, sender = sender, timestamp = 1_000 + index)
    }

    override fun chat(contextId: String): ChatClient = contract.client

    private fun answer(
        method: String,
        args: JsonObject,
    ): JsonElement =
        when (method) {
            "getMessages" -> page(args["limit"]!!.jsonPrimitive.int, args["offset"]!!.jsonPrimitive.int)
            "getMessagesFrom" -> from(args["start"]!!.jsonPrimitive.long, args["limit"]!!.jsonPrimitive.int)
            "getProfiles" -> ChatAbi.profiles(profiles ?: listOf(ChatProfile(OTHER, "alice"), ChatProfile(me, "droid")))
            "sendMessage" -> {
                post(args["message"]!!.jsonPrimitive.content, sender = me)
                ChatAbi.messageJson(messages.last())
            }
            "updateReaction" -> ok { react(args["messageId"]!!.jsonPrimitive.content, args["emoji"]!!.jsonPrimitive.content, args["add"]!!.jsonPrimitive.boolean) }
            "editMessage" -> {
                val id = args["messageId"]!!.jsonPrimitive.content
                replace(id) { it.copy(text = args["newMessage"]!!.jsonPrimitive.content, editedOn = 1) }
                ChatAbi.messageJson(messages.first { it.id == id })
            }
            "deleteMessage" -> ok { replace(args["messageId"]!!.jsonPrimitive.content) { it.copy(text = "", deleted = true, reactions = null) } }
            "markAsRead", "setProfile" -> ok {}
            else -> error("unexpected method $method")
        }

    private fun ok(change: () -> Unit): JsonElement {
        change()
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

    private fun encode(page: ChatMessagePage) = ChatAbi.page(page)

    override fun changes(contextId: String): Flow<Unit>? = live

    // ---- not used by the channel model -------------------------------------------------------

    override suspend fun listWorkspaces(): List<AppNamespace> = emptyList()

    override suspend fun listSubgroups(namespaceId: String): List<AppSubgroup> = emptyList()

    override suspend fun listGroupContexts(groupId: String): List<AppContextEntry> = emptyList()

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

    override suspend fun createInvitation(namespaceId: String): OrgInvitation = error("unused")

    override suspend fun joinWorkspace(
        namespaceId: String,
        invitation: OrgInvitation,
    ): JoinedWorkspace = error("unused")

    companion object {
        val OTHER: String = "cd".repeat(32)
    }
}
