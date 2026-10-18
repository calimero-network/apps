package network.calimero.chat.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/*
 * What the `com.calimero.chat` contract (apps/mero-chat/logic/src/lib.rs) returns, as serde writes
 * it: snake_case keys, `Option` as null or absent, `UserId` as a base58 string, `u64` timestamps in
 * seconds. Only the fields this app reads are required; everything else has a default, so a
 * contract that adds a field does not break the app.
 */

/** The one JSON configuration for contract arguments and results. */
internal val chatJson: Json =
    Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        coerceInputValues = true
    }

/** `AttachmentPublic`. Shown by name only: blob download is not part of this app yet. */
@Serializable
data class ChatAttachment(
    val name: String = "",
    @SerialName("mime_type") val mimeType: String = "",
    val size: Long = 0,
    @SerialName("blob_id") val blobId: String = "",
    @SerialName("uploaded_at") val uploadedAt: Long = 0,
)

/**
 * `MessageWithReactions` (`get_messages`, `get_messages_from`); `send_message` / `edit_message`
 * return the slimmer `Message`, which decodes into this with [index] 0.
 */
@Serializable
data class ChatMessage(
    /** Position in the channel's append-only vector: a stable cursor (lib.rs `MessageWithReactions::index`). */
    val index: Long = 0,
    val id: String,
    val text: String = "",
    /** The sender's account, base58 — taken from the entry's owner stamp by the contract. */
    val sender: String = "",
    /** Seconds since the epoch, as the sender's client stamped it. */
    val timestamp: Long = 0,
    val mentions: List<String> = emptyList(),
    @SerialName("mentions_usernames") val mentionsUsernames: List<String> = emptyList(),
    val files: List<ChatAttachment> = emptyList(),
    val images: List<ChatAttachment> = emptyList(),
    @SerialName("edited_on") val editedOn: Long? = null,
    /** Emoji → the accounts (base58) that reacted with it. Null for a deleted message. */
    val reactions: Map<String, List<String>>? = null,
    val deleted: Boolean? = null,
    @SerialName("thread_count") val threadCount: Int = 0,
    @SerialName("thread_last_timestamp") val threadLastTimestamp: Long = 0,
    @SerialName("parent_message_id") val parentMessageId: String? = null,
) {
    val isDeleted: Boolean get() = deleted == true
    val isEdited: Boolean get() = editedOn != null
}

/** `FullMessageResponse`. */
@Serializable
data class ChatMessagePage(
    @SerialName("total_count") val totalCount: Long = 0,
    val messages: List<ChatMessage> = emptyList(),
    @SerialName("start_position") val startPosition: Long = 0,
)

/** `ContextInfo` (`get_info`). `context_type` is the serde name of `ContextType`: `Channel` or `Dm`. */
@Serializable
data class ChatContextInfo(
    val name: String = "",
    @SerialName("context_type") val contextType: String = CONTEXT_TYPE_CHANNEL,
    val description: String = "",
    @SerialName("created_at") val createdAt: Long = 0,
    val creator: String = "",
) {
    val isDm: Boolean get() = contextType == CONTEXT_TYPE_DM

    companion object {
        const val CONTEXT_TYPE_CHANNEL = "Channel"
        const val CONTEXT_TYPE_DM = "Dm"
    }
}

/** `UserProfile` (`get_profiles`). */
@Serializable
data class ChatProfile(
    /** base58 account. */
    val identity: String,
    val username: String = "",
    val avatar: String? = null,
)
