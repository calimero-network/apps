package network.calimero.chat.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The contract's limits, and the init arguments of a new channel. Calls and views go through the
 * generated `ChatClient` (`generated/client`, from `logic/res/abi.json`), which names the methods
 * and their arguments; [ChatRepository] is the one place that calls it.
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

    /** The cap on a channel's (app instance's) and a workspace's name. */
    const val MAX_CHANNEL_NAME_BYTES = 64

    /**
     * `init(name?, contextType?, description?, creatorUsername?)` for a new channel, in the
     * component ABI's names (the web's `initArgsFrom`). The node hands them to the new instance as
     * they are, when it creates it; `createdAt` comes from the log's clock.
     */
    fun channelInit(
        name: String,
        creatorUsername: String,
    ): JsonObject =
        buildJsonObject {
            put("name", name)
            put("contextType", ChatContextInfo.CONTEXT_TYPE_CHANNEL)
            put("description", "")
            put("creatorUsername", creatorUsername)
        }
}

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
