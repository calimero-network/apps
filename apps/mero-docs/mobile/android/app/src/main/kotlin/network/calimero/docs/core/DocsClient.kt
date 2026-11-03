package network.calimero.docs.core

import com.calimero.mero.app.ContextContractCalling
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.floatOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

// The contract's methods the phone calls, typed: the read and comment half of the web's adapter
// (`app/src/lib/docsApi.ts`), over the component ABI in `../logic/res/abi.json`.
// (Swift `DocsClient.swift`.)
//
// - Method and argument names are camelCase (`listDocs { includeArchived }`), results' fields too.
// - 64-bit integers arrive as decimal strings, timestamps in milliseconds. Like the web adapter,
//   this converts them back to the nanoseconds the screens were written for (`createdAt`,
//   `updatedAt`), and `total` to a number.
// - A read is a view (`query`), a write a call (`execute`).

/** A document's header (`DocView`). Timestamps in nanoseconds, as the web adapter hands them on. */
data class DocDto(
    val id: String,
    val title: String,
    val tags: List<String>,
    val archived: Boolean,
    val createdAt: ULong,
    val updatedAt: ULong,
    val createdBy: String,
    val updatedBy: String,
    val canDelete: Boolean,
) {
    companion object {
        fun from(element: JsonElement?): DocDto {
            val o = element as? JsonObject ?: throw WireException("a document")
            return DocDto(
                id = o.str("id") ?: throw WireException("a document id"),
                title = o.str("title").orEmpty(),
                tags = (o["tags"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.orEmpty(),
                archived = o.bool("archived"),
                createdAt = Wire.nanos(o["createdAt"]),
                updatedAt = Wire.nanos(o["updatedAt"]),
                createdBy = o.str("createdBy").orEmpty(),
                updatedBy = o.str("updatedBy").orEmpty(),
                canDelete = o.bool("canDelete"),
            )
        }
    }
}

/** A comment (`CommentView`). [createdAt] in nanoseconds. */
data class CommentDto(
    val id: String,
    val author: String,
    val docId: String,
    val body: String,
    val createdAt: ULong,
) {
    companion object {
        fun from(element: JsonElement?): CommentDto {
            val o = element as? JsonObject ?: throw WireException("a comment")
            return CommentDto(
                id = o.str("id") ?: throw WireException("a comment id"),
                author = o.str("author").orEmpty(),
                docId = o.str("docId").orEmpty(),
                body = o.str("body").orEmpty(),
                createdAt = Wire.nanos(o["createdAt"]),
            )
        }
    }
}

/** One document `searchDocs` found; [snippet] has the matched words in `<b>`. */
data class DocSearchHit(
    val id: String,
    val title: String,
    val snippet: String,
    val score: Float,
    val archived: Boolean,
)

/** A page of `searchDocs`. */
data class DocSearchPage(
    val hits: List<DocSearchHit>,
    val total: ULong,
    val nextCursor: UInt? = null,
) {
    companion object {
        fun from(element: JsonElement?): DocSearchPage {
            val o = element as? JsonObject ?: return DocSearchPage(emptyList(), 0u)
            val hits =
                (o["hits"] as? JsonArray).orEmpty().mapNotNull { raw ->
                    val h = raw as? JsonObject ?: return@mapNotNull null
                    DocSearchHit(
                        id = h.str("id") ?: return@mapNotNull null,
                        title = h.str("title").orEmpty(),
                        snippet = h.str("snippet").orEmpty(),
                        score = (h["score"] as? JsonPrimitive)?.floatOrNull ?: 0f,
                        archived = h.bool("archived"),
                    )
                }
            return DocSearchPage(
                hits = hits,
                total = Wire.u64(o["total"]),
                nextCursor = (o["nextCursor"] as? JsonPrimitive)?.longOrNull?.toUInt(),
            )
        }
    }
}

/** The node answered with a shape the contract never writes. */
class WireException(
    what: String,
) : IllegalStateException("The node sent an answer this app could not read ($what).")

/** The contract's `u64` encoding: a decimal string (a number is taken too). */
internal object Wire {
    private const val NANOS_PER_MILLI = 1_000_000uL

    fun u64(element: JsonElement?): ULong {
        val p = element as? JsonPrimitive ?: return 0u
        return p.contentOrNull?.toULongOrNull() ?: 0u
    }

    /** Milliseconds on the wire as nanoseconds (`msToNs` in the web adapter). */
    fun nanos(element: JsonElement?): ULong {
        val ms = u64(element)
        return if (ms > ULong.MAX_VALUE / NANOS_PER_MILLI) 0u else ms * NANOS_PER_MILLI
    }
}

private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

private fun JsonObject.bool(key: String): Boolean = (this[key] as? JsonPrimitive)?.booleanOrNull ?: false

/** The methods of one folder's docs instance the phone calls, by their ABI names. (Swift `DocsClient`.) */
class DocsClient(
    private val transport: ContextContractCalling,
) {
    suspend fun listDocs(includeArchived: Boolean): List<DocDto> =
        rows(view("listDocs", buildJsonObject { put("includeArchived", includeArchived) }), "documents").map(DocDto::from)

    suspend fun getDoc(id: String): DocDto = DocDto.from(view("getDoc", buildJsonObject { put("id", id) }))

    suspend fun searchDocs(
        query: String,
        includeArchived: Boolean,
        cursor: UInt? = null,
        limit: UInt? = null,
    ): DocSearchPage =
        DocSearchPage.from(
            view(
                "searchDocs",
                buildJsonObject {
                    put("query", query)
                    put("includeArchived", includeArchived)
                    put("cursor", cursor?.let { JsonPrimitive(it.toLong()) } ?: JsonNull)
                    put("limit", limit?.let { JsonPrimitive(it.toLong()) } ?: JsonNull)
                },
            ),
        )

    suspend fun listComments(docId: String): List<CommentDto> =
        rows(view("listComments", buildJsonObject { put("docId", docId) }), "comments").map(CommentDto::from)

    /** Comment on [docId]; answers the comment's id. */
    suspend fun addComment(
        docId: String,
        body: String,
    ): String {
        val args =
            buildJsonObject {
                put("docId", docId)
                put("body", body)
            }
        val answer = Json.parseToJsonElement(transport.execute("addComment", args.toString()))
        return (answer as? JsonPrimitive)?.takeIf { it.isString }?.content ?: throw WireException("a comment id")
    }

    /** The answer of [method] as JSON. */
    suspend fun view(
        method: String,
        args: JsonObject,
    ): JsonElement = Json.parseToJsonElement(transport.query(method, args.toString()))

    /** A list answer: `null` is none, anything but an array is not the contract's. */
    private fun rows(
        element: JsonElement,
        what: String,
    ): List<JsonElement> =
        when (element) {
            is JsonArray -> element
            is JsonNull -> emptyList()
            else -> throw WireException(what)
        }

    companion object {
        /** Every method this client calls: the ABI test checks each against `abi.json`. */
        val METHODS = listOf("listDocs", "getDoc", "searchDocs", "getDocument", "listComments", "addComment")
    }
}
