package network.calimero.merraria.app

import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/** The player's settings: the name others see in the world and the game's zoom. Kept under the web app's keys (`mt-name`, `mt-zoom`). */
interface PlayerSettings {
    var name: String
    var zoom: Double
}

class MemoryPlayerSettings(
    override var name: String = MerrariaConstants.DEFAULT_PLAYER_NAME,
    override var zoom: Double = MerrariaConstants.DEFAULT_ZOOM,
) : PlayerSettings

/** Where the game screen is. */
sealed interface GamePhase {
    /** The page is loading the world. */
    data object Loading : GamePhase

    data object Playing : GamePhase

    data class Failed(
        val message: String,
    ) : GamePhase

    /** Saved and left: the screen closes. */
    data object Left : GamePhase
}

data class GameState(
    val phase: GamePhase = GamePhase.Loading,
    /** The world is joined and read; until then edits queue in the game. */
    val connected: Boolean = false,
    val slots: List<HudSlot> = emptyList(),
    val selected: Int = 0,
    val paused: Boolean = false,
    val zoom: Double = MerrariaConstants.DEFAULT_ZOOM,
)

/**
 * One world being played: the bridge to the bundled game, the touch controls, the native HUD
 * (hotbar, status) and the relay's live events. (Swift `GameModel`.)
 *
 * The page is told things through [send] (the web view sets it to evaluate the message's script);
 * what the page posts arrives at [receive]. [scope] runs contract calls and the event stream.
 */
class GameModel(
    private val backend: MeroAppBackend,
    val ref: WorldRef,
    private val settings: PlayerSettings,
    private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow(GameState(zoom = settings.zoom))
    val state: StateFlow<GameState> = _state.asStateFlow()

    @Volatile var send: ((AppMessage) -> Unit)? = null

    private val dispatcher = BridgeDispatcher(backend.merraria(ref.contextId))
    private var controls = TouchControls()
    private var events: Job? = null
    private var leaving: CompletableDeferred<Unit>? = null

    val config: GameConfig get() = GameConfig(ref.contextId, settings.name, _state.value.zoom)

    /**
     * Before the page loads: join the world's context if this account is not in it yet
     * (best-effort; the game says so if it cannot read the world), then listen for events.
     */
    suspend fun start() {
        val member = runCatching { backend.isMember(ref.contextId) }.getOrNull()
        if (member == false) runCatching { backend.joinContext(ref.contextId) }
        startEvents()
    }

    fun stop() {
        events?.cancel()
        events = null
    }

    // ---- page -> app ---------------------------------------------------------------------------

    fun receive(text: String) {
        when (val message = PageMessage.decode(text) ?: return) {
            is PageMessage.Request ->
                if (message.op == BridgeOp.CONFIG) {
                    send?.invoke(AppMessage.success(message.id, config.json))
                } else {
                    scope.launch { send?.invoke(answer(message)) }
                }
            is PageMessage.Hud ->
                _state.value =
                    _state.value.copy(
                        selected = message.selected,
                        slots = message.slots,
                        phase = if (_state.value.phase == GamePhase.Loading) GamePhase.Playing else _state.value.phase,
                    )
            PageMessage.Connected ->
                _state.value =
                    _state.value.copy(
                        connected = true,
                        phase = if (_state.value.phase == GamePhase.Loading) GamePhase.Playing else _state.value.phase,
                    )
            is PageMessage.Fatal -> _state.value = _state.value.copy(phase = GamePhase.Failed(message.message))
            PageMessage.Left -> {
                leaving?.complete(Unit)
                leaving = null
            }
        }
    }

    private suspend fun answer(request: PageMessage.Request): AppMessage =
        try {
            AppMessage.success(request.id, dispatcher.run(request.op, request.method, request.argsJson))
        } catch (e: CancellationException) {
            throw e
        } catch (e: BridgeFailure) {
            AppMessage.failure(request.id, e.message.orEmpty())
        } catch (e: Exception) {
            AppMessage.failure(request.id, MerrariaText.error(e))
        }

    // ---- controls -> page ----------------------------------------------------------------------

    fun press(button: GameButton) {
        if (_state.value.paused) return
        controls.press(button)?.let { send?.invoke(AppMessage.Input(it)) }
    }

    fun release(button: GameButton) {
        controls.release(button)?.let { send?.invoke(AppMessage.Input(it)) }
    }

    fun tap(
        x: Double,
        y: Double,
        unitsPerCssPixel: Double = 1.0,
    ) {
        if (_state.value.paused) return
        send?.invoke(TouchControls.tapTarget(x, y, unitsPerCssPixel))
    }

    fun select(slot: Int) {
        val message = TouchControls.select(slot, _state.value.slots.size) ?: return
        _state.value = _state.value.copy(selected = message.slot)
        send?.invoke(message)
    }

    fun setZoom(value: Double) {
        val clamped = MerrariaConstants.clampZoom(value)
        _state.value = _state.value.copy(zoom = clamped)
        settings.zoom = clamped
        send?.invoke(AppMessage.Zoom(clamped))
    }

    /** The pause menu opened, or the app left the foreground: everything lifts and the game saves. */
    fun pause() {
        controls.releaseAll()?.let { send?.invoke(AppMessage.Input(it)) }
        if (!_state.value.paused) send?.invoke(AppMessage.Pause)
        _state.value = _state.value.copy(paused = true)
    }

    fun resume() {
        _state.value = _state.value.copy(paused = false)
    }

    /** The page is being loaded again (after a failure): back to loading, nothing held. */
    fun retry() {
        controls = TouchControls()
        _state.value = _state.value.copy(phase = GamePhase.Loading, connected = false, paused = false)
    }

    /**
     * Save, leave the world (the contract's `leave`, so others see you go), and close. Waits for the
     * page at most [timeoutMs]: a page that cannot answer must not trap the player.
     */
    suspend fun leave(timeoutMs: Long = LEAVE_TIMEOUT_MS) {
        stop()
        controls.releaseAll()?.let { send?.invoke(AppMessage.Input(it)) }
        val page = send
        if (page != null && _state.value.phase != GamePhase.Left) {
            val done = CompletableDeferred<Unit>()
            leaving = done
            page(AppMessage.Leave)
            withTimeoutOrNull(timeoutMs) { done.await() }
            leaving = null
        }
        _state.value = _state.value.copy(phase = GamePhase.Left)
    }

    // ---- relay events --------------------------------------------------------------------------

    /**
     * Each relay event is a nudge for the game to re-read the tiles. A stream that drops is opened
     * again after a pause, and the game re-reads everything ("reconnected"); polling covers the gap.
     */
    private fun startEvents() {
        if (events != null || !backend.canSubscribe) return
        events =
            scope.launch {
                var reconnect = false
                while (isActive) {
                    if (reconnect) send?.invoke(AppMessage.Event("reconnected"))
                    try {
                        backend.events(ref.contextId).collect { send?.invoke(AppMessage.Event(it.kind)) }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (_: Exception) {
                        // dropped: open it again below
                    }
                    reconnect = true
                    delay(RECONNECT_MS)
                }
            }
    }

    companion object {
        const val LEAVE_TIMEOUT_MS = 3_000L
        private const val RECONNECT_MS = 3_000L
    }
}
