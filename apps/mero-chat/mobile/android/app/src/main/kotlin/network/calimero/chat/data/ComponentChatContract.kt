package network.calimero.chat.data

import com.calimero.mero.app.ContextContract
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.longOrNull

/**
 * The chat contract on the component runtime (`logic/res/abi.json`, the web port #730), behind the
 * v1 shapes the rest of the app speaks. [ChatArgs] and the models in ChatWire.kt still name methods
 * and fields the v1 way (`send_message`, `parent_message`, numbers for timestamps); the component ABI
 * names methods, arguments and answer fields in camelCase and sends every `u64` as a decimal string.
 * This is the one place that knows both, the same table the web's `src/api/meroChat.ts` keeps
 * (Swift `ComponentChatContract`):
 *
 * - the method name and every argument key go to camelCase;
 * - `u64` arguments (`timestamp`, `start`) go out as decimal strings;
 * - answers come back with snake_case keys and their `u64` strings as numbers. A message's
 *   `reactions` keys are emoji, data rather than field names, and are kept.
 */
class ComponentChatContract(
    private val inner: ContextContract,
) {
    suspend fun query(
        contextId: String,
        method: String,
        args: JsonObject,
    ): JsonElement? = result(inner.query(contextId, method(method), args(args)), method)

    suspend fun execute(
        contextId: String,
        method: String,
        args: JsonObject,
    ): JsonElement? = result(inner.execute(contextId, method(method), args(args)), method)

    companion object {
        /** `u64` arguments, sent as decimal strings. */
        val U64_ARGUMENTS = setOf("timestamp", "start")

        /** `u64` answer fields (after the snake_case rename), read back as numbers. */
        val U64_ANSWERS =
            setOf(
                "index",
                "timestamp",
                "size",
                "uploaded_at",
                "edited_on",
                "thread_last_timestamp",
                "created_at",
                "anchor_timestamp",
                "frontier_timestamp",
            )

        /** Methods whose whole answer is a `u64` (`getMessageCount`, `messagePosition`). */
        val U64_RESULTS = setOf("get_message_count", "message_position")

        /** `send_message` → `sendMessage`. */
        fun method(v1: String): String = camel(v1)

        /** v1 arguments → the ABI's. */
        fun args(args: JsonObject): JsonObject =
            JsonObject(
                args.entries.associate { (key, value) ->
                    val long = (value as? JsonPrimitive)?.takeUnless { it.isString }?.longOrNull
                    camel(key) to if (key in U64_ARGUMENTS && long != null) JsonPrimitive(long.coerceAtLeast(0).toString()) else camelKeys(value)
                },
            )

        /** The ABI's answer → v1's. */
        fun result(
            value: JsonElement?,
            method: String,
        ): JsonElement? {
            if (value == null) return null
            if (method in U64_RESULTS) return number(value)
            return snakeKeys(value, null)
        }

        private fun camelKeys(value: JsonElement): JsonElement =
            when (value) {
                is JsonObject -> JsonObject(value.entries.associate { (k, v) -> camel(k) to camelKeys(v) })
                is JsonArray -> JsonArray(value.map(::camelKeys))
                else -> value
            }

        private fun snakeKeys(
            value: JsonElement,
            key: String?,
        ): JsonElement =
            when {
                value is JsonObject && key == "reactions" -> value
                value is JsonObject ->
                    JsonObject(
                        value.entries.associate { (k, v) ->
                            val name = snake(k)
                            name to snakeKeys(v, name)
                        },
                    )
                value is JsonArray -> JsonArray(value.map { snakeKeys(it, key) })
                value is JsonPrimitive && value.isString && key in U64_ANSWERS -> number(value)
                else -> value
            }

        /** A decimal string as a number; anything else as it is. */
        private fun number(value: JsonElement): JsonElement {
            val text = (value as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return value
            return text.toULongOrNull()?.let { JsonPrimitive(it.toLong()) } ?: value
        }

        fun camel(snake: String): String {
            val parts = snake.split('_')
            if (parts.size < 2) return snake
            return parts.first() + parts.drop(1).joinToString("") { it.replaceFirstChar(Char::uppercaseChar) }
        }

        fun snake(camel: String): String =
            buildString {
                for (ch in camel) {
                    if (ch.isUpperCase()) append('_').append(ch.lowercaseChar()) else append(ch)
                }
            }
    }
}
