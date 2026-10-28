package network.calimero.kombat.app

import kotlin.math.abs
import kotlin.math.sqrt

/**
 * One input of the web engine (`app/src/game/input.ts`, `Button`). [wire] is what the page's
 * `Controls.press` takes. Declaration order is the order presses are sent in when several change at
 * once: directions first, so a crouch that arrives with a punch makes an uppercut. (Swift `PadButton`.)
 */
enum class PadButton(
    val wire: String,
) {
    LEFT("left"),
    RIGHT("right"),
    UP("up"),
    DOWN("down"),
    PUNCH("punch"),
    KICK("kick"),
    BLOCK("block"),
    SPECIAL("special"),
}

/**
 * The right-hand cluster: the four actions the game defines, laid out the same on both platforms
 * (top row Block, Special; bottom row Punch, Kick, under the thumb). (Swift `PadAction`.)
 */
data class PadAction(
    val button: PadButton,
    val label: String,
    /** The web app's key for it (`LEGEND`). */
    val key: String,
) {
    companion object {
        val rows: List<List<PadAction>> =
            listOf(
                listOf(PadAction(PadButton.BLOCK, "Block", "L"), PadAction(PadButton.SPECIAL, "Special", "I")),
                listOf(PadAction(PadButton.PUNCH, "Punch", "J"), PadAction(PadButton.KICK, "Kick", "K")),
            )

        /** The cap under a thumb at ([x], [y]) in a cluster [width] × [height]: the 2×2 grid of [rows]. */
        fun at(
            x: Float,
            y: Float,
            width: Float,
            height: Float,
        ): PadButton = rows[if (y < height / 2) 0 else 1][if (x < width / 2) 0 else 1].button
    }
}

/**
 * The left-hand directional pad: a thumb's position becomes the held directions. 8-way, with a dead
 * zone in the middle, so resting a thumb on the pad does nothing and a diagonal is a crouch (or jump)
 * plus a step. (Swift `DPad`.)
 */
object DPad {
    /** Inside this fraction of the radius, nothing is held. */
    const val DEAD_ZONE = 0.22

    /** A direction is held when the thumb is within 67.5° of it: sin(22.5°). */
    private const val AXIS = 0.3827

    /** The directions held by a thumb [dx], [dy] from the pad's centre (y grows down). */
    fun directions(
        dx: Double,
        dy: Double,
        radius: Double,
    ): Set<PadButton> {
        val distance = sqrt(dx * dx + dy * dy)
        if (radius <= 0 || distance <= radius * DEAD_ZONE) return emptySet()
        val held = mutableSetOf<PadButton>()
        if (abs(dx) > distance * AXIS) held += if (dx < 0) PadButton.LEFT else PadButton.RIGHT
        if (abs(dy) > distance * AXIS) held += if (dy < 0) PadButton.UP else PadButton.DOWN
        return held
    }
}

/**
 * What is held across the whole pad, turned into the press messages the page needs: one `down` per
 * newly held button and one `up` per released one, never a repeat. Every change is sent the moment it
 * happens; nothing is batched or delayed. (Swift `PadTracker`.)
 */
class PadTracker {
    var held: Set<PadButton> = emptySet()
        private set

    /** Move to [next]; releases first, then presses, each in [PadButton] order. */
    fun update(next: Set<PadButton>): List<BridgeOutbound> {
        val released = (held - next).sortedBy { it.ordinal }
        val pressed = (next - held).sortedBy { it.ordinal }
        held = next
        return released.map { BridgeOutbound.Press(it, false) } + pressed.map { BridgeOutbound.Press(it, true) }
    }

    /** Let go of everything (the app went to the background, the screen closed). */
    fun releaseAll(): List<BridgeOutbound> = update(emptySet())
}
