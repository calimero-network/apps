package network.calimero.chat.data

import com.calimero.mero.app.AppContextEntry
import com.calimero.mero.app.AppNamespace
import com.calimero.mero.app.AppSubgroup
import com.calimero.mero.app.ContextContractCalling
import com.calimero.mero.app.OrgInvitation
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import network.calimero.chat.generated.client.ChatClient
import java.util.concurrent.CopyOnWriteArrayList

/**
 * The test side of the generated [ChatClient]'s seam: a [ContextContractCalling] double that records
 * each view and call in the ABI's names (`getMessages`, `messageId`, `u64`s as decimal strings) and
 * answers with what [answer] returns, and the app's models written as the contract writes them.
 */
class RecordingChatContract(
    /** The answer to a method and its arguments, as the contract writes it. */
    var answer: suspend (method: String, args: JsonObject) -> JsonElement = { _, _ -> JsonPrimitive("ok") },
) : ContextContractCalling {
    /** One view or call as the client sent it. */
    data class Call(
        val method: String,
        val args: JsonObject,
        val isView: Boolean,
    )

    val calls = CopyOnWriteArrayList<Call>()

    /** Thrown by the next view or call instead of answering, then cleared. */
    var failNext: Exception? = null

    val client: ChatClient get() = ChatClient(this)

    override suspend fun query(
        method: String,
        argsJson: String,
    ): String = run(method, argsJson, isView = true)

    override suspend fun execute(
        method: String,
        argsJson: String,
    ): String = run(method, argsJson, isView = false)

    fun methods(): List<String> = calls.map { it.method }

    fun last(method: String): JsonObject = calls.last { it.method == method }.args

    private suspend fun run(
        method: String,
        argsJson: String,
        isView: Boolean,
    ): String {
        val args = if (argsJson.isBlank()) JsonObject(emptyMap()) else Json.parseToJsonElement(argsJson).jsonObject
        calls += Call(method, args, isView)
        failNext?.let {
            failNext = null
            throw it
        }
        return answer(method, args).toString()
    }
}

/** The app's models as the contract writes them (the generated client's own JSON). */
object ChatAbi {
    private val json = Json

    fun page(page: ChatMessagePage): JsonElement =
        json.encodeToJsonElement(
            ChatClient.FullMessageResponse.serializer(),
            ChatClient.FullMessageResponse(page.totalCount.toUInt(), page.messages.map(::message), page.startPosition.toUInt()),
        )

    fun messageJson(message: ChatMessage): JsonElement = json.encodeToJsonElement(ChatClient.MessageView.serializer(), message(message))

    fun profiles(profiles: List<ChatProfile>): JsonElement =
        json.encodeToJsonElement(
            ListSerializer(ChatClient.UserProfile.serializer()),
            profiles.map { ChatClient.UserProfile(it.identity, it.username, it.avatar) },
        )

    private fun message(m: ChatMessage) =
        ChatClient.MessageView(
            index = m.index.toULong(),
            timestamp = m.timestamp.toULong(),
            sender = m.sender,
            mentions = m.mentions,
            mentionsUsernames = m.mentionsUsernames,
            files = m.files.map(::attachment),
            images = m.images.map(::attachment),
            id = m.id,
            text = m.text,
            editedOn = m.editedOn?.toULong(),
            reactions = m.reactions,
            deleted = m.deleted,
            threadCount = m.threadCount.toUInt(),
            threadLastTimestamp = m.threadLastTimestamp.toULong(),
            parentMessageId = m.parentMessageId,
        )

    private fun attachment(a: ChatAttachment) = ChatClient.AttachmentView(a.name, a.mimeType, a.size.toULong(), a.blobId, a.uploadedAt.toULong())
}

/** A signed-in [ChatBackend] whose app instances all answer through [contract]; nothing else is used. */
class TestChatBackend(
    private val contract: RecordingChatContract,
    override val accountId: String? = "ab".repeat(32),
) : ChatBackend {
    override fun chat(contextId: String): ChatClient = contract.client

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

    override fun changes(contextId: String): Flow<Unit>? = null
}
