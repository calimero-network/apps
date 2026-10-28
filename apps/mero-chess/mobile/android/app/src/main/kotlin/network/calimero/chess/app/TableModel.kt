package network.calimero.chess.app

import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import network.calimero.chess.generated.GameSummary
import network.calimero.chess.generated.MeroChessClient
import network.calimero.chess.generated.SeatView
import network.calimero.chess.generated.TableView

/** A promotion the player has started and not yet chosen a piece for. */
data class PendingPromotion(
    val from: String,
    val to: String,
    val kinds: List<Char>,
    val color: PieceColor,
)

/** Everything the table screen draws. */
data class TableState(
    val view: TableView? = null,
    val past: List<GameSummary> = emptyList(),
    val error: String? = null,
    val busy: Boolean = false,
    val selected: String? = null,
    val promotion: PendingPromotion? = null,
    /** Bumped each time a move the player made is accepted (the screen gives haptic feedback on it). */
    val movesPlayed: Int = 0,
    /** The name the player sits and announces under. */
    val name: String = "",
) {
    val squares: List<Piece?> get() = view?.let { Board.squares(it.fen) } ?: List(64) { null }

    /**
     * A player sees the board from their own side, a spectator from White's. Not simply "my colour is
     * black": one person holding both chairs would see the board spin after every move.
     */
    val flipped: Boolean get() = view?.let { it.black.member == it.me && it.white.member != it.me } ?: false

    /** The board takes taps only on your move (the contract also sends no legal moves otherwise). */
    val interactive: Boolean get() = (view?.myTurn ?: false) && !busy

    val movable: Set<String> get() = if (interactive) Board.movable(view?.legalMoves.orEmpty()) else emptySet()

    val targets: Set<String> get() = selected?.let { from -> view?.let { Board.targets(it.legalMoves, from) } }.orEmpty()

    val lastMove: Pair<String, String>? get() =
        view
            ?.moves
            ?.lastOrNull()
            ?.uci
            ?.takeIf { it.length >= 4 }
            ?.let { it.substring(0, 2) to it.substring(2, 4) }

    /** The side whose king is lit red. */
    val inCheck: PieceColor? get() = view?.takeIf { it.check }?.let { PieceColor.fromWire(it.sideToMove) }

    val isSeated: Boolean get() = !view?.myColor.isNullOrEmpty()

    /** The opponent has a draw offer standing in this position. */
    val offerFromOpponent: Boolean get() = view?.let { it.drawOfferFrom.isNotEmpty() && it.drawOfferFrom != it.me } ?: false

    /** Your own offer is standing. */
    val myOfferStands: Boolean get() = view?.let { it.me.isNotEmpty() && it.drawOfferFrom == it.me } ?: false

    /** Playing, as opposed to watching or waiting for the game to start. */
    val isPlaying: Boolean get() = view?.status == "inProgress" && isSeated

    val isFinished: Boolean get() = view?.status == "finished"

    fun seat(color: PieceColor): SeatView? = view?.let { if (color == PieceColor.WHITE) it.white else it.black }

    /** Standing up is offered only while the contract allows it: before the table's first game is under way. */
    fun canStand(color: PieceColor): Boolean {
        val view = view ?: return false
        val seat = seat(color) ?: return false
        return seat.member.isNotEmpty() && seat.member == view.me && view.moves.isEmpty() && view.game == 0u && view.status != "finished"
    }
}

/**
 * One table, kept current: the port of the web app's `useChessTable` + `ChessBoard` state.
 * (Swift `TableModel`.)
 *
 * Everything the screen shows comes from ONE `table()` read: the contract derives position, legal
 * moves, status and result from the same replay of the move list, so reading them separately could
 * paint a board from one moment beside a result from another. There is no optimistic update: a move
 * is a move once the contract has taken it.
 */
