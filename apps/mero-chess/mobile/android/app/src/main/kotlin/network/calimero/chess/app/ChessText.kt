package network.calimero.chess.app

import network.calimero.chess.generated.SeatView
import network.calimero.chess.generated.TableView

/** The app's fixed values, shared with the web app and the contract's bundle. (Swift `ChessConstants`.) */
object ChessConstants {
    /** The bundle's package id (`logic/Cargo.toml`), which is also the invitation link slug. */
    const val PACKAGE_NAME = "com.calimero.mero-chess"

    /** What a new table is called when the field is left empty (the web app's only title). */
    const val DEFAULT_TITLE = "Chess table"

    /** What the contract files a player under when they gave no name. */
    const val DEFAULT_NAME = "Guest"

    /**
     * How often an open table is re-read even when no event arrived: presence expires (nobody emits
     * "I went away") and an event can be missed while the stream reconnects. The web app's value.
     */
    const val POLL_MILLIS = 6_000L
}

/** Every sentence the screens show that is worked out from the contract's answers. Same words as the web app. (Swift `ChessText`.) */
object ChessText {
    /** The sentence under the board: whose move it is, or how the game ended. */
    fun status(view: TableView): String {
        if (view.status == "awaitingPlayers") return "Waiting for both players to sit down."
        if (view.status == "finished") {
            val how = REASONS[view.reason] ?: view.reason
            if (view.result == "1/2-1/2") return "Draw — $how."
            val winner =
                when (view.result) {
                    "1-0" -> view.white.name
                    "0-1" -> view.black.name
                    else -> ""
                }
            return if (winner.isNotEmpty()) "$winner wins — $how." else "Game over — $how."
        }
        val white = view.sideToMove == "white"
        val mover = if (white) view.white.name else view.black.name
        val side = if (white) "White" else "Black"
        return if (view.check) "$side ($mover) is in check." else "$side ($mover) to move."
    }

    /** "Game 2 of 3 · 1-0 · your move". */
    fun meta(view: TableView): String {
        val parts = mutableListOf("Game ${view.game + 1u} of ${view.gamesPlayed}")
        if (view.result != "*") parts += view.result
        if (view.myTurn) parts += "your move"
        return parts.joinToString(" · ")
    }

    /** The claim-a-draw button's label, or null when there is nothing to claim. */
    fun claimLabel(claimable: String): String? =
        when (claimable) {
            "threefold" -> "Claim draw (threefold repetition)"
            "fiftyMove" -> "Claim draw (fifty-move rule)"
            else -> null
        }

    /** `1/2-1/2` as a person writes it. */
    fun score(result: String): String = result.replace("1/2", "½")

    /** How a past game ended, for the record. */
    fun recordReason(reason: String): String = RECORD_WORDS[reason] ?: reason

    /** A readable short form of an id nobody named. */
    fun shortId(id: String): String = if (id.length > 12) "${id.take(6)}…${id.takeLast(4)}" else id

    /** An error as one sentence. A contract refusal is already written for a player, so it is shown as it came. */
    fun error(error: Throwable): String = error.message?.takeIf { it.isNotBlank() } ?: "Something went wrong talking to the relay."

    private val REASONS =
        mapOf(
            "checkmate" to "checkmate",
            "stalemate" to "stalemate",
            "insufficientMaterial" to "neither side can mate",
            "fivefold" to "fivefold repetition",
            "seventyFiveMove" to "the seventy-five-move rule",
            "resignation" to "resignation",
            "agreement" to "by agreement",
            "threefold" to "threefold repetition",
            "fiftyMove" to "the fifty-move rule",
            "equivocation" to "two different moves played at once",
        )

    private val RECORD_WORDS =
        mapOf(
            "checkmate" to "checkmate",
            "stalemate" to "stalemate",
            "insufficientMaterial" to "dead position",
            "fivefold" to "fivefold repetition",
            "seventyFiveMove" to "seventy-five-move rule",
            "resignation" to "resignation",
            "agreement" to "agreement",
            "threefold" to "threefold repetition",
            "fiftyMove" to "fifty-move rule",
            "equivocation" to "two moves at once",
        )
}

/** The view with every occupied seat named: the name given at the table, else a short id. */
val TableView.named: TableView
    get() = copy(white = white.named(), black = black.named())

private fun SeatView.named(): SeatView = if (member.isNotEmpty() && name.isBlank()) copy(name = ChessText.shortId(member)) else this
