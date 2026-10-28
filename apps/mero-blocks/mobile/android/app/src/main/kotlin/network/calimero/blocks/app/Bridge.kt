package network.calimero.blocks.app

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put
import network.calimero.blocks.generated.BlockEntry
import network.calimero.blocks.generated.BlocksClient
import network.calimero.blocks.generated.Edit
import network.calimero.blocks.generated.PlayerView
import network.calimero.blocks.generated.Transform
import network.calimero.blocks.generated.WorldMeta

// The app half of the bridge between the game page (`../game/src/bridge.ts`) and the signed-in
// session. The page posts JSON text; the app answers by evaluating
// `window.meroBridge.receive("<JSON>")`. Same shapes as the Swift `Bridge.swift`.

enum class BridgeOp { QUERY, EXECUTE }

/** One message from the page. */
sealed interface BridgeRequest {
    /** A contract call. [argsJson] is the argument object as JSON text. */
    data class Call(
        val id: Int,
        val op: BridgeOp,
        val method: String,
        val argsJson: String,
    ) : BridgeRequest

    /** The page is listening: send `start`. */
    data object Ready : BridgeRequest

    /** The world is read and on screen. */
    data object Loaded : BridgeRequest

    /** The menu button was tapped. */
    data object Menu : BridgeRequest

    data class Haptic(
        val style: String,
    ) : BridgeRequest

    /** The world could not be opened. */
    data class Fatal(
        val message: String,
    ) : BridgeRequest
}

class BridgeException(
    message: String,
) : Exception(message) {
    companion object {
        fun malformed(detail: String) = BridgeException("Malformed bridge message: $detail")

        fun unknownMethod(method: String) = BridgeException("The game may not call $method.")

        fun wrongPath(
            method: String,
            expected: BridgeOp,
        ) = BridgeException("$method must go through ${expected.name.lowercase()}.")

        fun badArguments(
            method: String,
            detail: String,
        ) = BridgeException("Bad arguments for $method: $detail")
    }
}

/** What the app tells the page when it starts. (Swift `GameStart`.) */
data class GameStart(
    val contextId: String,
    /** "Me" as the contract keys players: this device's signing key, 64 hex. */
    val myId: String,
    val name: String,
    val worldName: String,
    val sensitivity: Double,
)

/** Safe-area insets in CSS pixels (dp), so the controls stay clear of the cutout. */
data class GameInsets(
    val top: Double,
    val left: Double,
    val bottom: Double,
    val right: Double,
) {
    companion object {
        val ZERO = GameInsets(0.0, 0.0, 0.0, 0.0)
    }
}

object BridgeCodec {
    private val json = Json

    /** Read one message from the page. */
    @Suppress("CyclomaticComplexMethod", "ThrowsCount")
    fun decode(text: String): BridgeRequest {
        val fields =
            runCatching { json.parseToJsonElement(text) }.getOrNull() as? JsonObject
                ?: throw BridgeException.malformed("not a JSON object")
        val op = fields.string("op") ?: throw BridgeException.malformed("no op")
        return when (op) {
            "query", "execute" -> {
                val id = (fields["id"] as? JsonPrimitive)?.intOrNull ?: throw BridgeException.malformed("no id")
                val method = fields.string("method")?.takeIf { it.isNotEmpty() } ?: throw BridgeException.malformed("no method")
                val args = fields["args"] ?: JsonObject(emptyMap())
                if (args !is JsonObject) throw BridgeException.malformed("args is not an object")
                BridgeRequest.Call(id, if (op == "query") BridgeOp.QUERY else BridgeOp.EXECUTE, method, args.toString())
            }
            "ready" -> BridgeRequest.Ready
            "loaded" -> BridgeRequest.Loaded
            "menu" -> BridgeRequest.Menu
            "haptic" -> BridgeRequest.Haptic(fields.string("style") ?: "light")
            "fatal" -> BridgeRequest.Fatal(fields.string("message") ?: "The world could not be opened.")
            else -> throw BridgeException.malformed("unknown op $op")
        }
    }

    /** A call's answer: [json] is the method's return value as JSON text. */
    fun result(
        id: Int,
        json: String,
    ): String = "{\"type\":\"result\",\"id\":$id,\"ok\":true,\"result\":${json.ifBlank { "null" }}}"

    fun failure(
        id: Int,
        message: String,
    ): String =
        buildJsonObject {
            put("error", message)
            put("id", id)
            put("ok", false)
            put("type", "result")
        }.toString()

    fun start(
        start: GameStart,
        insets: GameInsets,
    ): String =
        buildJsonObject {
            put("contextId", start.contextId)
            put("insets", insetsObject(insets))
            put("myId", start.myId)
            put("name", start.name)
            put("sensitivity", start.sensitivity)
            put("type", "start")
            put("worldName", start.worldName)
        }.toString()