@Suppress("TooManyFunctions")
class TableModel(
    private val backend: MeroAppBackend,
    val contextId: String,
    val namespaceId: String?,
    private val names: NameStore,
    private val scope: CoroutineScope,
) {
    private val client: MeroChessClient = chessClient(backend, contextId)
    private val _state = MutableStateFlow(TableState(name = names.name))
    val state: StateFlow<TableState> = _state.asStateFlow()

    @Volatile private var reading = false
    private var pastSignature: String? = null
    private var boardKey: String? = null

    // ---- reading ----------------------------------------------------------------------------

    /**
     * Re-read the table. A read already in flight is not duplicated: a burst of events (a move and
     * the ending it caused) would otherwise fire one read each.
     */
    suspend fun refresh() {
        if (reading) return
        reading = true
        try {
            val next = client.table(nowMillis()).named
            val key = "${next.fen}|${next.myTurn}"
            _state.update { state ->
                // A selection cannot survive the position changing under it.
                if (key != boardKey) {
                    state.copy(view = next, error = null, selected = null, promotion = null)
                } else {
                    state.copy(view = next, error = null)
                }
            }
            boardKey = key
        } catch (e: CancellationException) {
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            _state.update { it.copy(error = ChessText.error(e)) }
        } finally {
            reading = false
        }
        refreshPastIfNeeded()
    }

    /** The record of finished games is re-read only when the table says it could have changed. */
    private suspend fun refreshPastIfNeeded() {
        val view = _state.value.view ?: return
        val signature = "${view.gamesPlayed}:${view.result}"
        if (signature == pastSignature) return
        val rows = runCatching { client.history() }.getOrNull() ?: return
        _state.update { it.copy(past = rows) }
        pastSignature = signature
    }

    /**
     * Announce, then keep the table current until [scope] is cancelled: every live event is a nudge
     * to re-read (nothing is read out of its payload), and a poll covers presence and any event missed
     * while the stream reconnects.
     */
    fun start(): Job =
        scope.launch {
            announce()
            refresh()
            launch {
                runCatching { backend.events(contextId).collect { refresh() } }
            }
            while (isActive) {
                delay(ChessConstants.POLL_MILLIS)
                refresh()
            }
        }

    /** Presence: so a spectator is visible and a player's dot is honest. Best-effort, as on the web. */
    suspend fun announce() {
        runCatching { client.join(displayName(), nowMillis()) }
    }

    private fun displayName(): String =
        _state.value.name
            .trim()
            .take(32)
            .ifEmpty { ChessConstants.DEFAULT_NAME }

    fun setName(name: String) {
        val trimmed = name.take(32)
        names.name = trimmed
        _state.update { it.copy(name = trimmed) }
    }

    // ---- the board --------------------------------------------------------------------------

    /** A tap on a square: pick a piece up, put it down, or move it. Returns the UCI of a move sent, if any. */
    suspend fun tap(square: String): String? {
        val state = _state.value
        val view = state.view ?: return null
        if (!state.interactive) return null
        val from = state.selected
        if (from != null && square in state.targets) {
            val kinds = Board.promotions(view.legalMoves, from, square)
            if (kinds.isNotEmpty()) {
                // Ask rather than assume a queen: underpromotion is occasionally the only move that wins.
                val mover = Board.squareIndex(from)?.let { state.squares[it] }
                _state.update { it.copy(promotion = PendingPromotion(from, square, kinds, mover?.color ?: PieceColor.WHITE)) }
                return null
            }
            val uci = from + square
            play(uci)
            return uci
        }
        // Tapping the selected piece puts it down; tapping another of yours picks that one up.
        _state.update { it.copy(selected = if (from == square || square !in state.movable) null else square) }
        return null
    }

    /** Send the promotion with [kind]; the picker closes at once. */
    suspend fun promote(kind: Char) {
        val pending = _state.value.promotion ?: return
        _state.update { it.copy(promotion = null) }
        play(pending.from + pending.to + kind)
    }

    fun cancelPromotion() {
        _state.update { it.copy(promotion = null, selected = null) }
    }

    private suspend fun play(uci: String) {
        _state.update { it.copy(selected = null) }
        if (call { it.play(uci, nowMillis()) }) _state.update { it.copy(movesPlayed = it.movesPlayed + 1) }
    }

    // ---- everything that is not a move ----------------------------------------------------

    suspend fun sit(color: PieceColor) {
        val name = displayName()
        call { it.sit(color.wire, name, nowMillis()) }
    }

    suspend fun stand() = call { it.stand(nowMillis()) }

    suspend fun resign() = call { it.resign(nowMillis()) }

    suspend fun offerDraw() = call { it.offerDraw(nowMillis()) }

    suspend fun acceptDraw() = call { it.acceptDraw(nowMillis()) }

    suspend fun declineDraw() = call { it.declineDraw(nowMillis()) }

    suspend fun claimDraw() = call { it.claimDraw(nowMillis()) }

    suspend fun rematch() = call { it.rematch(nowMillis()) }

    fun dismissError() {
        _state.update { it.copy(error = null) }
    }

    /**
     * Run one contract call, then re-read either way: a refused call still moves the player's
     * picture forward (it is not your turn *because* someone else moved).
     */
    private suspend fun call(body: suspend (MeroChessClient) -> Unit): Boolean {
        _state.update { it.copy(busy = true, error = null) }
        val failure =
            try {
                body(client)
                null
            } catch (e: CancellationException) {
                throw e
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                ChessText.error(e)
            }
        _state.update { it.copy(busy = false) }
        reading = false
        refresh()
        if (failure != null) _state.update { it.copy(error = failure) }
        return failure == null
    }

    // ---- inviting ---------------------------------------------------------------------------

    /** A link that admits someone to this table's namespace and opens this table. */
    suspend fun inviteLink(): String {
        val namespaceId = namespaceId ?: throw ChessException(ChessException.Kind.NO_NAMESPACE)
        val signed = backend.createInvitation(namespaceId)
        return ChessInvitation(signed, namespaceId, contextId).link()
    }
}
