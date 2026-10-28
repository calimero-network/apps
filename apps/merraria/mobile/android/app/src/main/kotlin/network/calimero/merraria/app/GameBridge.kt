package network.calimero.merraria.app

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import network.calimero.merraria.generated.Edit
import network.calimero.merraria.generated.MerrariaClient
import network.calimero.merraria.generated.PlayerView
import network.calimero.merraria.generated.TileEntry
import network.calimero.merraria.generated.Transform
import network.calimero.merraria.generated.WorldMeta

// The bridge between the app and the bundled web game (`app/src/native/host.ts`, which documents
// the protocol). Both directions are one JSON object per message. Same messages, same spelling as
// the iOS app's `GameBridge.swift`.

/** How the page asks for something: a contract view, a contract write, or its start-up config. */
enum class BridgeOp(
    val wire: String,
) {
    QUERY("query"),
    EXECUTE("execute"),
    CONFIG("config"),
    ;

    companion object {
        fun of(wire: String?): BridgeOp? = entries.firstOrNull { it.wire == wire }
    }
}

/** One hotbar slot as the game reports it. */
data class HudSlot(
    val id: Int,
    val name: String,
    /** `0xRRGGBB` */
    val color: Long,
    val count: Int,
)

/** The page to the app. */
sealed interface PageMessage {
    data class Request(
        val id: Int,
        val op: BridgeOp,
        val method: String,
        val argsJson: String,
    ) : PageMessage

    data class Hud(
        val selected: Int,
        val slots: List<HudSlot>,
    ) : PageMessage

    data object Connected : PageMessage

    data class Fatal(
        val message: String,
    ) : PageMessage

    data object Left : PageMessage

    companion object {
        private const val DEFAULT_COLOR = 0x888888L

        /** Decode a message posted by the page; null for anything malformed or unknown. */
        fun decode(text: String): PageMessage? {
            val obj = runCatching { Json.parseToJsonElement(text) as? JsonObject }.getOrNull() ?: return null
            return when (obj.string("type")) {
                "request" -> {
                    val id = (obj["id"] as? JsonPrimitive)?.intOrNull ?: return null
                    val op = BridgeOp.of(obj.string("op")) ?: return null
                    val method = obj.string("method").orEmpty()
                    if (op != BridgeOp.CONFIG && method.isEmpty()) return null
                    val args = obj["args"] as? JsonObject ?: JsonObject(emptyMap())
                    Request(id, op, method, args.toString())
                }
                "hud" -> {
                    val selected = (obj["sel"] as? JsonPrimitive)?.intOrNull ?: 0
                    val slots =
                        (obj["slots"] as? JsonArray).orEmpty().mapNotNull { element ->
                            val slot = element as? JsonObject ?: return@mapNotNull null
                            val id = (slot["id"] as? JsonPrimitive)?.intOrNull ?: return@mapNotNull null
                            val name = slot.string("name") ?: return@mapNotNull null
                            HudSlot(id, name, parseColor(slot.string("color")), (slot["count"] as? JsonPrimitive)?.intOrNull ?: 0)
                        }
                    Hud(selected, slots)
                }
                "status" -> if (obj.string("state") == "connected") Connected else null
                "fatal" -> Fatal(obj.string("message") ?: "The game stopped.")
                "left" -> Left
                else -> null
            }
        }

        fun parseColor(text: String?): Long = text?.removePrefix("#")?.toLongOrNull(16) ?: DEFAULT_COLOR

        private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
    }
}

/** What the on-screen controls hold down, as the game reads it. */
data class GameInput(
    /** -1 left, 0 still, 1 right. */
    val move: Int = 0,
    val jump: Boolean = false,
    /** The jump button went down since the last message (a jump is an edge, not a level). */
    val jumpPressed: Boolean = false,
    val mine: Boolean = false,
    val place: Boolean = false,
) {
    companion object {
        val IDLE = GameInput()
    }
}

/** Why a request failed, in words the page shows (and matches "world not ready yet" on). */
class BridgeFailure(
    message: String,
) : Exception(message) {
    override fun equals(other: Any?): Boolean = other is BridgeFailure && other.message == message

    override fun hashCode(): Int = message.hashCode()
}

/** The app to the page. */
sealed interface AppMessage {
    /** A request's answer: [value] is JSON text, or [error] the reason it failed. */
    data class Response(
        val id: Int,
        val value: String? = null,
        val error: String? = null,
    ) : AppMessage

    data class Event(
        val kind: String,
    ) : AppMessage

    data class Input(
        val input: GameInput,
    ) : AppMessage

    /** A tap on the game, in CSS pixels. */
    data class Target(
        val x: Double,
        val y: Double,
    ) : AppMessage

    data class Select(
        val slot: Int,
    ) : AppMessage

    data class Zoom(
        val value: Double,
    ) : AppMessage

    data object Pause : AppMessage

    data object Leave : AppMessage

