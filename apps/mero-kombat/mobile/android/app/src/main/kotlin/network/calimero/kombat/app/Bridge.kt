package network.calimero.kombat.app

import kotlinx.coroutines.CancellationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import network.calimero.kombat.generated.ArenaView
import network.calimero.kombat.generated.KombatClient
import network.calimero.kombat.generated.MatchSummary

/** The game page's mode: the web engine's `Mode`. (Swift `GameMode`.) */
enum class GameMode(
    val wire: String,
) {
    /** Practice against the CPU: no contract, no presence. */
    CPU("cpu"),

    /** A real fight: this phone plays one corner. */
    NET("net"),

    /** Both corners are someone else. */
    SPECTATE("spectate"),
}

/** A message from the game page (`web/src/protocol.ts`, `ToNative`). (Swift `BridgeInbound`.) */
sealed class BridgeInbound {
    enum class CallKind { QUERY, EXECUTE }

    /** The page has loaded and listens: send it `boot` (and the latest state). */
    data object Ready : BridgeInbound()

    /** `window.meroBridge.query/execute(method, args)`; answer with [BridgeOutbound.Result]. */
    data class Call(
        val id: Int,
        val kind: CallKind,
        val method: String,
        val argsJson: String,
    ) : BridgeInbound()

    /** This fighter's presence slice, as JSON text: published as is. */
    data class Presence(
        val sliceJson: String,
    ) : BridgeInbound()

    /** Practice: the match ended (or restarted). */
    data class Over(
        val over: Boolean,
    ) : BridgeInbound()

    companion object {
        /** Decode one posted message; null for anything that is not a version-1 message this app knows. */
        fun decode(body: String): BridgeInbound? {
            val fields = runCatching { Json.parseToJsonElement(body) as? JsonObject }.getOrNull() ?: return null
            if ((fields["v"] as? JsonPrimitive)?.intOrNull != 1) return null
            return when ((fields["op"] as? JsonPrimitive)?.contentOrNull) {
                "ready" -> Ready
                "query", "execute" -> {
                    val id = (fields["id"] as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull ?: return null
                    val method = (fields["method"] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
                    if (method.isNullOrEmpty()) return null
                    val args = fields["args"]?.let { canonical(it).toString() } ?: "{}"
                    val kind = if (fields["op"] == JsonPrimitive("query")) CallKind.QUERY else CallKind.EXECUTE
                    Call(id, kind, method, args)
                }
                "presence" -> (fields["slice"] as? JsonObject)?.let { Presence(canonical(it).toString()) }
                "over" -> (fields["over"] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull?.let { Over(it) }
                else -> null
            }
        }

        /** Keys sorted at every level, as the iOS app's `JSONSerialization(.sortedKeys)` writes them. */
        private fun canonical(element: JsonElement): JsonElement =
            when (element) {
                is JsonObject -> JsonObject(element.toSortedMap().mapValues { canonical(it.value) })
                is JsonArray -> JsonArray(element.map { canonical(it) })
                else -> element
            }
    }
}

/** A message to the game page (`ToPage`), delivered as [script]. (Swift `BridgeOutbound`.) */
sealed class BridgeOutbound {
    data class Boot(
        val mode: GameMode,
        val local: Int?,
        val fighters: List<String>,
        val muted: Boolean,
    ) : BridgeOutbound()

    /** The contract's latest `arena()` read, as the generated client serialises `ArenaView`. */
    data class State(
        val viewJson: String,
    ) : BridgeOutbound()

    /** The opponent's presence slice, as it arrived. */
    data class Slice(
        val sliceJson: String,
    ) : BridgeOutbound()

    data class Press(
        val button: PadButton,
        val down: Boolean,
    ) : BridgeOutbound()

    data class Result(
        val id: Int,
        val valueJson: String,
    ) : BridgeOutbound()

    data class Failure(
        val id: Int,
        val message: String,
    ) : BridgeOutbound()

    data object Pause : BridgeOutbound()

    data object Resume : BridgeOutbound()

    data object Restart : BridgeOutbound()

    data class Mute(
        val on: Boolean,
    ) : BridgeOutbound()

    /** The message as JSON text. */
    val json: String
        get() =
            when (this) {
                is Boot -> {
                    val pair = fighters.joinToString(",") { string(it) }
                    """{"t":"boot","mode":"${mode.wire}","local":${local ?: "null"},"fighters":[$pair],"muted":$muted}"""
                }
                is State -> """{"t":"state","view":$viewJson}"""
                is Slice -> """{"t":"slice","slice":$sliceJson}"""
                is Press -> """{"t":"press","b":"${button.wire}","d":$down}"""
                is Result -> """{"t":"result","id":$id,"ok":true,"value":$valueJson}"""
                is Failure -> """{"t":"result","id":$id,"ok":false,"error":${string(message)}}"""
                Pause -> """{"t":"pause"}"""
                Resume -> """{"t":"resume"}"""
                Restart -> """{"t":"restart"}"""
                is Mute -> """{"t":"mute","on":$on}"""
            }

    /** The JavaScript that delivers it; a no-op until the page has defined `meroGame`. */
    val script: String get() = "window.meroGame&&window.meroGame.receive($json);"

    companion object {
        /** A JSON string literal. */
        fun string(text: String): String = JsonPrimitive(text).toString()
    }
}

/**
 * Where the game page's contract calls go: the generated client, method by method. Only what the
 * engine calls is open to it (`act`, and the two reads); anything else is refused, so a page can
 * never sit, stand or rematch on the player's behalf. (Swift `GameCalls`.)
 */
class GameCalls(
    private val client: KombatClient,
) {
    /** The `act` arguments as the web engine sends them (the ABI's snake_case). */
    @Serializable
    @Suppress("ConstructorParameterNaming")
    private data class ActArgs(
        val match_index: UInt,
        val round: UInt,
        val id: UInt,
        val kind: String,
        val hit: Boolean,
        val blocked: Boolean,
        val now: ULong? = null,
    )

    @Serializable
    private data class ArenaArgs(
        val now: ULong? = null,
    )

    /** Answer one `call`: a [BridgeOutbound.Result] with the method's return value, or a [BridgeOutbound.Failure]. */
    suspend fun handle(
        id: Int,
        kind: BridgeInbound.CallKind,
        method: String,
        argsJson: String,
    ): BridgeOutbound =
        try {
            when {
                kind == BridgeInbound.CallKind.EXECUTE && method == "act" -> {
                    val a = JSON.decodeFromString(ActArgs.serializer(), argsJson)
                    client.act(a.match_index, a.round, a.id, a.kind, a.hit, a.blocked, a.now ?: nowMillis())
                    BridgeOutbound.Result(id, "null")
                }
                kind == BridgeInbound.CallKind.QUERY && method == "arena" -> {
                    val a = runCatching { JSON.decodeFromString(ArenaArgs.serializer(), argsJson) }.getOrNull()
                    BridgeOutbound.Result(id, encode(client.arena(a?.now ?: nowMillis())))
                }
                kind == BridgeInbound.CallKind.QUERY && method == "history" ->
                    BridgeOutbound.Result(id, JSON.encodeToString(ListSerializer(MatchSummary.serializer()), client.history()))
                else -> BridgeOutbound.Failure(id, "$method is not open to the game page")
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            BridgeOutbound.Failure(id, KombatText.error(e))
        }

    companion object {
        private val JSON = Json { ignoreUnknownKeys = true }

        /** An `ArenaView` as the page reads it (the ABI's field names). */
        fun encode(view: ArenaView): String = JSON.encodeToString(ArenaView.serializer(), view)
    }
}
