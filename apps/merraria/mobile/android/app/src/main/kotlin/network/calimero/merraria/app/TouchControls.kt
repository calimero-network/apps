package network.calimero.merraria.app

import kotlin.math.roundToLong

/** The on-screen buttons. Same set and names as the iOS app's `GameButton`. */
enum class GameButton { LEFT, RIGHT, JUMP, MINE, PLACE }

/**
 * The touch layer: which buttons are held, turned into what the game reads. The web game is
 * keyboard and mouse; this is its D-pad (left/right; the game has no use for down), jump, mine (the
 * left mouse button, held) and place (the right one, held). (Swift `TouchControls`.)
 *
 * Every change produces one [GameInput] to send; nothing is sent while nothing changes.
 */
class TouchControls {
    private val _held = mutableSetOf<GameButton>()
    val held: Set<GameButton> get() = _held.toSet()

    /** What the game reads now (no jump edge: that only rides on the press that made it). */
    val input: GameInput get() = input(jumpPressed = false)

    /** A finger went down on [button]. Null when it was already held (a second finger). */
    fun press(button: GameButton): GameInput? {
        if (!_held.add(button)) return null
        return input(jumpPressed = button == GameButton.JUMP)
    }

    /** The finger on [button] lifted. Null when it was not held. */
    fun release(button: GameButton): GameInput? {
        if (!_held.remove(button)) return null
        return input(jumpPressed = false)
    }

    /** Everything lifts (the app went to the background, the pause menu opened). Null when nothing was held. */
    fun releaseAll(): GameInput? {
        if (_held.isEmpty()) return null
        _held.clear()
        return GameInput.IDLE
    }

    private fun input(jumpPressed: Boolean): GameInput {
        val move = (if (GameButton.RIGHT in _held) 1 else 0) - (if (GameButton.LEFT in _held) 1 else 0)
        val mine = GameButton.MINE in _held
        return GameInput(
            move = move,
            jump = GameButton.JUMP in _held,
            jumpPressed = jumpPressed,
            mine = mine,
            // Both held: mining wins, as the web game checks the left button first.
            place = GameButton.PLACE in _held && !mine,
        )
    }

    companion object {
        /**
         * A tap on the game view, at ([x], [y]) in the view's own units, as the page's CSS pixels:
         * [unitsPerCssPixel] is the display density on Android (pixels) and 1 on iOS (points).
         */
        fun tapTarget(
            x: Double,
            y: Double,
            unitsPerCssPixel: Double = 1.0,
        ): AppMessage {
            val scale = if (unitsPerCssPixel > 0) unitsPerCssPixel else 1.0
            return AppMessage.Target((x / scale).roundToLong().toDouble(), (y / scale).roundToLong().toDouble())
        }

        /** The hotbar slot to select, kept inside the hotbar. Null for an empty hotbar. */
        fun select(
            slot: Int,
            slotCount: Int,
        ): AppMessage.Select? = if (slotCount <= 0) null else AppMessage.Select(slot.coerceIn(0, slotCount - 1))
    }
}
