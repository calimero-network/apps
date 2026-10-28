package network.calimero.blocks.app

import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import network.calimero.blocks.generated.BlocksClient

/**
 * One open world: gets the account into its context, then serves the game page — answers its
 * contract calls through [BridgeRouter], forwards the relay's events for the world, and tells it to
 * pause and resume. The screen owns the WebView, hands this model the page's messages ([receive])
 * and a way to deliver messages back ([outbox]). (Swift `GameModel`.)
 */
class GameModel(
    private val backend: MeroAppBackend,
    val world: WorldRef,
    myId: String,
    playerName: String,
    sensitivity: Double,
    private val scope: CoroutineScope,
) {
    sealed interface Phase {
        /** Making sure the account is a member of the world's context. */
        data object Joining : Phase

        /** The page is reading the world. */
        data object Loading : Phase

        data object Playing : Phase

        data class Failed(
            val message: String,
        ) : Phase
    }

    private val _phase = MutableStateFlow<Phase>(Phase.Joining)
    val phase: StateFlow<Phase> = _phase.asStateFlow()

    val start = GameStart(world.contextId, myId, BlocksText.playerName(playerName), world.name, BlocksText.sensitivity(sensitivity))

    /** Delivers one message (JSON text) to the page; the screen wraps it with [BridgeCodec.script]. */
    @Volatile var outbox: ((String) -> Unit)? = null
    var onMenu: (() -> Unit)? = null
    var onHaptic: ((String) -> Unit)? = null

    var pageReady = false
        private set
    var paused = false
        private set

    private val router = BridgeRouter(BlocksClient(backend.contract.bound(world.contextId)))
    private var insets = GameInsets.ZERO
    private var events: Job? = null

    /**
     * Join the world's context when the account is not in it yet (a world it was just invited to:
     * the namespace admits, the context is joined through the open subgroup).
     */
    suspend fun prepare() {
        _phase.value = Phase.Joining
        try {
            if (!backend.isMember(world.contextId)) backend.joinContext(world.contextId)
            _phase.value = Phase.Loading
        } catch (e: CancellationException) {
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            _phase.value = Phase.Failed(BlocksText.error(e))
        }
    }

    /** One message from the page. */
    suspend fun receive(text: String) {
        val request = runCatching { BridgeCodec.decode(text) }.getOrNull() ?: return
        when (request) {
            BridgeRequest.Ready -> {
                pageReady = true
                deliver(BridgeCodec.start(start, insets))
                startEvents()
            }
            BridgeRequest.Loaded -> _phase.value = Phase.Playing
            BridgeRequest.Menu -> onMenu?.invoke()
            is BridgeRequest.Haptic -> onHaptic?.invoke(request.style)
            is BridgeRequest.Fatal -> _phase.value = Phase.Failed(request.message)
            is BridgeRequest.Call -> call(request)
        }
    }

    private suspend fun call(request: BridgeRequest.Call) {
        val message =
            try {
                BridgeCodec.result(request.id, router.handle(request.op, request.method, request.argsJson))
            } catch (e: CancellationException) {
                throw e
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                BridgeCodec.failure(request.id, BlocksText.error(e))
            }
        deliver(message)
    }

    fun setInsets(value: GameInsets) {
        if (value == insets) return
        insets = value
        if (pageReady) deliver(BridgeCodec.insets(value))
    }

    fun setSensitivity(value: Double) {
        if (pageReady) deliver(BridgeCodec.settings(BlocksText.sensitivity(value)))
    }

    /** The app went to the background, or a menu covers the game. */
    fun pause() {
        if (paused) return
        paused = true
        if (pageReady) deliver(BridgeCodec.PAUSE)
    }

    fun resume() {
        if (!paused) return
        paused = false
        if (pageReady) deliver(BridgeCodec.RESUME)
    }

    /** A link that admits someone to this world. */
    suspend fun inviteLink(): String {
        val signed = backend.createInvitation(world.namespaceId)
        return BlocksInvitation(signed, world.name, world.contextId, world.groupId).link()
    }

    /** Back to [Phase.Joining] for another try after a failure. */
    suspend fun retry() {
        stop()
        pageReady = false
        paused = false
        prepare()
    }

    /**
     * Leaving the world: stop listening and mark the player as gone (best effort: the contract ages
     * out a silent player after 10 s anyway).
     */
    suspend fun leave() {
        stop()
        runCatching { router.handle(BridgeOp.EXECUTE, "leave", "{\"now\":${nowSeconds()}}") }
    }

    fun stop() {
        events?.cancel()
        events = null
    }

    /** Every relay event for the world is a nudge to re-read it; the page also polls, which covers a relay that cannot stream. */
    private fun startEvents() {
        if (events != null || !backend.canSubscribe) return
        events =
            scope.launch {
                runCatching {
                    backend.events(world.contextId).collect { event ->
                        if (!paused) deliver(BridgeCodec.event(event.kind))
                    }
                }
            }
    }

    private fun deliver(message: String) {
        outbox?.invoke(message)
    }
}
