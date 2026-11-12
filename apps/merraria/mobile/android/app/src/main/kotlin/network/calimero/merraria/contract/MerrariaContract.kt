package network.calimero.merraria.contract

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.serializer
import network.calimero.merraria.generated.MerrariaClient

// The world contract's component ABI (`logic/res/abi.json`). The calls are
// [network.calimero.merraria.generated.MerrariaClient], generated from it by core's `mero-app-build
// codegen` (`scripts/mobile-codegen.sh`); this file keeps the method lists `ContractTest` checks
// against the ABI, the paging of `getOverrides`, the world's types and the refusal sentences of the
// web app's `app/src/net/merraria.ts`. (Swift `Contract/MerrariaContract.swift`.)
//
// Wire format (component ABI):
// - method names are camelCase (`worldMeta`, `setTiles`, `getOverrides`, `getPlayers`);
// - `seed`, `createdAt` and every `now` are u32 seconds: plain JSON numbers;
// - `init()` takes nothing; the creator then calls `createWorld(name, seed, now)` once;
// - `getOverrides` answers one page (`{items, next}`), at most 1,000 entries;
// - a refusal is `422 APP_ERROR {code, fields}` (`NoWorld`, `WorldExists`, `WorldFull`,
//   `TooManyEdits`), an `AppError` (see [MerrariaRefusal]).

/** What the app keeps of the contract beside the generated [network.calimero.merraria.generated.MerrariaClient]. */
object MerrariaContract {
    /** The contract's calls (writes), by their ABI names. */
    val CALLS = listOf("createWorld", "heartbeat", "join", "leave", "setTiles")

    /** The contract's views (reads), by their ABI names. */
    val VIEWS = listOf("getOverrides", "getPlayers", "worldMeta")

    /** The JSON the contract speaks. */
    val JSON = Json { ignoreUnknownKeys = true }

    /** [answer], an answer of the generated client, read as the app type [serializer] describes. */
    fun <T> read(
        serializer: KSerializer<T>,
        answer: Any,
    ): T = JSON.decodeFromJsonElement(serializer, answer.asContractJson())
}

/** Every override, page after page until `next` is null (the web app's `readAllOverrides`). */
suspend fun MerrariaClient.allOverrides(): List<TileEntry> {
    val all = mutableListOf<TileEntry>()
    var cursor: String? = null
    do {
        val page = MerrariaContract.read(OverridesPage.serializer(), getOverrides(cursor))
        all += page.items
        cursor = page.next
    } while (cursor != null)
    return all
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

/** A value of the generated client (a typed record, or the JSON of a type the ABI does not describe) as its JSON. */
fun Any.asContractJson(): JsonElement = this as? JsonElement ?: contractArgJson.encodeToJsonElement(serializer(javaClass), this)

/** [this] (an app type) as the generated client's type [R] (an argument), through its JSON. */
inline fun <reified R> Any.asContractArg(): R = contractArgJson.decodeFromJsonElement(serializer<R>(), asContractJson())

/** The JSON between the app's types and the generated client's: every default written, unknown keys and missing options tolerated. */
val contractArgJson =
    Json {
        encodeDefaults = true
        ignoreUnknownKeys = true
        explicitNulls = false
    }
