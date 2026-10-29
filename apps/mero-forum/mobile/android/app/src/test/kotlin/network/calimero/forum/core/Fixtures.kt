package network.calimero.forum.core

import com.calimero.mero.testkit.InMemoryAppBackend
import com.calimero.mero.testkit.RecordedContractCall
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.encodeToJsonElement
import network.calimero.forum.generated.CommentView
import network.calimero.forum.generated.PostView
import java.io.IOException

val ME = "ab".repeat(32)
val BOB = "b0".repeat(32)
val CTX = "cc".repeat(32)
val NS = "aa".repeat(32)

fun forumRef(contextId: String = CTX) = ForumRef(NS, "Design", "bb".repeat(32), "General", contextId)

fun post(
    id: String,
    author: String = BOB,
    name: String = "Bob",
    score: Long = 0,
    myVote: Int = 0,
    comments: ULong = 0u,
) = PostView(id, author, name, "Title $id", "Body $id", 1_761_000_000_000_000_000uL, 1_761_000_000_000_000_000uL, score, comments, myVote)

fun comment(
    id: String,
    author: String = BOB,
    score: Long = 0,
    myVote: Int = 0,
) = CommentView(id, "p1", author, "Bob", "Reply $id", 1_761_000_000_000_000_000uL, 1_761_000_000_000_000_000uL, score, myVote)

val testJson = Json { encodeDefaults = true }

/** A contract scripted per method; [fail] makes a method throw. */
class Script {
    private val answers = mutableMapOf<String, (RecordedContractCall) -> JsonElement>()
    private val failing = mutableSetOf<String>()

    inline fun <reified T> on(
        method: String,
        noinline answer: (RecordedContractCall) -> T,
    ) = put(method) { testJson.encodeToJsonElement(answer(it)) }

    fun put(
        method: String,
        answer: (RecordedContractCall) -> JsonElement,
    ) {
        synchronized(this) { answers[method] = answer }
    }

    fun fail(method: String) {
        synchronized(this) { failing += method }
    }

    fun install(backend: InMemoryAppBackend) {
        backend.recording.handler = { call ->
            val (fails, answer) = synchronized(this) { (call.method in failing) to answers[call.method] }
            if (fails) throw IOException("offline")
            answer?.invoke(call) ?: JsonNull
        }
    }
}

fun makeBackend(): Pair<InMemoryAppBackend, Script> {
    val backend = InMemoryAppBackend(account = ME)
    val script = Script()
    script.install(backend)
    return backend to script
}

fun RecordedContractCall.string(key: String): String? = ((args as? JsonObject)?.get(key) as? JsonPrimitive)?.contentOrNull
