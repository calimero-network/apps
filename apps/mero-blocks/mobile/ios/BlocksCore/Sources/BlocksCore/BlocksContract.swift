import Foundation
import MeroKit

// The world contract (`../../logic`, `res/abi.json`), as the component runtime speaks it:
// camelCase methods, u64 values (`now`, `seed`, `createdAt`) as decimal strings, and the growing
// reads (`getOverrides`, `getPlayers`) paged at 1,000 rows. The calls are `BlocksClient`, generated
// from the ABI into `Generated/` by core's `meroctl app codegen` (`scripts/mobile-codegen.sh`);
// this file keeps the paged reads (the world's types are the generated ones). Same as the Kotlin
// `BlocksContract.kt`.

// The world's types are the generated client's (`Generated/BlocksClient.swift`, from the ABI).

/// One block change: world coordinates and the block id (0 = air).
public typealias Edit = BlocksClient.Edit
/// A player's pose and name, as `heartbeat` sends it.
public typealias Transform = BlocksClient.Transform
/// One changed block: `k` is `"x,y,z"`.
public typealias BlockEntry = BlocksClient.BlockEntry
/// A player as `getPlayers` and `join` answer. `id` is the account, or `"<account>/<device>"`.
public typealias PlayerView = BlocksClient.PlayerView
/// The world's identity: terrain `seed` (clients generate identical terrain from it) and
/// `createdAt` (unix seconds; the day/night cycle is counted from here). Decimal strings on the
/// wire; the game page reads them as numbers (`BridgeRouter`).
public typealias WorldMeta = BlocksClient.WorldMeta

extension BlocksClient {
    /// Every method this app calls, with its parameters in ABI order. Tests pin it to the
    /// component ABI. `device` is left unset: one avatar per account (`PlayerView.id` = account).
    public static let methods: [String: [String]] = [
        "worldMeta": [], "getOverrides": ["cursor", "limit"], "getPlayers": ["now", "cursor", "limit"],
        "overrideCount": [], "join": ["name", "now", "device"], "heartbeat": ["t", "now", "device"],
        "leave": ["now", "device"], "setBlocks": ["edits", "now", "device"],
    ]
    /// Pages a read follows at most: 1,000 rows each, so ~1M rows (a world full of edits).
    public static let maxPages = 1_100

    /// Every changed block, following the pages.
    public func allOverrides() async throws -> [BlockEntry] {
        try await Self.allPages("getOverrides") { cursor in
            let page = try await getOverrides(cursor: cursor)
            return (page.items, page.next)
        }
    }

    /// Every player, online or not, following the pages. `now` is unix seconds.
    public func allPlayers(now: UInt64) async throws -> [PlayerView] {
        try await Self.allPages("getPlayers") { cursor in
            let page = try await getPlayers(now: now, cursor: cursor)
            return (page.items, page.next)
        }
    }

    /// Follows `page` from the first page until one answers no `next` cursor.
    private static func allPages<Row>(
        _ method: String, _ page: (String?) async throws -> (items: [Row], next: String?)
    ) async throws -> [Row] {
        var rows: [Row] = []
        var cursor: String?
        for _ in 0..<maxPages {
            let next = try await page(cursor)
            rows += next.items
            guard let more = next.next else { return rows }
            cursor = more
        }
        throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "\(method): more than \(maxPages) pages"))
    }
}
