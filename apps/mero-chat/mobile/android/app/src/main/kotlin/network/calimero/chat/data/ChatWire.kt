package network.calimero.chat.data

import kotlinx.serialization.json.Json
import network.calimero.chat.generated.client.ChatClient

/*
 * The app's models of what the `com.calimero.chat` contract answers. The generated [ChatClient]
 * (from `logic/res/abi.json`, by `scripts/mobile-codegen.sh`) reads the wire: camelCase fields,
 * `u64`s as decimal strings, `Option` as null. The functions at the end of this file turn its typed
 * answers into these models, which the view models and screens keep using.
 */

/** The JSON configuration for what this app parses itself (invitation links). */
internal val chatJson: Json =
    Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        coerceInputValues = true
    }

/** `AttachmentView`. Shown by name only: blob download is not part of this app yet. */
data class ChatAttachment(
    val name: String = "",
    val mimeType: String = "",
    val size: Long = 0,
    val blobId: String = "",
    val uploadedAt: Long = 0,
)

/** `MessageView` (`getMessages`, `getMessagesFrom`, and what `sendMessage` / `editMessage` answer). */
data class ChatMessage(
    /** Position in the channel's append-only vector: a stable cursor (lib.rs `MessageView::index`). */
    val index: Long = 0,
    val id: String,
    val text: String = "",
    /** The sender's account, taken from the entry's owner stamp by the contract. */
    val sender: String = "",
    /** Seconds since the epoch, as the sender's client stamped it. */
    val timestamp: Long = 0,
    val mentions: List<String> = emptyList(),
    val mentionsUsernames: List<String> = emptyList(),
    val files: List<ChatAttachment> = emptyList(),
    val images: List<ChatAttachment> = emptyList(),
    val editedOn: Long? = null,
    /** Emoji to the accounts that reacted with it. Null for a deleted message. */
    val reactions: Map<String, List<String>>? = null,
    val deleted: Boolean? = null,
    val threadCount: Int = 0,
    val threadLastTimestamp: Long = 0,
    val parentMessageId: String? = null,
) {
    val isDeleted: Boolean get() = deleted == true
    val isEdited: Boolean get() = editedOn != null
}

/** `FullMessageResponse`. */
data class ChatMessagePage(
    val totalCount: Long = 0,
    val messages: List<ChatMessage> = emptyList(),
    val startPosition: Long = 0,
)

/** `ContextInfo` (`getInfo`). [contextType] is the `ContextType` variant's name: `Channel` or `Dm`. */
data class ChatContextInfo(
    val name: String = "",
    val contextType: String = CONTEXT_TYPE_CHANNEL,
    val description: String = "",
    val createdAt: Long = 0,
    val creator: String = "",
) {
    val isDm: Boolean get() = contextType == CONTEXT_TYPE_DM

    companion object {
        const val CONTEXT_TYPE_CHANNEL = "Channel"
        const val CONTEXT_TYPE_DM = "Dm"
    }
}

/** `UserProfile` (`getProfiles`). */
data class ChatProfile(
    /** The account. */
    val identity: String,
    val username: String = "",
    val avatar: String? = null,
)

// ---- the generated client's answers as the app's models ----------------------------------------

internal fun ChatClient.AttachmentView.toChatAttachment(): ChatAttachment = ChatAttachment(name, mimeType, size.toLong(), blobId, uploadedAt.toLong())

internal fun ChatClient.MessageView.toChatMessage(): ChatMessage =
    ChatMessage(
        index = index.toLong(),
        id = id,
        text = text,
        sender = sender,
        timestamp = timestamp.toLong(),
        mentions = mentions,
        mentionsUsernames = mentionsUsernames,
        files = files.map { it.toChatAttachment() },
        images = images.map { it.toChatAttachment() },
        editedOn = editedOn?.toLong(),
        reactions = reactions,
        deleted = deleted,
        threadCount = threadCount.toInt(),
        threadLastTimestamp = threadLastTimestamp.toLong(),
        parentMessageId = parentMessageId,
    )

internal fun ChatClient.FullMessageResponse.toChatMessagePage(): ChatMessagePage =
    ChatMessagePage(totalCount.toLong(), messages.map { it.toChatMessage() }, startPosition.toLong())

internal fun ChatClient.ContextInfo.toChatContextInfo(): ChatContextInfo =
    ChatContextInfo(
        name = name,
        contextType =
            when (contextType) {
                ChatClient.ContextType.Channel -> ChatContextInfo.CONTEXT_TYPE_CHANNEL
                ChatClient.ContextType.Dm -> ChatContextInfo.CONTEXT_TYPE_DM
            },
        description = description,
        createdAt = createdAt.toLong(),
        creator = creator,
    )

internal fun ChatClient.UserProfile.toChatProfile(): ChatProfile = ChatProfile(identity, username, avatar)
