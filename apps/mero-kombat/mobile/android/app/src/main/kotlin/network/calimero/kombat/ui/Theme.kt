package network.calimero.kombat.ui

import android.view.HapticFeedbackConstants
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.QuestionMark
import androidx.compose.material.icons.filled.SportsMartialArts
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import network.calimero.kombat.R
import network.calimero.kombat.app.FighterInfo

/**
 * The Calimero light style: lime accent fills with ink text on them, near-black ink, white and very
 * light grey surfaces, hairline borders. Same values as the iOS app's `Theme`. The fight screen is the
 * one dark surface: the arena is a night stage.
 */
object KombatColors {
    val Lime = Color(0xFFA5FF11)
    val Ink = Color(0xFF0B0B0C)
    val Ink2 = Color(0xFF3A3B40)
    val Muted = Color(0xFF6E7077)
    val Ground = Color(0xFFF5F6F3)
    val Surface = Color.White
    val Sunken = Color(0xFFEEF0EB)
    val Line = Color(0x1A0B0B0C)
    val Danger = Color(0xFFC62828)
    val DangerSoft = Color(0xFFFDECEC)
    val Online = Color(0xFF22C55E)
    val LimeSoft = Color(0x38A5FF11)

    // The fight screen.
    val Stage = Color(0xFF0B0B0C)
    val PadFill = Color(0x1AFFFFFF)
    val PadPressed = Color(0xD9A5FF11)
    val PadLine = Color(0x38FFFFFF)
    val OnStage = Color(0xEBFFFFFF)
    val OnStageMuted = Color(0x99FFFFFF)
}

val CardShape = RoundedCornerShape(16.dp)
val ButtonShape = RoundedCornerShape(14.dp)
val Hairline: Dp = 0.75.dp

/** Power Grotesk, the web app's display face (app/public/fonts/powerGrotesk). */
val PowerGrotesk =
    FontFamily(
        Font(R.font.power_grotesk_regular, FontWeight.Normal),
        Font(R.font.power_grotesk_bold, FontWeight.Bold),
    )

private val scheme: ColorScheme =
    lightColorScheme(
        primary = KombatColors.Ink,
        onPrimary = KombatColors.Surface,
        secondary = KombatColors.Lime,
        onSecondary = KombatColors.Ink,
        background = KombatColors.Ground,
        onBackground = KombatColors.Ink,
        surface = KombatColors.Surface,
        onSurface = KombatColors.Ink,
        surfaceVariant = KombatColors.Sunken,
        onSurfaceVariant = KombatColors.Muted,
        surfaceContainer = KombatColors.Surface,
        surfaceContainerLow = KombatColors.Ground,
        surfaceContainerHigh = KombatColors.Surface,
        error = KombatColors.Danger,
        outline = KombatColors.Line,
        outlineVariant = KombatColors.Line,
    )

@Composable
fun KombatTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, content = content)
}

object Type {
    fun heading(
        size: Int,
        color: Color = KombatColors.Ink,
    ) = TextStyle(fontSize = size.sp, fontFamily = PowerGrotesk, fontWeight = FontWeight.Bold, color = color)

    fun body(
        size: Int = 15,
        weight: FontWeight = FontWeight.Normal,
        color: Color = KombatColors.Ink,
    ) = TextStyle(fontSize = size.sp, fontWeight = weight, color = color)

    val mono = TextStyle(fontSize = 12.sp, fontFamily = FontFamily.Monospace, color = KombatColors.Ink2)
}

/** A white card with a hairline border. */
@Composable
fun Card(
    modifier: Modifier = Modifier,
    padding: Dp = 16.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .clip(CardShape)
                .background(KombatColors.Surface)
                .border(Hairline, KombatColors.Line, CardShape)
                .padding(padding),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        content = content,
    )
}

