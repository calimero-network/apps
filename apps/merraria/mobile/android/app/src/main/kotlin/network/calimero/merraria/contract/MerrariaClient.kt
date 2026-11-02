package network.calimero.merraria.contract

import com.calimero.mero.app.ContextContractCalling
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put

// The world contract's component ABI (`logic/res/abi.json`, `calimero:app@0.5.0`), typed by hand:
// no Kotlin client is generated from a component ABI yet. It mirrors the web app's
// `app/src/net/merraria.ts`, and `ContractTest` checks the method lists against the committed ABI.
// (Swift `MerrariaClient`.)
//
// Wire format (component ABI):
// - method names are camelCase (`worldMeta`, `setTiles`, `getOverrides`, `getPlayers`);
// - `seed`, `createdAt` and every `now` are u32 seconds: plain JSON numbers;
// - `init()` takes nothing; the creator then calls `createWorld(name, seed, now)` once;
// - `getOverrides` answers one page (`{items, next}`), at most 1,000 entries;
// - a refusal is `422 APP_ERROR {code, fields}` (`NoWorld`, `WorldExists`, `WorldFull`,
//   `TooManyEdits`), an `AppError` (see [MerrariaRefusal]).

/** Typed calls to a world. Views go through `query` (`POST /apps/{app}/views`), calls through `execute` (an intent). */
class MerrariaClient(
    private val transport: ContextContractCalling,
) {
    /** Found the world: its name and seed. Only the instance's owner, once. */
    suspend fun createWorld(
        name: String,
        seed: UInt,
        now: UInt,
    ) {
        transport.execute("createWorld", JSON.encodeToString(CreateWorldArgs.serializer(), CreateWorldArgs(name, seed, now)))
    }

    /** The world's name, seed and day-clock anchor. */
    suspend fun worldMeta(): WorldMeta = JSON.decodeFromString(WorldMeta.serializer(), transport.query("worldMeta", "{}"))

    /** Write tile edits; answers how many were applied. */
    suspend fun setTiles(
        edits: List<Edit>,
        now: UInt,
    ): UInt = JSON.decodeFromString(UInt.serializer(), transport.execute("setTiles", JSON.encodeToString(SetTilesArgs.serializer(), SetTilesArgs(edits, now))))

    /** One page of overrides, from [cursor] (null for the first). Absent keys, never nulls: the contract refuses those. */
    suspend fun getOverrides(
        cursor: String? = null,
        limit: UInt? = null,
    ): OverridesPage {
        val args =
            buildJsonObject {
                cursor?.let { put("cursor", it) }
                limit?.let { put("limit", it.toLong()) }
            }
        return JSON.decodeFromString(OverridesPage.serializer(), transport.query("getOverrides", args.toString()))
    }

    /** Every override, page after page until `next` is null (the web app's `readAllOverrides`). */
    suspend fun allOverrides(): List<TileEntry> {
        val all = mutableListOf<TileEntry>()
        var cursor: String? = null
        do {
            val page = getOverrides(cursor)
            all += page.items
            cursor = page.next
        } while (cursor != null)
        return all
    }

    /** Enter the world (or come back); answers this account's avatar. */
    suspend fun join(
        name: String,
        now: UInt,
    ): PlayerView = JSON.decodeFromString(PlayerView.serializer(), transport.execute("join", JSON.encodeToString(JoinArgs.serializer(), JoinArgs(name, now))))

    /** This account's avatar, moved. */
    suspend fun heartbeat(
        t: Transform,
        now: UInt,
    ) {
        transport.execute("heartbeat", JSON.encodeToString(HeartbeatArgs.serializer(), HeartbeatArgs(t, now)))
    }

    /** Leave the world. */
    suspend fun leave(now: UInt) {
        transport.execute("leave", JSON.encodeToString(NowArgs.serializer(), NowArgs(now)))
    }

    /** Everyone in the world, at most 1,000. */
    suspend fun getPlayers(now: UInt): List<PlayerView> =
        JSON.decodeFromString(ListSerializer(PlayerView.serializer()), transport.query("getPlayers", JSON.encodeToString(NowArgs.serializer(), NowArgs(now))))

    @Serializable
    private data class NowArgs(
        val now: UInt,
    )

    @Serializable
    private data class CreateWorldArgs(
        val name: String,
        val seed: UInt,
        val now: UInt,
    )

    @Serializable
    private data class SetTilesArgs(
        val edits: List<Edit>,
        val now: UInt,
    )

    @Serializable
    private data class JoinArgs(
        val name: String,
        val now: UInt,
    )

    @Serializable
    private data class HeartbeatArgs(
        val t: Transform,
        val now: UInt,
    )

    companion object {
        /** The contract's calls (writes), by their ABI names. */
        val CALLS = listOf("createWorld", "heartbeat", "join", "leave", "setTiles")

        /** The contract's views (reads), by their ABI names. */
        val VIEWS = listOf("getOverrides", "getPlayers", "worldMeta")

        /** The JSON the contract speaks. */
        val JSON = Json { ignoreUnknownKeys = true }
    }
}

/** The world's name, seed and day-clock anchor (seconds). */
@Serializable
data class WorldMeta(
    val name: String,
    val seed: UInt,
    val createdAt: UInt,
)

/** One tile edit: `t` is the tile id (0 = air, dug out). */
@Serializable
data class Edit(
    val x: Int,
    val y: Int,
    val t: UInt,
)

/** One override: `k` is `"x,y"`. */
@Serializable
data class TileEntry(
    val k: String,
    val t: UInt,
)

/** One page of `getOverrides`: [next] is null on the last page. */
@Serializable
data class OverridesPage(
    val items: List<TileEntry>,
    val next: String? = null,
)

/** Where an avatar is and what it does. */
@Serializable
data class Transform(
    val name: String,
    val x: Double,
    val y: Double,
    /** Facing: -1 or 1. */
    val dir: Double,
    val sel: UInt,
    val action: String,
)

/** One avatar: [id] is its account. */
@Serializable
data class PlayerView(
    val id: String,
    val name: String,
    val x: Double,
    val y: Double,
    val dir: Double,
    val sel: UInt,
    val action: String,
    val online: Boolean,
)

/** The contract's refusals (`#[app::error]`) in words. (Swift `MerrariaRefusal`.) */
object MerrariaRefusal {
    /** The sentence for an `APP_ERROR` code (with its [fields]), or null for a code the contract does not declare. */
    fun message(
        code: String,
        fields: JsonObject = JsonObject(emptyMap()),
    ): String? {
        val max = (fields["max"] as? JsonPrimitive)?.intOrNull
        return when (code) {
            "NoWorld" -> "This world is still being created. Try again in a moment."
            "WorldExists" -> "This world was already created."
            "WorldFull" -> "This world is full${max?.let { " ($it players)" }.orEmpty()}. Try another world."
            "TooManyEdits" -> "Too many tile changes at once${max?.let { " (at most $it)" }.orEmpty()}. Try again."
            else -> null
        }
    }
}
