package network.calimero.kombat.app

import org.junit.Assert.assertEquals
import org.junit.Test

/** The fight pad → game input mapping. The iOS `FightPadTests` assert the same cases. */
class FightPadTest {
    @Test
    fun `every button is one the engine reads`() {
        // `Button` in app/src/game/input.ts.
        assertEquals(listOf("left", "right", "up", "down", "punch", "kick", "block", "special"), PadButton.entries.map { it.wire })
        assertEquals(
            listOf(PadButton.BLOCK, PadButton.SPECIAL, PadButton.PUNCH, PadButton.KICK),
            PadAction.rows.flatten().map { it.button },
        )
        assertEquals("the web app's legend", listOf("L", "I", "J", "K"), PadAction.rows.flatten().map { it.key })
    }

    @Test
    fun `the action cluster is a two by two grid`() {
        assertEquals(PadButton.BLOCK, PadAction.at(10f, 10f, 156f, 156f))
        assertEquals(PadButton.SPECIAL, PadAction.at(140f, 10f, 156f, 156f))
        assertEquals(PadButton.PUNCH, PadAction.at(10f, 140f, 156f, 156f))
        assertEquals(PadButton.KICK, PadAction.at(140f, 140f, 156f, 156f))
    }

    @Test
    fun `dpad has a dead zone`() {
        assertEquals(emptySet<PadButton>(), DPad.directions(0.0, 0.0, 60.0))
        assertEquals(emptySet<PadButton>(), DPad.directions(10.0, -5.0, 60.0))
    }

    @Test
    fun `dpad cardinals`() {
        assertEquals(setOf(PadButton.RIGHT), DPad.directions(50.0, 0.0, 60.0))
        assertEquals(setOf(PadButton.LEFT), DPad.directions(-50.0, 0.0, 60.0))
        assertEquals(setOf(PadButton.UP), DPad.directions(0.0, -50.0, 60.0))
        assertEquals(setOf(PadButton.DOWN), DPad.directions(0.0, 50.0, 60.0))
    }

    @Test
    fun `dpad diagonals and near misses`() {
        assertEquals("crouch-walk", setOf(PadButton.RIGHT, PadButton.DOWN), DPad.directions(40.0, 40.0, 60.0))
        assertEquals("jump back", setOf(PadButton.LEFT, PadButton.UP), DPad.directions(-40.0, -40.0, 60.0))
        // 15° above horizontal is still a walk, not a jump: a sloppy thumb must not hop.
        assertEquals(setOf(PadButton.RIGHT), DPad.directions(50.0, -13.0, 60.0))
        // Beyond the rim still counts.
        assertEquals(setOf(PadButton.RIGHT), DPad.directions(200.0, 0.0, 60.0))
    }

    @Test
    fun `tracker sends each change once`() {
        val pad = PadTracker()
        assertEquals(listOf(BridgeOutbound.Press(PadButton.RIGHT, true)), pad.update(setOf(PadButton.RIGHT)))
        assertEquals("holding is not re-sent", emptyList<BridgeOutbound>(), pad.update(setOf(PadButton.RIGHT)))
        assertEquals(
            "crouch before punch: an uppercut",
            listOf(BridgeOutbound.Press(PadButton.DOWN, true), BridgeOutbound.Press(PadButton.PUNCH, true)),
            pad.update(setOf(PadButton.RIGHT, PadButton.DOWN, PadButton.PUNCH)),
        )
        assertEquals(
            listOf(BridgeOutbound.Press(PadButton.RIGHT, false), BridgeOutbound.Press(PadButton.PUNCH, false)),
            pad.update(setOf(PadButton.DOWN)),
        )
        assertEquals(listOf(BridgeOutbound.Press(PadButton.DOWN, false)), pad.releaseAll())
        assertEquals(emptySet<PadButton>(), pad.held)
        assertEquals(emptyList<BridgeOutbound>(), pad.releaseAll())
    }
}
