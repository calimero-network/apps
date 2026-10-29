package network.calimero.kombat.app

import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import network.calimero.kombat.generated.ArenaView
import network.calimero.kombat.generated.FighterView
import network.calimero.kombat.generated.MatchSummary

/**
 * What a screen hosting the game page does with it: answer what the page posts, and push what the
 * page needs through [deliver]. (Swift `GameHost`.)
 */
interface GameHost {
    /** Set by the web view: runs a message's script on the page (on the main thread). */
    var deliver: ((BridgeOutbound) -> Unit)?

    suspend fun receive(message: BridgeInbound)
}

/** The transactions this screen sent, for the top bar's meter (the web app's chain panel, small). */
data class TxMeter(
    val sent: Int = 0,
    val ok: Int = 0,
    val failed: Int = 0,
    /** Round trip of the last confirmed action, ms. */
    val lastMs: Long = 0,
)

data class ArenaState(
    val view: ArenaView? = null,
    val past: List<MatchSummary> = emptyList(),
    val error: String? = null,
    val busy: Boolean = false,
    val meter: TxMeter = TxMeter(),
    /** Corners streaming presence right now: the honest "online" for a fight. */
    val live: Set<String> = emptySet(),
    val name: String = "",
    val fighter: String = "kinetic",
    val muted: Boolean = false,
) {
    val mySeat: String get() = view?.mySeat.orEmpty()
    val isSeated: Boolean get() = mySeat.isNotEmpty()

    /** The engine's slot: 0 for p1, 1 for p2, null to watch. */
    val local: Int? get() =
        when (mySeat) {
            "p1" -> 0
            "p2" -> 1
            else -> null
        }

    val mode: GameMode get() = if (local == null) GameMode.SPECTATE else GameMode.NET
    val isFinished: Boolean get() = view?.status == "finished"

    val statusText: String get() = view?.let { KombatText.status(it, "p1" in live && "p2" in live) } ?: "Reading the arena…"

    /** The engine's two looks, p1 then p2 (the web page's defaults for empty corners). */
    val fighters: List<String> get() =
        listOf(
            view?.p1?.fighter?.ifEmpty { null } ?: "kinetic",
            view?.p2?.fighter?.ifEmpty { null } ?: "cryo",
        )

    /** Finished matches, newest first, at most six (the web app's record card). */
    val record: List<MatchSummary> get() = past.filter { it.winner.isNotEmpty() }.reversed().take(6)

    /** Leaving is offered only while the contract allows it: before the arena's first blow. */
    fun canLeave(corner: FighterView): Boolean {
        val view = view ?: return false
        return corner.member.isNotEmpty() && corner.member == view.me && view.matchActions == 0u && view.matchIndex == 0u
    }
}

/**
 * One arena, kept current, and the game page fighting in it: the port of the web app's `useArena` +
 * `ArenaPage`. (Swift `ArenaModel`.)
 *
 * Movement is presence and actions are transactions, exactly as on the web: the page simulates this
 * fighter, streams it at 15 slices a second through [SlicePublisher] and sends each finished action as
 * one `act` through [GameCalls]. Every contract read lands here first and is pushed to the page, so the
 * corners sheet and the fight always read the same arena.
 */
