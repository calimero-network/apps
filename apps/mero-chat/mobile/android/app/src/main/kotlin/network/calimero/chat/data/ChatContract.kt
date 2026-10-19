package network.calimero.chat.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** The `com.calimero.chat` methods this app calls (lib.rs `#[app::logic] impl MeroChat`). */
object ChatMethods {
    // Views: read through the relay's account-scoped query route.
    const val GET_INFO = "get_info"
    const val GET_MESSAGES = "get_messages"
    const val GET_MESSAGES_FROM = "get_messages_from"
    const val GET_PROFILES = "get_profiles"
    const val GET_UNREAD_COUNT = "get_unread_count"

    // Writes: signed warrants through the relay's intents route.
    const val SEND_MESSAGE = "send_message"
    const val EDIT_MESSAGE = "edit_message"
    const val DELETE_MESSAGE = "delete_message"
    const val UPDATE_REACTION = "update_reaction"
    const val SET_PROFILE = "set_profile"
    const val MARK_AS_READ = "mark_as_read"

    val VIEWS: Set<String> = setOf(GET_INFO, GET_MESSAGES, GET_MESSAGES_FROM, GET_PROFILES, GET_UNREAD_COUNT)
}

/**
 * Argument objects, key for key what the web app sends (app/src/api/dataSource/clientApiDataSource.ts
 * and app/src/chat/ChatContainer.tsx). Where the web app leaves an optional argument `undefined` —
 * which `JSON.stringify` drops — the key is omitted here too, and the contract reads it as `None`.
 */
object ChatArgs {
    /** The web app's `MESSAGE_PAGE_SIZE`. */
    const val PAGE_SIZE = 20

    /** lib.rs `MAX_MESSAGE_LEN`, in bytes. */
    const val MAX_MESSAGE_BYTES = 20_000

    /** lib.rs `set_profile`: at most 50 (bytes, as Rust's `len()` counts). */
    const val MAX_USERNAME_BYTES = 50

    /** lib.rs `MAX_EMOJI_LEN`. */
    const val MAX_EMOJI_BYTES = 64

    /** core's metadata record cap for a group's (subgroup's) name, which a channel's name is. */
    const val MAX_CHANNEL_NAME_BYTES = 64

    /**
     * `get_messages(parent_message, limit, offset, search_term)`: a window counted back from the
     * END, offset 0 being the newest page — what the web app asks for to open and to refresh a
     * channel.
     */
    fun getMessages(
        limit: Int = PAGE_SIZE,
        offset: Int = 0,
        parentMessage: String? = null,
        searchTerm: String? = null,
    ): JsonObject =
        buildJsonObject {
            parentMessage?.let { put("parent_message", it) }
            put("limit", limit)
            put("offset", offset)
            searchTerm?.takeIf { it.isNotEmpty() }?.let { put("search_term", it) }
        }

    /** `get_messages_from(start, limit)`: by absolute position, ascending — the resumable read. */
    fun getMessagesFrom(
        start: Long,
        limit: Int,
    ): JsonObject =
        buildJsonObject {
            put("start", start)
            put("limit", limit)
        }

    /**
     * `send_message(message, mentions, mentions_usernames, parent_message, timestamp, files, images)`.
     * `mentions` and `mentions_usernames` are required vectors; the rest stay absent when unused,
     * as on the web.
     */
    fun sendMessage(
        text: String,
        timestampSecs: Long,
        mentions: List<String> = emptyList(),
        mentionUsernames: List<String> = emptyList(),
        parentMessage: String? = null,
    ): JsonObject =
        buildJsonObject {
            put("message", text)
            put("mentions", JsonArray(mentions.map { JsonPrimitive(it) }))
            put("mentions_usernames", JsonArray(mentionUsernames.map { JsonPrimitive(it) }))
            parentMessage?.let { put("parent_message", it) }
            put("timestamp", timestampSecs)
        }

