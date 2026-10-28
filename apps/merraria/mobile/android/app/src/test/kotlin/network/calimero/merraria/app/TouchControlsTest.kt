package network.calimero.merraria.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TouchControlsTest {
    @Test
    fun `dpad moves and cancels out`() {
        val controls = TouchControls()
        assertEquals(GameInput(move = -1), controls.press(GameButton.LEFT))
        assertEquals(GameInput(move = 0), controls.press(GameButton.RIGHT))
        assertEquals(GameInput(move = 1), controls.release(GameButton.LEFT))
        assertEquals(GameInput.IDLE, controls.release(GameButton.RIGHT))
    }

    @Test
    fun `jump is an edge on the press and a level while held`() {
        val controls = TouchControls()
        assertEquals(GameInput(jump = true, jumpPressed = true), controls.press(GameButton.JUMP))
        assertEquals(GameInput(move = 1, jump = true), controls.press(GameButton.RIGHT))
        assertEquals(GameInput(move = 1, jump = true), controls.input)
        assertEquals(GameInput(move = 1), controls.release(GameButton.JUMP))
    }

    @Test
    fun `mine and place are held and mining wins`() {
        val controls = TouchControls()
        assertEquals(GameInput(place = true), controls.press(GameButton.PLACE))
        assertEquals(GameInput(mine = true, place = false), controls.press(GameButton.MINE))
        assertEquals(GameInput(place = true), controls.release(GameButton.MINE))
    }

    @Test
    fun `repeats and stray releases send nothing`() {
        val controls = TouchControls()
        assertNull(controls.release(GameButton.MINE))
        assertNotNull(controls.press(GameButton.MINE))
        assertNull(controls.press(GameButton.MINE))
        assertNull(TouchControls().releaseAll())
    }

    @Test
    fun `release all lifts everything`() {
        val controls = TouchControls()
        controls.press(GameButton.LEFT)
        controls.press(GameButton.MINE)
        assertEquals(GameInput.IDLE, controls.releaseAll())
        assertTrue(controls.held.isEmpty())
    }

    @Test
    fun `taps become css pixels`() {
        assertEquals(AppMessage.Target(120.0, 65.0), TouchControls.tapTarget(120.4, 64.6))
        assertEquals(AppMessage.Target(100.0, 50.0), TouchControls.tapTarget(300.0, 150.0, 3.0))
        assertEquals(AppMessage.Target(10.0, 20.0), TouchControls.tapTarget(10.0, 20.0, 0.0))
    }

    @Test
    fun `hotbar selection stays in the hotbar`() {
        assertEquals(AppMessage.Select(4), TouchControls.select(4, 9))
        assertEquals(AppMessage.Select(8), TouchControls.select(12, 9))
        assertEquals(AppMessage.Select(0), TouchControls.select(-1, 9))
        assertNull(TouchControls.select(0, 0))
    }

    @Test
    fun `seeds are read like the web app`() {
        assertEquals(1337uL, MerrariaConstants.seed("1337", 1uL))
        assertEquals(43uL, MerrariaConstants.seed("-42.9", 1uL))
        assertEquals(7uL, MerrariaConstants.seed("abc", 7uL))
        assertEquals(7uL, MerrariaConstants.seed("0", 7uL))
    }
}