@Suppress("TooManyFunctions")
class ArenaModel(
    private val backend: MeroAppBackend,
    val ref: ArenaRef,
    private val store: PlayerStore,
    private val presence: PresenceChannel?,
) : GameHost {
    val contextId: String get() = ref.contextId
    val hasPresence: Boolean get() = presence != null

    private val client = kombatClient(backend, ref.contextId)
    private val calls = GameCalls(client)
    private val publisher = presence?.let { SlicePublisher(it) }
    private val _state = MutableStateFlow(ArenaState(name = store.name, fighter = store.fighter, muted = store.muted))
    val state: StateFlow<ArenaState> = _state.asStateFlow()

    @Volatile override var deliver: ((BridgeOutbound) -> Unit)? = null

    private val lastSeen = mutableMapOf<String, Long>()

    @Volatile private var reading = false

    @Volatile private var readAgain = false
    private var pastSignature: String? = null
    private var announced = false
    private var booted: BridgeOutbound? = null

    // ---- running -------------------------------------------------------------------------------

    /**
     * Announce, read, then keep current: every relay event is a nudge to re-read, the poll covers
     * events missed while the stream reconnects, and the opponent's presence streams in.
     */
    suspend fun run() {
        announce()
        refresh()
        coroutineScope {
            launch { runCatching { backend.events(contextId).collect { refresh() } } }
            launch {
                while (isActive) {
                    delay(KombatConstants.POLL_MILLIS)
                    refresh()
                }
            }
            launch { presence?.let { channel -> runCatching { channel.slices().collect { onSlice(it) } } } }
            launch {
                while (isActive) {
                    delay(1_000)
                    updateLiveness()
                }
            }
        }
    }

    /** The opponent's slice: straight to the page, and it says their corner is here. */
    internal fun onSlice(json: String) {
        val seat =
            runCatching { (Json.parseToJsonElement(json) as? JsonObject)?.get("seat") as? JsonPrimitive }
                .getOrNull()
                ?.contentOrNull
        if (seat == "p1" || seat == "p2") {
            synchronized(lastSeen) { lastSeen[seat] = System.currentTimeMillis() }
            updateLiveness()
        }
        deliver?.invoke(BridgeOutbound.Slice(json))
    }

    private fun updateLiveness() {
        val now = System.currentTimeMillis()
        val next = synchronized(lastSeen) { lastSeen.filterValues { now - it < KombatConstants.PRESENCE_STALE_MILLIS }.keys.toSet() }
        if (next != _state.value.live) _state.update { it.copy(live = next) }
    }

    /** Announce this account in the arena with a name and a fighter, once (`join`). */
    suspend fun announce() {
        if (announced) return
        announced = true
        runCatching { client.join(displayName, _state.value.fighter, nowMillis()) }
    }

    private val displayName: String get() =
        _state.value.name
            .trim()
            .take(24)
            .ifEmpty { KombatConstants.DEFAULT_NAME }

    // ---- reading -------------------------------------------------------------------------------

    /**
     * Re-read the arena. Coalesced: at most one read in flight and one more queued behind it, at least
     * 160 ms apart (the web app's rule: a fight emits an event per transaction).
     */
    suspend fun refresh() {
        if (reading) {
            readAgain = true
            return
        }
        reading = true
        try {
            do {
                readAgain = false
                val started = System.currentTimeMillis()
                try {
                    apply(client.arena(nowMillis()))
                    _state.update { it.copy(error = null) }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    _state.update { it.copy(error = KombatText.error(e)) }
                    return
                }
                val rest = KombatConstants.MIN_READ_GAP_MILLIS - (System.currentTimeMillis() - started)
                if (readAgain && rest > 0) delay(rest)
            } while (readAgain)
        } finally {
            reading = false
        }
        refreshPastIfNeeded()
    }

    internal fun apply(next: ArenaView) {
        _state.update { it.copy(view = next) }
        pushBoot()
        deliver?.invoke(BridgeOutbound.State(GameCalls.encode(next)))
    }

    /**
     * Boot (or re-boot) the page when what the game fundamentally IS changes: the mode, the seat, the
     * looks. A read that changes nothing else is fed into the running game.
     */
    private fun pushBoot() {
        val s = _state.value
        val boot = BridgeOutbound.Boot(s.mode, s.local, s.fighters, s.muted)
        if (boot == booted) return
        booted = boot
        deliver?.invoke(boot)
    }

    private suspend fun refreshPastIfNeeded() {
        val view = _state.value.view ?: return
        val signature = "${view.matchIndex}:${view.winner}"
        if (signature == pastSignature) return
        runCatching { client.history() }.onSuccess { rows ->
            _state.update { it.copy(past = rows) }
            pastSignature = signature
        }
    }

    // ---- the page ------------------------------------------------------------------------------

    override suspend fun receive(message: BridgeInbound) {
        when (message) {
            BridgeInbound.Ready -> {
                booted = null
                pushBoot()
                _state.value.view?.let { deliver?.invoke(BridgeOutbound.State(GameCalls.encode(it))) }
            }
            is BridgeInbound.Call -> {
                val isAct = message.kind == BridgeInbound.CallKind.EXECUTE && message.method == "act"
                if (isAct) _state.update { it.copy(meter = it.meter.copy(sent = it.meter.sent + 1)) }
                val started = System.currentTimeMillis()
                val answer = calls.handle(message.id, message.kind, message.method, message.argsJson)
                if (isAct) {
                    _state.update {
                        if (answer is BridgeOutbound.Result) {
                            it.copy(meter = it.meter.copy(ok = it.meter.ok + 1, lastMs = System.currentTimeMillis() - started))
                        } else {
                            it.copy(meter = it.meter.copy(failed = it.meter.failed + 1))
                        }
                    }
                }
                deliver?.invoke(answer)
                if (isAct) refresh()
            }
            is BridgeInbound.Presence -> publisher?.offer(message.sliceJson)
            is BridgeInbound.Over -> Unit
        }
    }

    /** The screen left the foreground: stop the page. */
    fun pause() {
        deliver?.invoke(BridgeOutbound.Pause)
    }

    fun resume() {
        deliver?.invoke(BridgeOutbound.Resume)
    }

    /** The screen closed: take this fighter's slice down. */
    suspend fun leaveScreen() {
        presence?.retract()
    }

    // ---- corners -------------------------------------------------------------------------------

    fun setName(name: String) {
        val trimmed = name.take(24)
        store.name = trimmed
        _state.update { it.copy(name = trimmed) }
    }

    suspend fun sit(seat: String) {
        val name = displayName
        ref.namespaceId?.let { namespaceId ->
            // The web app's `names.publish(name)`: the namespace-wide name, best-effort.
            runCatching { backend.setMemberName(namespaceId, name) }
        }
        val fighter = _state.value.fighter
        call { it.sit(seat, name, fighter, nowMillis()) }
    }

    suspend fun stand() = call { it.stand(nowMillis()) }

    suspend fun rematch() = call { it.rematch(nowMillis()) }

    suspend fun choose(id: String) {
        store.fighter = id
        _state.update { it.copy(fighter = id) }
        if (_state.value.isSeated) call { it.pick(id, nowMillis()) }
    }

    fun setMuted(muted: Boolean) {
        store.muted = muted
        _state.update { it.copy(muted = muted) }
        deliver?.invoke(BridgeOutbound.Mute(muted))
    }

    fun dismissError() {
        _state.update { it.copy(error = null) }
    }

    private suspend fun call(body: suspend (network.calimero.kombat.generated.KombatClient) -> Unit): Boolean {
        _state.update { it.copy(busy = true, error = null) }
        var failure: String? = null
        try {
            body(client)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failure = KombatText.error(e)
        }
        _state.update { it.copy(busy = false, error = failure) }
        refresh()
        if (failure != null) _state.update { it.copy(error = failure) }
        return failure == null
    }

    // ---- inviting ------------------------------------------------------------------------------

    suspend fun inviteLink(): String {
        val namespaceId = ref.namespaceId ?: throw KombatException(KombatException.Kind.NO_NAMESPACE)
        return KombatInvitation(backend.createInvitation(namespaceId), namespaceId, contextId).link()
    }
}

