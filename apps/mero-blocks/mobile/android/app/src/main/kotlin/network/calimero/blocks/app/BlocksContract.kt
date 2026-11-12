package network.calimero.blocks.app

import kotlinx.serialization.SerializationException
import network.calimero.blocks.generated.BlocksClient

// The world contract (`../../logic`, `res/abi.json`), as the component runtime speaks it: camelCase
// methods, u64 values (`now`, `seed`, `createdAt`) as decimal strings, and the growing reads
// (`getOverrides`, `getPlayers`) paged at 1,000 rows. The calls are [BlocksClient], generated from
// the ABI by core's `mero-app-build codegen` (`scripts/mobile-codegen.sh`); this file keeps the paged
// reads (the world's types are the generated ones). Same as the Swift `BlocksContract.swift`.

// The world's types are the generated client's ([BlocksClient], from the ABI).

/** One block change: world coordinates and the block id (0 = air). */
typealias Edit = BlocksClient.Edit

/** A player's pose and name, as `heartbeat` sends it. */
typealias Transform = BlocksClient.Transform

/** One changed block: `k` is `"x,y,z"`. */
typealias BlockEntry = BlocksClient.BlockEntry

/** A player as `getPlayers` and `join` answer. `id` is the account, or `"<account>/<device>"`. */
typealias PlayerView = BlocksClient.PlayerView

/**
 * The world's identity: terrain `seed` (clients generate identical terrain from it) and `createdAt`
 * (unix seconds; the day/night cycle is counted from here). Decimal strings on the wire; the game
 * page reads them as numbers ([BridgeRouter]).
 */
typealias WorldMeta = BlocksClient.WorldMeta

/** What the app keeps of the contract beside the generated [BlocksClient]. */
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
}

/** Every changed block, following the pages. */
suspend fun BlocksClient.allOverrides(): List<BlockEntry> = allPages("getOverrides") { getOverrides(cursor = it).let { page -> page.items to page.next } }

/** Every player, online or not, following the pages. [now] is unix seconds. */
suspend fun BlocksClient.allPlayers(now: ULong): List<PlayerView> = allPages("getPlayers") { getPlayers(now, cursor = it).let { page -> page.items to page.next } }

/** Follows [page] (its rows and next cursor) from the first page until one answers no cursor. */
private suspend fun <T> allPages(
    method: String,
    page: suspend (String?) -> Pair<List<T>, String?>,
): List<T> {
    val rows = mutableListOf<T>()
    var cursor: String? = null
    repeat(BlocksContract.MAX_PAGES) {
        val (items, next) = page(cursor)
        rows += items
        cursor = next ?: return rows
    }
    throw SerializationException("$method: more than ${BlocksContract.MAX_PAGES} pages")
}
