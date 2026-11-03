package network.calimero.blocks.app

import com.calimero.mero.app.ContextContractCalling
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

// The world contract (`../../logic`, `res/abi.json`), as the component runtime speaks it: camelCase
// methods, u64 values (`now`, `seed`, `createdAt`) as decimal strings, and the growing reads
// (`getOverrides`, `getPlayers`) paged at 1,000 rows. Hand-written: no client is generated from a
// component ABI yet. Same types and calls as the Swift `BlocksClient`.

/** One block change: world coordinates and the block id (0 = air). */
@Serializable
data class Edit(
    val x: Int,
    val y: Int,
    val z: Int,
    val b: UInt,
)

/** A player's pose and name, as `heartbeat` sends it. */
@Serializable
data class Transform(
    val name: String,
    val x: Double,
    val y: Double,
    val z: Double,
    val yaw: Double,
    val pitch: Double,
    val sel: UInt,
)

/** One changed block: `k` is `"x,y,z"`. */
@Serializable
data class BlockEntry(
    val k: String,
    val b: UInt,
)

/** A player as `getPlayers` and `join` answer. `id` is the account, or `"<account>/<device>"`. */
@Serializable
data class PlayerView(
    val id: String,
    val account: String = "",
    val device: String = "",
    val name: String = "",
    val x: Double,
    val y: Double,
    val z: Double,
    val yaw: Double,
    val pitch: Double,
    val sel: UInt,
    val online: Boolean,
)

/**
 * The world's identity. On the wire `seed` and `createdAt` are decimal strings; this type encodes
 * them as numbers, the shape the game page reads.
 */
@Serializable
data class WorldMeta(
    val name: String,
    /** Terrain seed; clients generate identical terrain from it. */
    val seed: ULong,
    /** Unix seconds; the day/night cycle is counted from here. */
    val createdAt: ULong,
) {
    companion object {
        /** From the component wire (u64 as decimal strings), or a number from elsewhere. */
        fun fromWire(value: JsonElement): WorldMeta {
            val o = value as? JsonObject ?: throw SerializationException("worldMeta answered $value")

            fun u64(key: String): ULong {
                val text = (o[key] as? JsonPrimitive)?.contentOrNull ?: return 0uL
                return text.toULongOrNull() ?: throw SerializationException("$key is not a u64: $text")
            }
            return WorldMeta((o["name"] as? JsonPrimitive)?.contentOrNull.orEmpty(), u64("seed"), u64("createdAt"))
        }
    }
}

/** The world contract, bound to one world's app instance. */
class BlocksClient(
    private val transport: ContextContractCalling,
) {
    suspend fun worldMeta(): WorldMeta = WorldMeta.fromWire(Json.parseToJsonElement(transport.query("worldMeta", "{}")))

    /** Every changed block, following the pages. */
    suspend fun getOverrides(): List<BlockEntry> = allPages("getOverrides", JsonObject(emptyMap()), BlockEntry.serializer())

    /** Every player, online or not, following the pages. [now] is unix seconds. */
    suspend fun getPlayers(now: ULong): List<PlayerView> =
        allPages("getPlayers", buildJsonObject { put("now", now.toString()) }, PlayerView.serializer())

    suspend fun overrideCount(): UInt = json.decodeFromString(UInt.serializer(), transport.query("overrideCount", "{}"))

    suspend fun join(
        name: String,
        now: ULong,
    ): PlayerView =
        json.decodeFromString(
            PlayerView.serializer(),
            transport.execute(
                "join",
                buildJsonObject {
                    put("name", name)
                    put("now", now.toString())
                }.toString(),
            ),
        )

    suspend fun heartbeat(
        t: Transform,
        now: ULong,
    ) {
        transport.execute(
            "heartbeat",
            buildJsonObject {
                put("t", json.encodeToJsonElement(Transform.serializer(), t))
                put("now", now.toString())
            }.toString(),
        )
    }

    suspend fun leave(now: ULong) {
        transport.execute("leave", buildJsonObject { put("now", now.toString()) }.toString())
    }

    /** How many of [edits] changed a block. */
    suspend fun setBlocks(
        edits: List<Edit>,
        now: ULong,
    ): UInt =
        json.decodeFromString(
            UInt.serializer(),
            transport.execute(
                "setBlocks",
                buildJsonObject {
                    put("edits", json.encodeToJsonElement(ListSerializer(Edit.serializer()), edits))
                    put("now", now.toString())
                }.toString(),
            ),
        )

    private suspend fun <T> allPages(
        method: String,
        args: JsonObject,
        row: KSerializer<T>,
    ): List<T> {
        val rows = mutableListOf<T>()
        var cursor: String? = null
        repeat(MAX_PAGES) {
            val a = if (cursor == null) args else JsonObject(args + ("cursor" to JsonPrimitive(cursor)))
            val page = Json.parseToJsonElement(transport.query(method, a.toString())).jsonObject
            rows += json.decodeFromJsonElement(ListSerializer(row), page["items"] ?: throw SerializationException("$method: no items"))
            cursor = (page["next"] as? JsonPrimitive)?.contentOrNull ?: return rows
        }
        throw SerializationException("$method: more than $MAX_PAGES pages")
    }

    companion object {
        /**
         * Every method this client calls, with its parameters in ABI order. Tests pin it to the
         * component ABI. `device` is left out: one avatar per account (`PlayerView.id` = account).
         */
        val METHODS: Map<String, List<String>> =
            mapOf(
                "worldMeta" to emptyList(),
                "getOverrides" to listOf("cursor", "limit"),
                "getPlayers" to listOf("now", "cursor", "limit"),
                "overrideCount" to emptyList(),
                "join" to listOf("name", "now", "device"),
                "heartbeat" to listOf("t", "now", "device"),
                "leave" to listOf("now", "device"),
                "setBlocks" to listOf("edits", "now", "device"),
            )

        /** Pages a read follows at most: 1,000 rows each, so ~1M rows (a world full of edits). */
        const val MAX_PAGES = 1_100
        private val json = Json { ignoreUnknownKeys = true }
    }
}
