package network.calimero.forum.contract

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.serializer

/**
 * The forum contract on Calimero 1.0, as `logic/res/abi.json` declares it. The calls are the
 * generated [network.calimero.forum.generated.ForumClient] (`scripts/mobile-codegen.sh` at the repo
 * root); this file keeps the method lists and the answer types of the web app's
 * `src/lib/forumApi.ts` (Swift `ForumContract`):
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

    val JSON = Json { ignoreUnknownKeys = true }

    /**
     * An answer of the generated [network.calimero.forum.generated.ForumClient] as the app type [T],
     * read through its JSON: the client answers its own typed records (`PostView`, `PostPage`,
     * `CommentPage`), the app keeps its own.
     */
    inline fun <reified T> read(answer: Any): T = JSON.decodeFromJsonElement(serializer<T>(), answer.asContractJson())
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

/** A value of the generated client (a typed record, or the JSON of a type the ABI does not describe) as its JSON. */
fun Any.asContractJson(): JsonElement = this as? JsonElement ?: contractArgJson.encodeToJsonElement(serializer(javaClass), this)

/** [this] (an app type, or its JSON) as the generated client's type [R] (an argument), through its JSON. */
inline fun <reified R> Any.asContractArg(): R = contractArgJson.decodeFromJsonElement(serializer<R>(), asContractJson())

/** The JSON between the app's types and the generated client's: every default written, unknown keys and missing options tolerated. */
val contractArgJson =
    Json {
        encodeDefaults = true
        ignoreUnknownKeys = true
        explicitNulls = false
    }
