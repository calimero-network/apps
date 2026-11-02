package network.calimero.updates.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import network.calimero.updates.generated.ContextContractCalling

/**
 * The contract's component ABI (`logic/res/abi.json`, `calimero:app@0.5.0`) under the v1 generated
 * client, as the web app's `app/src/lib/updatesClient.ts` does it: the one place the wire
 * difference is absorbed, so no model or screen changed. (Swift `ComponentWire`.)
 *
 * - Out: the method name and every argument key become camelCase (`add_comment {post_id}` →
 *   `addComment {postId}`), a parameter the client left out is sent as `null` (the ABI's
 *   `option<…>`), and the `u64` argument `since` is sent as a decimal string.
 * - In: every key becomes snake_case again, and the `u64` fields the contract sends as decimal
 *   strings ([U64_FIELDS]) become numbers.
 *
 * A refusal stays the SDK's `AppError` (`422 APP_ERROR {code, fields}`).
 */
class ComponentWire(
    private val inner: ContextContractCalling,
) : ContextContractCalling {
    /** One contract method: whether it is a view, and its parameters in order. */
    data class Method(
        val view: Boolean,
        val params: List<String>,
    )

    override suspend fun query(
        method: String,
        argsJson: String,
    ): String {
        val (name, args) = outgoing(method, argsJson)
        return incoming(inner.query(name, args))
    }

    override suspend fun execute(
        method: String,
        argsJson: String,
    ): String {
        val (name, args) = outgoing(method, argsJson)
        return incoming(inner.execute(name, args))
    }

    companion object {
        /** Every contract method (minus `init`). */
        val METHODS: Map<String, Method> =
            mapOf(
                "addComment" to Method(false, listOf("postId", "parentId", "body")),
                "addTeammate" to Method(false, listOf("account")),
                "archiveCategory" to Method(false, listOf("categoryId")),
                "askQuestion" to Method(false, listOf("title", "body", "categoryId")),
                "createCategory" to Method(false, listOf("name", "emoji", "color")),
                "deleteComment" to Method(false, listOf("commentId")),
                "deleteDraft" to Method(false, listOf("draftId")),
                "deletePost" to Method(false, listOf("postId")),
                "editCategory" to Method(false, listOf("categoryId", "name", "emoji", "color")),
                "editComment" to Method(false, listOf("commentId", "body")),
                "editUpdate" to Method(false, listOf("postId", "input")),
                "getEngagement" to Method(true, listOf()),
                "getMe" to Method(true, listOf()),
                "getOverview" to Method(true, listOf()),
                "getPost" to Method(true, listOf("postId")),
                "getSettings" to Method(true, listOf()),
                "listAsks" to Method(true, listOf("status")),
                "listCategories" to Method(true, listOf()),
                "listComments" to Method(true, listOf("postId")),
                "listContributions" to Method(true, listOf("since")),
                "listDrafts" to Method(true, listOf()),
                "listMetrics" to Method(true, listOf()),
                "listPeople" to Method(true, listOf()),
                "listPosts" to Method(true, listOf("kind", "categoryId", "cursor", "limit")),
                "markRead" to Method(false, listOf("postId")),
                "offerHelp" to Method(false, listOf("askId", "note")),
                "publishUpdate" to Method(false, listOf("input")),
                "react" to Method(false, listOf("postId", "emoji", "on")),
                "removeTeammate" to Method(false, listOf("account")),
                "saveDraft" to Method(false, listOf("draftId", "title", "payload")),
                "setAskStatus" to Method(false, listOf("askId", "status")),
                "setMutedCategories" to Method(false, listOf("categoryIds")),
                "setOfferStatus" to Method(false, listOf("askId", "account", "status")),
                "setProfile" to Method(false, listOf("name", "firm")),
                "setQuestionStatus" to Method(false, listOf("postId", "status")),
                "setSettings" to Method(false, listOf("companyName", "cadenceDays")),
                "withdrawOffer" to Method(false, listOf("askId")),
            )

        /**
         * The `u64` fields (by their snake_case name) the contract sends as decimal strings (==
         * `U64_FIELDS` in `updatesClient.ts`). Only these become numbers: a metric's `value` or an
         * all-digit id stays a string.
         */
        val U64_FIELDS: Set<String> =
            setOf(
                "accepted_at", "accepted_offers", "ask_count", "at", "comment_count", "comments", "count", "created_at",
                "edited_at", "first_at", "joined_at", "last_read_at", "last_update_at", "metric_count", "next_due_at",
                "offer_count", "offers", "open_ask_count", "open_asks", "open_questions", "people", "published_at",
                "reactions", "read_count", "unread_count", "unread_updates", "update_count", "updated_at", "updates_read",
                "updates_total",
            )

        /** `u64` arguments, sent as decimal strings. */
        private val U64_ARGS = setOf("since")

        /** The method's ABI name, and its arguments as the contract takes them. */
        fun outgoing(
            method: String,
            argsJson: String,
        ): Pair<String, String> {
            val name = camel(method)
            val parsed = if (argsJson.isBlank()) JsonObject(emptyMap()) else Json.parseToJsonElement(argsJson)
            val args = (toWire(parsed) as? JsonObject).orEmpty().toMutableMap()
            for (key in U64_ARGS) {
                val value = args[key] as? JsonPrimitive
                if (value != null && !value.isString && value !is JsonNull) args[key] = JsonPrimitive(value.content)
            }
            for (param in METHODS[name]?.params.orEmpty()) {
                if (param !in args) args[param] = JsonNull
            }
            return name to JsonObject(args).toString()
        }

        /** The contract's answer as the generated client reads it. */
        fun incoming(json: String): String {
            val value = runCatching { Json.parseToJsonElement(json) }.getOrNull() ?: return json
            return fromWire(value).toString()
        }

        private fun toWire(value: JsonElement): JsonElement =
            when (value) {
                is JsonArray -> JsonArray(value.map(::toWire))
                is JsonObject -> JsonObject(value.entries.associate { (k, v) -> camel(k) to toWire(v) })
                else -> value
            }

        private fun fromWire(value: JsonElement): JsonElement =
            when (value) {
                is JsonArray -> JsonArray(value.map(::fromWire))
                is JsonObject ->
                    JsonObject(
                        value.entries.associate { (k, v) ->
                            val name = snake(k)
                            val number = (v as? JsonPrimitive)?.takeIf { it.isString && name in U64_FIELDS }?.content?.toULongOrNull()
                            name to (number?.let { JsonPrimitive(it.toString().toBigInteger()) } ?: fromWire(v))
                        },
                    )
                else -> value
            }

        /** `post_id` → `postId`. */
        fun camel(key: String): String {
            val out = StringBuilder()
            var upper = false
            for (c in key) {
                if (c == '_') {
                    upper = true
                } else {
                    out.append(if (upper) c.uppercaseChar() else c)
                    upper = false
                }
            }
            return out.toString()
        }

        /** `postId` → `post_id`. */
        fun snake(key: String): String =
            buildString {
                for (c in key) if (c.isUpperCase()) append('_').append(c.lowercaseChar()) else append(c)
            }
    }
}