    /** The message as JSON. */
    val json: String
        get() =
            when (this) {
                is Response ->
                    if (error == null) {
                        """{"type":"response","id":$id,"ok":true,"value":${checkedJson(value.orEmpty())}}"""
                    } else {
                        """{"type":"response","id":$id,"ok":false,"error":${string(error)}}"""
                    }
                is Event -> """{"type":"event","kind":${string(kind)}}"""
                is Input ->
                    """{"type":"input","move":${input.move},"jump":${input.jump},"jumpPressed":${input.jumpPressed},""" +
                        """"mine":${input.mine},"place":${input.place}}"""
                is Target -> """{"type":"target","x":${number(x)},"y":${number(y)}}"""
                is Select -> """{"type":"select","slot":$slot}"""
                is Zoom -> """{"type":"zoom","value":${number(value)}}"""
                Pause -> """{"type":"pause"}"""
                Leave -> """{"type":"leave"}"""
            }

    /** The script that delivers it to the page. */
    val script: String get() = "window.meroBridge && window.meroBridge.receive($json);"

    companion object {
        private const val WHOLE_LIMIT = 1e15

        fun string(text: String): String = JsonPrimitive(text).toString()

        fun number(value: Double): String =
            when {
                !value.isFinite() -> "0"
                value == Math.rint(value) && kotlin.math.abs(value) < WHOLE_LIMIT -> value.toLong().toString()
                else -> value.toString()
            }

        /** JSON text as it is, or as a string when it is not JSON; `null` when empty. */
        fun checkedJson(text: String): String {
            val trimmed = text.trim()
            if (trimmed.isEmpty()) return "null"
            return if (runCatching { Json.parseToJsonElement(trimmed) }.isSuccess) trimmed else string(trimmed)
        }

        fun success(
            id: Int,
            value: String,
        ) = Response(id, value = value)

        fun failure(
            id: Int,
            message: String,
        ) = Response(id, error = message)
    }
}

/** The page's start-up config: the world, the player's name and zoom. */
data class GameConfig(
    val contextId: String,
    val name: String,
    val zoom: Double,
) {
    val json: String
        get() = """{"contextId":${AppMessage.string(contextId)},"name":${AppMessage.string(name)},"zoom":${AppMessage.number(zoom)}}"""
}

/**
 * Answers the page's contract calls with the generated client, method by method: only the
 * contract's own methods, each by its own kind (a view as `query`, a write as `execute`), with its
 * arguments decoded into the contract's types. `init` is not the page's to call. (Swift `BridgeDispatcher`.)
 */
class BridgeDispatcher(
    private val client: MerrariaClient,
) {
    /** The method's JSON result. */
    suspend fun run(
        op: BridgeOp,
        method: String,
        argsJson: String,
    ): String {
        val isView = method in VIEWS
        if (!isView && method !in WRITES) throw BridgeFailure("$method is not a Merraria method the game may call")
        val expected = if (isView) BridgeOp.QUERY else BridgeOp.EXECUTE
        if (op != expected) {
            throw BridgeFailure("$method is a ${if (isView) "view" else "write"}: send it with ${expected.wire}")
        }
        return when (method) {
            "get_overrides" -> encode(ListSerializer(TileEntry.serializer()), client.getOverrides())
            "get_players" -> encode(ListSerializer(PlayerView.serializer()), client.getPlayers(decode(NowArgs.serializer(), argsJson).now))
            "world_meta" -> encode(WorldMeta.serializer(), client.worldMeta())
            "heartbeat" -> {
                val args = decode(HeartbeatArgs.serializer(), argsJson)
                client.heartbeat(args.t, args.now)
                "null"
            }
            "join" -> {
                val args = decode(JoinArgs.serializer(), argsJson)
                encode(PlayerView.serializer(), client.join(args.name, args.now))
            }
            "leave" -> {
                client.leave(decode(NowArgs.serializer(), argsJson).now)
                "null"
            }
            else -> {
                val args = decode(SetTilesArgs.serializer(), argsJson)
                encode(UInt.serializer(), client.setTiles(args.edits, args.now))
            }
        }
    }

    @Serializable
    private data class NowArgs(
        val now: ULong,
    )

    @Serializable
    private data class HeartbeatArgs(
        val t: Transform,
        val now: ULong,
    )

    @Serializable
    private data class JoinArgs(
        val name: String,
        val now: ULong,
    )

    @Serializable
    private data class SetTilesArgs(
        val edits: List<Edit>,
        val now: ULong,
    )

    private fun <T> decode(
        serializer: KSerializer<T>,
        json: String,
    ): T =
        try {
            JSON.decodeFromString(serializer, json)
        } catch (e: IllegalArgumentException) {
            throw BridgeFailure("bad arguments: ${e.message}")
        }

    private fun <T> encode(
        serializer: KSerializer<T>,
        value: T,
    ): String = JSON.encodeToString(serializer, value)

    companion object {
        val VIEWS = setOf("get_overrides", "get_players", "world_meta")
        val WRITES = setOf("heartbeat", "join", "leave", "set_tiles")
        private val JSON = Json { ignoreUnknownKeys = true }
    }
}
