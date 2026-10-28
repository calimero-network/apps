package network.calimero.battleships.core

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import network.calimero.battleships.generated.game.MatchStateView

/**
 * One match, from placing the fleet to the audited result. (Swift `MatchModel`; the web app's
 * `pages/match`.)
 *
 * The board and its salt never leave the device before the reveal: placing seals the fleet
 * ([StoredBoard.sealing]), keeps it in the [BoardStore] FIRST, then files only the commitment.
 * Every shot at you is answered from that board, automatically, and when the answers end the match
 * the board is revealed for every reader to audit.
 */
@Suppress("TooManyFunctions")
class MatchModel(
    val ref: MatchRef,
    me: String,
    val backend: BattleshipsBackend,
    private val store: BoardStore,
) {
    sealed interface Stage {
        /** The first read has not come back (or the context is still syncing to the relay). */
        data object Loading : Stage

        /** Lay out the fleet and deploy it. */
        data object Placing : Stage

        /** Deployed; the opponent has not. */
        data object Waiting : Stage

        /** Both fleets are down: take turns. */
        data object Battle : Stage

        /** The answers ended it. */
        data object Finished : Stage

        /** You deployed on another device: this one cannot answer shots or reveal. */
        data object BoardMissing : Stage

        data class Failed(
            val message: String,
        ) : Stage
    }

    enum class Outcome { WON, LOST, AUDITING, VOID }

    /** The key the match names you by (`register_player`'s answer; the account on a relay). */
    val me: String = me.lowercase()
    private val game = GameApi(backend.app.contract, ref.contextId)

    private val _stage = MutableStateFlow<Stage>(Stage.Loading)
    val stage: StateFlow<Stage> = _stage.asStateFlow()
    private val _state = MutableStateFlow<MatchStateView?>(null)
    val state: StateFlow<MatchStateView?> = _state.asStateFlow()

    /** Your shots at the opponent, one [Cell] value per square. */
    private val _shots = MutableStateFlow(List(BoardGeometry.CELL_COUNT) { Cell.EMPTY })
    val shots: StateFlow<List<Int>> = _shots.asStateFlow()

    /** Your waters: your fleet with the opponent's answered shots over it. */
    private val _ownBoard = MutableStateFlow<List<Int>>(emptyList())
    val ownBoard: StateFlow<List<Int>> = _ownBoard.asStateFlow()
    private val _turn = MutableStateFlow<String?>(null)
    val turn: StateFlow<String?> = _turn.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()
    private val _syncing = MutableStateFlow(false)
    val syncing: StateFlow<Boolean> = _syncing.asStateFlow()
    val notice = MutableStateFlow<String?>(null)

    private val _layout = MutableStateFlow(FleetLayout())
    val layout: StateFlow<FleetLayout> = _layout.asStateFlow()
    private val _selectedShip = MutableStateFlow<Int?>(0)
    val selectedShip: StateFlow<Int?> = _selectedShip.asStateFlow()
    private val _horizontal = MutableStateFlow(true)
    val horizontal: StateFlow<Boolean> = _horizontal.asStateFlow()
    private val _aim = MutableStateFlow<Coordinate?>(null)
    val aim: StateFlow<Coordinate?> = _aim.asStateFlow()

    private var answeredShot: UInt? = null
    private var revealing = false
    private val reading = Mutex()

    @Volatile private var readAgain = false

    // ---- Reading ------------------------------------------------------------------------------

    val stored: StoredBoard? get() = store.load(me, ref.matchId)

    val isMyTurn: Boolean
        get() = _stage.value == Stage.Battle && _turn.value?.lowercase() == me && _state.value?.pendingShot == null

    /** Whose move the battle is waiting on, in words. */
    val turnText: String
        get() {
            val pending = _state.value?.pendingShot
            return when {
                pending != null -> if (pending.target.equals(me, true)) "Answering their shot…" else "Waiting for their answer…"
                isMyTurn -> "Your turn. Pick a square."
                else -> "Their turn."
            }
        }

    val outcome: Outcome?
        get() {
            val state = _state.value ?: return null
            if (_stage.value != Stage.Finished) return null
            return when (state.standing) {
                "won" -> if (state.winner.equals(me, true)) Outcome.WON else Outcome.LOST
                "void" -> Outcome.VOID
                else -> Outcome.AUDITING
            }
        }

    /** Why it ended, from the contract's `ended_by` and audit. */
    val endedText: String?
        get() {
            val state = _state.value ?: return null
            if (state.auditFailed.any { it.equals(me, true) }) return "Your revealed board did not match your answers."
            if (state.auditFailed.any { !it.equals(me, true) }) {
                return "Their revealed board did not match their answers, so the match is yours."
            }
            return when (state.endedBy) {
                "sunk" -> if (state.loser.equals(me, true)) "Your fleet was sunk." else "Every ship of theirs is sunk."
                "equivocation" -> "A player answered the same shot two ways."
                "impossible_misses" -> "Too many misses to be true: a fleet was hidden."
                else -> null
            }
        }

    fun enemySunk(shots: List<Int> = _shots.value): List<List<Coordinate>> = BoardReading.sunkEnemyShips(shots)

    fun ownSunk(board: List<Int> = _ownBoard.value): List<List<Coordinate>> {
        val cells = stored?.cells ?: return emptyList()
        return BoardReading.sunkOwnShips(cells, board)
    }

    // ---- Loading and live updates -------------------------------------------------------------

    /** Read the match and act on it: answer a shot aimed at you, reveal when it is over. */
    suspend fun refresh() {
        if (!reading.tryLock()) {
            readAgain = true
            return
        }
        try {
            do {
                readAgain = false
                readOnce()
            } while (readAgain)
        } finally {
            reading.unlock()
        }
    }

    @Suppress("CyclomaticComplexMethod", "LongMethod", "ReturnCount")
    private suspend fun readOnce() {
        val matchId = ref.matchId
        val current: MatchStateView
        val mine: List<Int>
        val incoming: List<Int>
        try {
            current = game.client.getMatchState(matchId)
            mine =
                game.client
                    .getShots(matchId)
                    .shots
                    .map { it.toInt() }
            incoming =
                game.client
                    .getIncomingShots(matchId)
                    .shots
                    .map { it.toInt() }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (_state.value == null) {
                // A context the relay has not synced yet, or one this account has not joined.
                _syncing.value = true
                if (attempt { backend.app.isMember(ref.contextId) } == false) attempt { backend.app.joinContext(ref.contextId) }
                if (_stage.value !is Stage.Failed) _stage.value = Stage.Loading
            } else {
                notice.value = ErrorText.describe(e, "Couldn't refresh the match.")
            }
            return
        }
        _syncing.value = false
        var latest = current
        _shots.value = mine
        _turn.value = game.currentTurn()
        if (latest.committed.none { it.equals(me, true) }) {
            _state.value = latest
            _stage.value = if (latest.standing == "playing") Stage.Placing else Stage.Finished
            return
        }
        val board = stored
        if (board == null) {
            _state.value = latest
            _ownBoard.value = BoardReading.overlay(List(BoardGeometry.CELL_COUNT) { Cell.EMPTY }, incoming)
            _stage.value = if (latest.standing == "playing") Stage.BoardMissing else Stage.Finished
            return
        }
        var answers = incoming
        if (answerPendingShot(latest, board.cells)) {
            latest = attempt { game.client.getMatchState(matchId) } ?: latest
            answers = attempt {
                game.client
                    .getIncomingShots(matchId)
                    .shots
                    .map { it.toInt() }
            } ?: answers
            _turn.value = game.currentTurn()
        }
        if (revealIfDue(latest, board)) {
            latest = attempt { game.client.getMatchState(matchId) } ?: latest
        }
        _state.value = latest
        _ownBoard.value = BoardReading.overlay(board.cells, answers)
        _stage.value =
            when {
                latest.standing != "playing" -> {
                    _aim.value = null
                    Stage.Finished
                }
                latest.committed.size < 2 -> Stage.Waiting
                else -> Stage.Battle
            }
    }

    /**
     * Answer the pending shot from the board on this device, if it is yours to answer. Automatic,
     * as on the web: the answer is your signed statement, and the reveal is replayed against it.
     */
    private suspend fun answerPendingShot(
        state: MatchStateView,
        cells: List<Int>,
    ): Boolean {
        val shot = state.pendingShot ?: return false
        if (state.standing != "playing" || !shot.target.equals(me, true) || answeredShot == shot.shotId) return false
        answeredShot = shot.shotId
        val hit = BoardReading.isHit(cells, Coordinate(shot.x.toInt(), shot.y.toInt()))
        return attempt { game.client.acknowledgeShot(ref.matchId, shot.shotId, hit) }.let { answered ->
            if (answered == null) answeredShot = null
            answered != null
        }
    }

    /** Open the board once the answers have ended the match and the contract has not seen yours. */
    private suspend fun revealIfDue(
        state: MatchStateView,
        board: StoredBoard,
    ): Boolean {
        if (state.standing == "playing" || revealing) return false
        if (state.revealed.any { it.equals(me, true) } || state.auditFailed.any { it.equals(me, true) }) return false
        revealing = true
        return try {
            attempt { game.reveal(ref.matchId, board.cells, board.saltBytes) } != null
        } finally {
            revealing = false
        }
    }

    /**
     * Keep the match fresh while it is on screen: the relay's events when it streams, and a poll
     * either way, so a dropped event never stalls a turn.
     */
    suspend fun live() {
        coroutineScope {
            if (backend.app.canSubscribe) {
                launch { attempt { backend.app.events(ref.contextId).collect { refresh() } } }
            }
            launch {
                while (true) {
                    delay(Battleships.POLL_INTERVAL_MS)
                    refresh()
                }
            }
        }
    }

    // ---- Placing ------------------------------------------------------------------------------

    /**
     * A tap on the placement grid: on one of your ships, turn it; on open water, put the selected
     * ship there (moving it, when it is already placed).
     */
    fun tapPlacement(cell: Coordinate): Boolean {
        val layout = _layout.value
        val shipAt = layout.shipIndex(cell)
        if (shipAt != null) {
            val turned = layout.rotate(shipAt, cell)
            if (turned == null) {
                notice.value = "No room to turn the ${Fleet.classes[shipAt].name.lowercase()} there."
                return false
            }
            _layout.value = turned
            return true
        }
        val index = _selectedShip.value ?: layout.nextUnplaced ?: return false
        val placed = layout.place(index, cell, _horizontal.value)
        if (placed == null) {
            notice.value = "Ships can't overlap or touch, not even at a corner."
            return false
        }
        _layout.value = placed
        _selectedShip.value = placed.nextUnplaced
        return true
    }

    fun select(index: Int) {
        _selectedShip.value = index
    }

    fun remove(index: Int) {
        _layout.value = _layout.value.remove(index)
        _selectedShip.value = index
    }

    fun shuffle() {
        _layout.value = FleetLayout.random()
        _selectedShip.value = null
    }

    fun clearLayout() {
        _layout.value = FleetLayout()
        _selectedShip.value = 0
    }

    fun toggleOrientation() {
        _horizontal.value = !_horizontal.value
    }

    /** Seal the fleet, keep it on this device, and file the commitment. */
    suspend fun deploy(): Boolean {
        val layout = _layout.value
        if (!layout.isComplete) {
            notice.value = "Place all five ships first."
            return false
        }
        if (_busy.value) return false
        _busy.value = true
        try {
            val board = StoredBoard.sealing(layout)
            if (!store.save(board, me, ref.matchId)) {
                notice.value = "This device refused to keep your board, so it could not answer shots."
                return false
            }
            game.client.commitBoard(ref.matchId, board.commitment)
            refresh()
            return true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            notice.value = ErrorText.describe(e, "Couldn't deploy your fleet. Try again.")
            return false
        } finally {
            _busy.value = false
        }
    }

    // ---- Firing -------------------------------------------------------------------------------

    /** A tap on the enemy grid: aim there, or fire when it is already aimed there. */
    suspend fun tapTarget(cell: Coordinate) {
        if (!isMyTurn || !cell.isOnBoard || _shots.value[cell.index] != Cell.EMPTY) return
        if (_aim.value == cell) fire() else _aim.value = cell
    }

    suspend fun fire() {
        val target = _aim.value ?: return
        if (!isMyTurn || _busy.value) return
        _busy.value = true
        try {
            game.client.proposeShot(ref.matchId, target.x.toUInt(), target.y.toUInt())
            _aim.value = null
            refresh()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            when {
                ErrorText.isFinished(e) -> refresh()
                ErrorText.isOpponentNotReady(e) -> notice.value = "Your opponent has not deployed their fleet yet."
                else -> notice.value = ErrorText.describe(e, "Couldn't fire. Try again.")
            }
        } finally {
            _busy.value = false
        }
    }

    fun clearAim() {
        _aim.value = null
    }
}
