package network.calimero.kombat.ui

import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.SportsMartialArts
import androidx.compose.material.icons.filled.SportsMma
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import network.calimero.kombat.app.BridgeOutbound
import network.calimero.kombat.app.DPad
import network.calimero.kombat.app.PadAction
import network.calimero.kombat.app.PadButton
import network.calimero.kombat.app.PadTracker

/**
 * The fight pad's state: what each thumb holds, merged and sent to the page the moment it changes.
 * Touches are read in the pointer-input pass itself (no click or gesture detector in between), so a
 * press reaches the page on the frame it happened; the game then runs it locally and only the finished
 * action goes out. (iOS `FightPad`.)
 */
class FightPad {
    var held by mutableStateOf(emptySet<PadButton>())
        private set
    private var directions = emptySet<PadButton>()
    private var actions = emptySet<PadButton>()
    private val tracker = PadTracker()
    var send: ((BridgeOutbound) -> Unit)? = null
    var view: View? = null

    fun setDirections(next: Set<PadButton>) {
        directions = next
        flush()
    }

    fun setActions(next: Set<PadButton>) {
        val fresh = (next - actions).isNotEmpty()
        actions = next
        if (fresh) view?.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
        flush()
    }

    /** Let go of everything: the app went to the background, a sheet opened, the screen closed. */
    fun releaseAll() {
        directions = emptySet()
        actions = emptySet()
        flush()
    }

    private fun flush() {
        val next = directions + actions
        tracker.update(next).forEach { send?.invoke(it) }
        if (held != next) held = next
    }
}

/** Material Symbols for the actions; iOS `PadSymbols` maps the same four to SF Symbols. */
object PadIcons {
    fun icon(button: PadButton): ImageVector =
        when (button) {
            PadButton.PUNCH -> Icons.Filled.SportsMma
            PadButton.KICK -> Icons.Filled.SportsMartialArts
            PadButton.BLOCK -> Icons.Filled.Shield
            PadButton.SPECIAL -> Icons.Filled.Bolt
            PadButton.UP -> Icons.Filled.KeyboardArrowUp
            PadButton.DOWN -> Icons.Filled.KeyboardArrowDown
            PadButton.LEFT -> Icons.Filled.KeyboardArrowLeft
            PadButton.RIGHT -> Icons.Filled.KeyboardArrowRight
        }
}

/** Every finger on this surface, as positions, on every pointer event. */
private fun Modifier.touches(onChange: (List<Pair<Float, Float>>, Float, Float) -> Unit): Modifier =
    pointerInput(Unit) {
        awaitPointerEventScope {
            while (true) {
                val event = awaitPointerEvent(PointerEventPass.Initial)
                val down = event.changes.filter { it.pressed }.map { it.position.x to it.position.y }
                event.changes.forEach { it.consume() }
                onChange(down, size.width.toFloat(), size.height.toFloat())
            }
        }
    }

/** Left thumb: the directional pad. (iOS `DPadView`.) */
@Composable
fun DPadView(
    pad: FightPad,
    size: Dp = 156.dp,
) {
    Box(
        Modifier
            .size(size)
            .clip(CircleShape)
            .background(KombatColors.PadFill)
            .border(1.dp, KombatColors.PadLine, CircleShape)
            .semantics { contentDescription = "Directional pad" }
            .touches { points, width, height ->
                val held = mutableSetOf<PadButton>()
                points.forEach { (x, y) ->
                    held += DPad.directions((x - width / 2).toDouble(), (y - height / 2).toDouble(), (minOf(width, height) / 2).toDouble())
                }
                pad.setDirections(held)
            },
        contentAlignment = Alignment.Center,
    ) {
        Arrow(pad, PadButton.UP, size, 0f, -1f)
        Arrow(pad, PadButton.DOWN, size, 0f, 1f)
        Arrow(pad, PadButton.LEFT, size, -1f, 0f)
        Arrow(pad, PadButton.RIGHT, size, 1f, 0f)
        Box(Modifier.size(size * 0.2f).clip(CircleShape).background(KombatColors.PadLine))
    }
}

@Composable
private fun Arrow(
    pad: FightPad,
    button: PadButton,
    size: Dp,
    x: Float,
    y: Float,
) {
    val on = button in pad.held
    Box(
        Modifier
            .offset(x = size * 0.31f * x, y = size * 0.31f * y)
            .size(size * 0.34f)
            .clip(CircleShape)
            .background(if (on) KombatColors.PadPressed else KombatColors.PadFill.copy(alpha = 0f)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(PadIcons.icon(button), contentDescription = null, tint = if (on) KombatColors.Ink else KombatColors.OnStage, modifier = Modifier.size(size * 0.2f))
    }
}

/** Right thumb: the four actions, Block and Special over Punch and Kick. (iOS `ActionPadView`.) */
@Composable
fun ActionPadView(
    pad: FightPad,
    size: Dp = 156.dp,
) {
    Box(
        Modifier
            .size(size)
            .semantics { contentDescription = "Punch, kick, block and special" }
            .touches { points, width, height ->
                pad.setActions(points.map { (x, y) -> PadAction.at(x, y, width, height) }.toSet())
            },
        contentAlignment = Alignment.Center,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(size * 0.06f)) {
            PadAction.rows.forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(size * 0.06f)) {
                    row.forEach { action -> Cap(pad, action, size * 0.47f) }
                }
            }
        }
    }
}

@Composable
private fun Cap(
    pad: FightPad,
    action: PadAction,
    diameter: Dp,
) {
    val on = action.button in pad.held
    Box(
        Modifier
            .size(diameter)
            .scale(if (on) 0.94f else 1f)
            .clip(CircleShape)
            .background(if (on) KombatColors.PadPressed else KombatColors.PadFill)
            .border(1.dp, if (on) KombatColors.Lime else KombatColors.PadLine, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            val tint = if (on) KombatColors.Ink else KombatColors.OnStage
            Icon(PadIcons.icon(action.button), contentDescription = null, tint = tint, modifier = Modifier.size(diameter * 0.32f))
            Text(
                action.label.uppercase(),
                style = TextStyle(fontSize = (diameter.value * 0.15f).sp, fontWeight = FontWeight.Bold, letterSpacing = 0.4.sp, color = tint),
            )
        }
    }
}