data class PracticeState(
    val fighter: String = "kinetic",
    val over: Boolean = false,
    val muted: Boolean = false,
) {
    val cpu: String get() = FighterInfo.cpu(fighter).id
}

/** Practice against the CPU: the same page in `cpu` mode, no contract and no presence. (Swift `PracticeModel`.) */
class PracticeModel(
    private val store: PlayerStore,
) : GameHost {
    private val _state = MutableStateFlow(PracticeState(fighter = store.fighter, muted = store.muted))
    val state: StateFlow<PracticeState> = _state.asStateFlow()

    @Volatile override var deliver: ((BridgeOutbound) -> Unit)? = null

    override suspend fun receive(message: BridgeInbound) {
        when (message) {
            BridgeInbound.Ready -> boot()
            is BridgeInbound.Over -> _state.update { it.copy(over = message.over) }
            is BridgeInbound.Call -> deliver?.invoke(BridgeOutbound.Failure(message.id, "Practice is off the chain"))
            is BridgeInbound.Presence -> Unit
        }
    }

    fun choose(id: String) {
        store.fighter = id
        _state.update { it.copy(fighter = id) }
        boot()
    }

    fun rematch() {
        _state.update { it.copy(over = false) }
        deliver?.invoke(BridgeOutbound.Restart)
    }

    fun setMuted(muted: Boolean) {
        store.muted = muted
        _state.update { it.copy(muted = muted) }
        deliver?.invoke(BridgeOutbound.Mute(muted))
    }

    fun pause() {
        deliver?.invoke(BridgeOutbound.Pause)
    }

    fun resume() {
        deliver?.invoke(BridgeOutbound.Resume)
    }

    private fun boot() {
        _state.update { it.copy(over = false) }
        val s = _state.value
        deliver?.invoke(BridgeOutbound.Boot(GameMode.CPU, 0, listOf(s.fighter, s.cpu), s.muted))
    }
}
