package network.calimero.vote.core

import com.calimero.mero.testkit.InMemoryAppBackend
import com.calimero.mero.testkit.RecordedContractCall
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import network.calimero.vote.generated.Member
import network.calimero.vote.generated.Phase
import network.calimero.vote.generated.PollSummary
import network.calimero.vote.generated.Transcript
import java.io.File
import java.io.IOException

val ME = "ab".repeat(32)
val BOB = "b0".repeat(32)
val CTX = "cc".repeat(32)
val NS = "aa".repeat(32)

fun group(contextId: String = CTX) = GroupRef(NS, "Team", contextId)

fun summary(
    id: String,
    phase: Phase = Phase.Voting,
    createdAt: ULong = 1uL,
    title: String = "Poll $id",
) = PollSummary(id, title, ME, phase, createdAt, 0u)

fun member(
    account: String,
    name: String,
) = Member(account, name)

val testJson =
    Json {
        encodeDefaults = true
        ignoreUnknownKeys = true
    }

/** The web client's vectors (mobile/test-vectors/vectors.json). */
object Vectors {
    val root: JsonObject by lazy {
        val path = System.getProperty("vote.vectors") ?: "../../test-vectors/vectors.json"
        Json.parseToJsonElement(File(path).readText()).jsonObject
    }

    fun str(key: String): String = root[key]!!.jsonPrimitive.content

    val pollId get() = str("poll_id")
    val trustees get() = root["trustees"]!!.jsonArray.map { it.jsonPrimitive.content }

    fun audit(name: String): JsonObject = root["audits"]!!.jsonArray.map { it.jsonObject }.first { it["name"]!!.jsonPrimitive.content == name }

    fun transcript(name: String = "honest"): Transcript = testJson.decodeFromJsonElement(Transcript.serializer(), audit(name)["transcript"]!!)

    /**
     * The vector's transcript as the 1.0 contract answers it: its seal carries `aggregate`, which the
     * vectors predate (the audit recomputes it from the ballots, so its value does not matter here).
     */
    fun contractTranscript(name: String = "honest"): JsonObject {
        val transcript = audit(name)["transcript"]!!.jsonObject
        val state = transcript["state"]!!.jsonObject
        val closure = state["closure"] as? JsonObject ?: return transcript
        if ("aggregate" in closure) return transcript
        val sealed = JsonObject(closure + ("aggregate" to JsonArray(emptyList())))
        return JsonObject(transcript + ("state" to JsonObject(state + ("closure" to sealed))))
    }
}

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

fun makeBackend(account: String = ME): Pair<InMemoryAppBackend, Script> {
    val backend = InMemoryAppBackend(account = account)
    val script = Script()
    script.install(backend)
    return backend to script
}

fun RecordedContractCall.arg(key: String): JsonElement? = (args as? JsonObject)?.get(key)

fun RecordedContractCall.string(key: String): String? = (arg(key) as? JsonPrimitive)?.contentOrNull