    fun event(kind: String): String =
        buildJsonObject {
            put("kind", kind)
            put("type", "event")
        }.toString()

    const val PAUSE = "{\"type\":\"pause\"}"
    const val RESUME = "{\"type\":\"resume\"}"

    fun insets(insets: GameInsets): String = JsonObject(insetsObject(insets) + ("type" to JsonPrimitive("insets"))).toString()

    fun settings(sensitivity: Double): String =
        buildJsonObject {
            put("sensitivity", sensitivity)
            put("type", "settings")
        }.toString()

    /**
     * The JavaScript that hands [message] to the page: the JSON passed as a string literal, so
     * nothing in it is ever evaluated as code.
     */
    fun script(message: String): String = "window.meroBridge&&window.meroBridge.receive(${JsonPrimitive(message)});"

    private fun insetsObject(insets: GameInsets): JsonObject =
        buildJsonObject {
            put("bottom", insets.bottom)
            put("left", insets.left)
            put("right", insets.right)
            put("top", insets.top)
        }

    private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
}

/**
 * Runs the page's contract calls through the generated [BlocksClient]: only the methods the game
 * uses, each on its own path (views `query`, mutations `execute`), with typed arguments. `init` and
 * anything else are refused. (Swift `BridgeRouter`.)
 */
class BridgeRouter(
    private val client: BlocksClient,
) {
    @Serializable private data class NowArgs(
        val now: ULong,
    )

    @Serializable private data class JoinArgs(
        val name: String,
        val now: ULong,
    )

    @Serializable private data class HeartbeatArgs(
        val t: Transform,
        val now: ULong,
    )

    @Serializable private data class SetBlocksArgs(
        val edits: List<Edit>,
        val now: ULong,
    )

    /** The method's return value as JSON text. */
    @Suppress("ThrowsCount")
    suspend fun handle(
        op: BridgeOp,
        method: String,
        argsJson: String,
    ): String {
        val expected =
            when (method) {
                in VIEWS -> BridgeOp.QUERY
                in MUTATIONS -> BridgeOp.EXECUTE
                else -> throw BridgeException.unknownMethod(method)
            }
        if (op != expected) throw BridgeException.wrongPath(method, expected)

        fun <T> args(serializer: KSerializer<T>): T =
            try {
                json.decodeFromString(serializer, argsJson)
            } catch (e: SerializationException) {
                throw BridgeException.badArguments(method, e.message.orEmpty())
            } catch (e: IllegalArgumentException) {
                throw BridgeException.badArguments(method, e.message.orEmpty())
            }
        return when (method) {
            "world_meta" -> encode(WorldMeta.serializer(), client.worldMeta())
            "get_overrides" -> encode(ListSerializer(BlockEntry.serializer()), client.getOverrides())
            "override_count" -> encode(UInt.serializer(), client.overrideCount())
            "get_players" -> encode(ListSerializer(PlayerView.serializer()), client.getPlayers(args(NowArgs.serializer()).now))
            "join" -> args(JoinArgs.serializer()).let { encode(PlayerView.serializer(), client.join(it.name, it.now)) }
            "leave" -> client.leave(args(NowArgs.serializer()).now).let { NULL }
            "heartbeat" -> args(HeartbeatArgs.serializer()).let { client.heartbeat(it.t, it.now) }.let { NULL }
            "set_blocks" ->
                args(SetBlocksArgs.serializer()).let {
                    checkEdits(method, it.edits)
                    encode(UInt.serializer(), client.setBlocks(it.edits, it.now))
                }
            else -> throw BridgeException.unknownMethod(method)
        }
    }

    /** The contract stores any byte; the client only defines ids 0 to 15, and at most 512 a call. */
    private fun checkEdits(
        method: String,
        edits: List<Edit>,
    ) {
        if (edits.size > MAX_EDITS) throw BridgeException.badArguments(method, "more than $MAX_EDITS edits")
        if (edits.any { it.b > MAX_BLOCK_ID }) throw BridgeException.badArguments(method, "block id outside 0 to 15")
    }

    private fun <T> encode(
        serializer: KSerializer<T>,
        value: T,
    ): String = json.encodeToString(serializer, value)

    companion object {
        val VIEWS = setOf("world_meta", "get_overrides", "get_players", "override_count")
        val MUTATIONS = setOf("join", "leave", "heartbeat", "set_blocks")
        private const val NULL = "null"
        const val MAX_EDITS = 512
        const val MAX_BLOCK_ID = 15u
        private val json = Json { ignoreUnknownKeys = true }
    }
}
