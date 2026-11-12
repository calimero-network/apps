package network.calimero.blocks.app

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import network.calimero.blocks.generated.BlocksClient

// The world contract (`../../logic`, `res/abi.json`), as the component runtime speaks it: camelCase
// methods, u64 values (`now`, `seed`, `createdAt`) as decimal strings, and the growing reads
// (`getOverrides`, `getPlayers`) paged at 1,000 rows. The calls are
// [network.calimero.blocks.generated.BlocksClient], generated from the ABI by core's `mero-app-build
// codegen` (`scripts/mobile-codegen.sh`); this file keeps the world's types and the paged reads.
// Same as the Swift `BlocksContract.swift`.

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

/** What the app keeps of the contract beside the generated [network.calimero.blocks.generated.BlocksClient]. */
object BlocksContract {
    /**
     * Every method this app calls, with its parameters in ABI order. Tests pin it to the component
     * ABI. `device` is left unset: one avatar per account (`PlayerView.id` = account).
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

    /**
     * The JSON the contract speaks. The ABI names the world's types (`WorldMeta`, `Edit`,
     * `PlayerView`, `Transform`, the pages) without their shape until the logic derives `AbiType`,
     * so the generated client takes and answers their JSON and the types above read it.
     */
    val JSON = Json { ignoreUnknownKeys = true }

    internal fun <T> rows(
        method: String,
        page: JsonElement,
        row: KSerializer<T>,
    ): Pair<List<T>, String?> {
        val o = page.jsonObject
        val items = JSON.decodeFromJsonElement(ListSerializer(row), o["items"] ?: throw SerializationException("$method: no items"))
        return items to (o["next"] as? JsonPrimitive)?.contentOrNull
    }
}

/** Every changed block, following the pages. */
suspend fun BlocksClient.allOverrides(): List<BlockEntry> = allPages("getOverrides", BlockEntry.serializer()) { getOverrides(cursor = it) }

/** Every player, online or not, following the pages. [now] is unix seconds. */
suspend fun BlocksClient.allPlayers(now: ULong): List<PlayerView> = allPages("getPlayers", PlayerView.serializer()) { getPlayers(now, cursor = it) }

private suspend fun <T> allPages(
    method: String,
    row: KSerializer<T>,
    page: suspend (String?) -> JsonElement,
): List<T> {
    val rows = mutableListOf<T>()
    var cursor: String? = null
    repeat(BlocksContract.MAX_PAGES) {
        val (items, next) = BlocksContract.rows(method, page(cursor), row)
        rows += items
        cursor = next ?: return rows
    }
    throw SerializationException("$method: more than ${BlocksContract.MAX_PAGES} pages")
}
