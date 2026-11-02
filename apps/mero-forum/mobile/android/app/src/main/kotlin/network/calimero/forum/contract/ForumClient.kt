package network.calimero.forum.contract

import com.calimero.mero.app.ContextContractCalling
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive

/**
 * The forum contract on Calimero 1.0, typed by hand from `logic/res/abi.json` (no client is
 * generated from a component ABI yet). The port of the web app's `src/lib/forumApi.ts`; Swift
 * `ForumContract`:
 *
 * - method names and arguments are camelCase (`createPost`, `postId`, `commentId`);
 * - answers are camelCase, and `createdAt`, `editedAt`, `score` and `commentCount` are decimal
 *   strings (`myVote` stays a number); [WireULong] / [WireLong] read either a string or a number;
 * - a refusal is `APP_ERROR` with `NotFound {what, id}`, `Forbidden {message}` or
 *   `Invalid {message}`, worded by `ForumErrorText`.
 */
object ForumContract {
    /** The ABI's calls. `ContractTest` checks them against the committed ABI. */
    val CALLS =
        listOf(
            "createPost",
            "editPost",
            "deletePost",
            "createComment",
            "editComment",
            "deleteComment",
            "vote",
            "voteComment",
            "setNickname",
            "setModerators",
            "moderatePost",
            "moderateComment",
        )

    /** The ABI's views. */
    val VIEWS = listOf("getPost", "listPosts", "listComments", "getNickname", "moderators")
}

/** Typed calls to one forum's contract. Views go through `query`, everything else through `execute`. (Swift `ForumClient`.) */
@Suppress("TooManyFunctions")
class ForumClient(
    private val transport: ContextContractCalling,
) {
    suspend fun createPost(
        title: String,
        body: String,
    ): String = text(execute("createPost", "title" to str(title), "body" to str(body)))

    suspend fun editPost(
        postId: String,
        title: String,
        body: String,
    ) {
        execute("editPost", "postId" to str(postId), "title" to str(title), "body" to str(body))
    }

    suspend fun deletePost(postId: String) {
        execute("deletePost", "postId" to str(postId))
    }

    suspend fun getPost(postId: String): PostView = view("getPost", PostView.serializer(), "postId" to str(postId))

    /** One page of the feed. [cursor] is opaque, and only good for the [sort] it came from. */
    suspend fun listPosts(
        sort: String? = null,
        cursor: String? = null,
        limit: UInt,
    ): PostPage = view("listPosts", PostPage.serializer(), "sort" to opt(sort), "cursor" to opt(cursor), "limit" to JsonPrimitive(limit.toLong()))

    suspend fun createComment(
        postId: String,
        body: String,
    ): String = text(execute("createComment", "postId" to str(postId), "body" to str(body)))

    suspend fun editComment(
        commentId: String,
        body: String,
    ) {
        execute("editComment", "commentId" to str(commentId), "body" to str(body))
    }

    suspend fun deleteComment(commentId: String) {
        execute("deleteComment", "commentId" to str(commentId))
    }

    suspend fun listComments(
        postId: String,
        cursor: String? = null,
        limit: UInt,
    ): CommentPage =
        view("listComments", CommentPage.serializer(), "postId" to str(postId), "cursor" to opt(cursor), "limit" to JsonPrimitive(limit.toLong()))

    /** [value] is -1, 0 (remove) or 1. */
    suspend fun vote(
        postId: String,
        value: Int,
    ) {
        execute("vote", "postId" to str(postId), "value" to JsonPrimitive(value))
    }

    suspend fun voteComment(
        commentId: String,
        value: Int,
    ) {
        execute("voteComment", "commentId" to str(commentId), "value" to JsonPrimitive(value))
    }

    suspend fun setNickname(name: String) {
        execute("setNickname", "name" to str(name))
    }

    suspend fun getNickname(account: String): String = view("getNickname", String.serializer(), "account" to str(account))

    suspend fun moderators(): List<String> = view("moderators", ListSerializer(String.serializer()))

    suspend fun setModerators(accounts: List<String>) {
        execute("setModerators", "accounts" to JsonArray(accounts.map(::JsonPrimitive)))
    }

    suspend fun moderatePost(postId: String) {
        execute("moderatePost", "postId" to str(postId))
    }

    suspend fun moderateComment(commentId: String) {
        execute("moderateComment", "commentId" to str(commentId))
    }

    // ---- wire ----

    private fun str(value: String) = JsonPrimitive(value)

    private fun opt(value: String?): JsonElement = value?.let(::JsonPrimitive) ?: JsonNull

    private fun text(json: String): String = JSON.parseToJsonElement(json).jsonPrimitive.content

    private suspend fun <T> view(
        method: String,
        serializer: KSerializer<T>,
        vararg args: Pair<String, JsonElement>,
    ): T = JSON.decodeFromString(serializer, transport.query(method, JsonObject(mapOf(*args)).toString()))

    private suspend fun execute(
        method: String,
        vararg args: Pair<String, JsonElement>,
    ): String = transport.execute(method, JsonObject(mapOf(*args)).toString())

    companion object {
        val JSON = Json { ignoreUnknownKeys = true }
    }
}

private fun wireText(decoder: Decoder): String =
    if (decoder is JsonDecoder) decoder.decodeJsonElement().jsonPrimitive.content else decoder.decodeString()

/** A `u64` off the wire: a decimal string (the component ABI), or a plain number. Written as a string. */
object WireULong : KSerializer<ULong> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("WireULong", PrimitiveKind.STRING)

    override fun serialize(
        encoder: Encoder,
        value: ULong,
    ) = encoder.encodeString(value.toString())

    override fun deserialize(decoder: Decoder): ULong = wireText(decoder).let { it.toULongOrNull() ?: throw IllegalArgumentException("not a u64: $it") }
}

/** An `i64` off the wire: a decimal string (the component ABI), or a plain number. Written as a string. */
object WireLong : KSerializer<Long> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("WireLong", PrimitiveKind.STRING)

    override fun serialize(
        encoder: Encoder,
        value: Long,
    ) = encoder.encodeString(value.toString())

    override fun deserialize(decoder: Decoder): Long = wireText(decoder).let { it.toLongOrNull() ?: throw IllegalArgumentException("not an i64: $it") }
}

@Serializable
data class PostView(
    val id: String,
    val author: String,
    /** `""` when the author never named themselves. */
    val authorName: String = "",
    val title: String,
    val body: String,
    /** Unix milliseconds. */
    @Serializable(with = WireULong::class) val createdAt: ULong,
    @Serializable(with = WireULong::class) val editedAt: ULong,
    @Serializable(with = WireLong::class) val score: Long,
    @Serializable(with = WireULong::class) val commentCount: ULong,
    /** The caller's own vote: -1, 0 or 1. */
    val myVote: Int,
)

@Serializable
data class CommentView(
    val id: String,
    val postId: String,
    val author: String,
    val authorName: String = "",
    val body: String,
    @Serializable(with = WireULong::class) val createdAt: ULong,
    @Serializable(with = WireULong::class) val editedAt: ULong,
    @Serializable(with = WireLong::class) val score: Long,
    val myVote: Int,
)

@Serializable
data class PostPage(
    val items: List<PostView>,
    /** Opaque; only good for the `sort` it came from. */
    val nextCursor: String? = null,
)

@Serializable
data class CommentPage(
    val items: List<CommentView>,
    val nextCursor: String? = null,
)