/** Lime fill, ink text: the one primary action on a screen. */
@Composable
fun PrimaryButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    fullWidth: Boolean = true,
    content: @Composable RowScope.() -> Unit,
) {
    val view = LocalView.current
    Button(
        onClick = {
            view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
            onClick()
        },
        modifier = (if (fullWidth) modifier.fillMaxWidth() else modifier).heightIn(min = 48.dp),
        enabled = enabled,
        shape = ButtonShape,
        colors =
            ButtonDefaults.buttonColors(
                containerColor = KombatColors.Lime,
                contentColor = KombatColors.Ink,
                disabledContainerColor = KombatColors.Lime.copy(alpha = 0.45f),
                disabledContentColor = KombatColors.Ink.copy(alpha = 0.6f),
            ),
        contentPadding = PaddingValues(horizontal = 18.dp),
        content = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                content()
            }
        },
    )
}

/** White with a hairline border: every other action. */
@Composable
fun SecondaryButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    fullWidth: Boolean = true,
    destructive: Boolean = false,
    content: @Composable RowScope.() -> Unit,
) {
    OutlinedButton(
        onClick = onClick,
        modifier = (if (fullWidth) modifier.fillMaxWidth() else modifier).heightIn(min = 44.dp),
        enabled = enabled,
        shape = ButtonShape,
        border = BorderStroke(1.dp, KombatColors.Line),
        colors =
            ButtonDefaults.outlinedButtonColors(
                containerColor = KombatColors.Surface,
                contentColor = if (destructive) KombatColors.Danger else KombatColors.Ink,
            ),
        contentPadding = PaddingValues(horizontal = 16.dp),
        content = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                content()
            }
        },
    )
}

/** The text inside a button. */
@Composable
fun ButtonLabel(text: String) {
    Text(text, style = Type.body(15, FontWeight.SemiBold, Color.Unspecified))
}

/** The app mark: a fighter on a lime tile. */
@Composable
fun AppMark(size: Dp = 56.dp) {
    Box(
        modifier = Modifier.size(size).clip(RoundedCornerShape(size * 0.28f)).background(KombatColors.Lime),
        contentAlignment = Alignment.Center,
    ) {
        Icon(Icons.Filled.SportsMartialArts, contentDescription = null, tint = KombatColors.Ink, modifier = Modifier.size(size * 0.6f))
    }
}

/**
 * A fighter's tile: a dark plate in their costume colour with the fighter figure on it. An empty corner
 * is a sunken tile with a question mark. (iOS `FighterBadge`.)
 */
@Composable
fun FighterBadge(
    fighter: String?,
    size: Dp = 44.dp,
    mirrored: Boolean = false,
    modifier: Modifier = Modifier,
) {
    val info = fighter?.takeIf { it.isNotEmpty() }?.let { FighterInfo.of(it) }
    Box(
        modifier = modifier.size(size).clip(RoundedCornerShape(size * 0.27f)).background(if (info == null) KombatColors.Sunken else KombatColors.Stage),
        contentAlignment = Alignment.Center,
    ) {
        if (info != null) {
            Icon(
                Icons.Filled.SportsMartialArts,
                contentDescription = null,
                tint = Color(0xFF000000 or info.color),
                modifier = Modifier.size(size * 0.6f).graphicsLayer { scaleX = if (mirrored) -1f else 1f },
            )
        } else {
            Icon(Icons.Filled.QuestionMark, contentDescription = null, tint = KombatColors.Muted, modifier = Modifier.size(size * 0.42f))
        }
    }
}

/** A red banner for an error, with a dismiss button. */
@Composable
fun ErrorBanner(
    message: String,
    modifier: Modifier = Modifier,
    onDismiss: () -> Unit,
) {
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .clip(ButtonShape)
                .background(KombatColors.DangerSoft)
                .padding(start = 14.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(Icons.Filled.Warning, contentDescription = null, tint = KombatColors.Danger, modifier = Modifier.size(20.dp))
        Text(message, style = Type.body(14), modifier = Modifier.weight(1f))
        IconButton(onClick = onDismiss) {
            Icon(Icons.Filled.Close, contentDescription = "Dismiss", tint = KombatColors.Muted, modifier = Modifier.size(18.dp))
        }
    }
}

/** A technical value (an id), shown behind a Details disclosure. */
@Composable
fun DetailRow(
    label: String,
    value: String,
) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = Type.body(12, FontWeight.SemiBold, KombatColors.Muted))
        Text(value, style = Type.mono)
    }
}
