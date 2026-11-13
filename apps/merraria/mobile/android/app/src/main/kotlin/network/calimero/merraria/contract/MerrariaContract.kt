package network.calimero.merraria.contract

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull
import network.calimero.merraria.generated.MerrariaClient

// The world contract's component ABI (`logic/res/abi.json`). The calls are [MerrariaClient],
// generated from it by core's `meroctl app codegen` (`scripts/mobile-codegen.sh`); this file
// keeps the method lists `ContractTest` checks against the ABI, the paging of `getOverrides` and
// the refusal sentences of the web app's `app/src/net/merraria.ts`; the world's types are the
// generated ones. (Swift `Contract/MerrariaContract.swift`.)
//
// Wire format (component ABI):
// - method names are camelCase (`worldMeta`, `setTiles`, `getOverrides`, `getPlayers`);
// - `seed`, `createdAt` and every `now` are u32 seconds: plain JSON numbers;
// - `init()` takes nothing; the creator then calls `createWorld(name, seed, now)` once;
// - `getOverrides` answers one page (`{items, next}`), at most 1,000 entries;
// - a refusal is `422 APP_ERROR {code, fields}` (`NoWorld`, `WorldExists`, `WorldFull`,
//   `TooManyEdits`), an `AppError` (see [MerrariaRefusal]).

/** What the app keeps of the contract beside the generated [MerrariaClient]. */
object MerrariaContract {
    /** The contract's calls (writes), by their ABI names. */
    val CALLS = listOf("createWorld", "heartbeat", "join", "leave", "setTiles")

    /** The contract's views (reads), by their ABI names. */
    val VIEWS = listOf("getOverrides", "getPlayers", "worldMeta")
}

/** Every override, page after page until `next` is null (the web app's `readAllOverrides`). */
suspend fun MerrariaClient.allOverrides(): List<TileEntry> {
    val all = mutableListOf<TileEntry>()
    var cursor: String? = null
    do {
        val page = getOverrides(cursor)
        all += page.items
        cursor = page.next
    } while (cursor != null)
    return all
}

// The world's types are the generated client's ([MerrariaClient], from the ABI).

/** The world's name, seed and day-clock anchor (seconds). */
typealias WorldMeta = MerrariaClient.WorldMeta

/** One tile edit: `t` is the tile id (0 = air, dug out). */
typealias Edit = MerrariaClient.Edit

/** One override: `k` is `"x,y"`. */
typealias TileEntry = MerrariaClient.TileEntry

/** One page of `getOverrides`: `next` is null on the last page. */
typealias OverridesPage = MerrariaClient.OverridesPage

/** Where an avatar is and what it does (`dir`, facing: -1 or 1). */
typealias Transform = MerrariaClient.Transform

/** One avatar: `id` is its account. */
typealias PlayerView = MerrariaClient.PlayerView

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