    /** `edit_message(message_id, new_message, timestamp, parent_id)`. */
    fun editMessage(
        messageId: String,
        newText: String,
        timestampSecs: Long,
        parentId: String? = null,
    ): JsonObject =
        buildJsonObject {
            put("message_id", messageId)
            put("new_message", newText)
            put("timestamp", timestampSecs)
            parentId?.let { put("parent_id", it) }
        }

    /** `delete_message(message_id, parent_id)`. */
    fun deleteMessage(
        messageId: String,
        parentId: String? = null,
    ): JsonObject =
        buildJsonObject {
            put("message_id", messageId)
            parentId?.let { put("parent_id", it) }
        }

    /** `update_reaction(message_id, emoji, add)`. */
    fun updateReaction(
        messageId: String,
        emoji: String,
        add: Boolean,
    ): JsonObject =
        buildJsonObject {
            put("message_id", messageId)
            put("emoji", emoji)
            put("add", add)
        }

    /** `set_profile(username, avatar)`; the web app sends `avatar: null` explicitly. */
    fun setProfile(username: String): JsonObject =
        buildJsonObject {
            put("username", username)
            put("avatar", JsonNull)
        }

    /** `mark_as_read(timestamp)`, seconds. */
    fun markAsRead(timestampSecs: Long): JsonObject = buildJsonObject { put("timestamp", timestampSecs) }

    /** The empty object the argument-less views take. */
    fun none(): JsonObject = JsonObject(emptyMap())

    /** `init(name, context_type, description, created_at, creator_username)` for a new channel. */
    fun channelInit(
        name: String,
        createdAtSecs: Long,
        creatorUsername: String,
    ): JsonObject =
        buildJsonObject {
            put("name", name)
            put("context_type", ChatContextInfo.CONTEXT_TYPE_CHANNEL)
            put("description", "")
            put("created_at", createdAtSecs)
            put("creator_username", creatorUsername)
        }
}

/** `init`'s arguments as the JSON bytes a node's context-creation request carries. */
fun initBytes(init: JsonObject): List<Int> = init.toString().toByteArray(Charsets.UTF_8).map { it.toInt() and BYTE_MASK }

private const val BYTE_MASK = 0xff

/** Why an input is refused before anything is sent, or null when it may go out. */
object ChatValidation {
    fun messageError(text: String): String? =
        when {
            text.isBlank() -> "Type a message first."
            text.utf8Size() > ChatArgs.MAX_MESSAGE_BYTES -> "That message is too long (at most ${ChatArgs.MAX_MESSAGE_BYTES} bytes)."
            else -> null
        }

    fun usernameError(name: String): String? =
        when {
            name.isBlank() -> "Pick a name others will see."
            name.trim().utf8Size() > ChatArgs.MAX_USERNAME_BYTES -> "Names can be at most ${ChatArgs.MAX_USERNAME_BYTES} characters."
            else -> null
        }

    fun channelNameError(name: String): String? =
        when {
            name.isBlank() -> "Give the channel a name."
            name.trim().utf8Size() > ChatArgs.MAX_CHANNEL_NAME_BYTES -> "Channel names can be at most ${ChatArgs.MAX_CHANNEL_NAME_BYTES} bytes."
            else -> null
        }

    fun workspaceNameError(name: String): String? =
        when {
            name.isBlank() -> "Give the workspace a name."
            name.trim().utf8Size() > ChatArgs.MAX_CHANNEL_NAME_BYTES -> "Workspace names can be at most ${ChatArgs.MAX_CHANNEL_NAME_BYTES} bytes."
            else -> null
        }

    fun emojiError(emoji: String): String? =
        when {
            emoji.isEmpty() || emoji.utf8Size() > ChatArgs.MAX_EMOJI_BYTES || emoji.contains('\u001f') -> "That reaction can't be used."
            else -> null
        }

    private fun String.utf8Size(): Int = toByteArray(Charsets.UTF_8).size
}
