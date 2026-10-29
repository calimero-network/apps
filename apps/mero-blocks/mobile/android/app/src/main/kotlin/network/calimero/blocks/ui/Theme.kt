package network.calimero.blocks.ui

import android.view.HapticFeedbackConstants
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
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
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The Calimero light style: lime accent fills with ink text on them, near-black ink, white and very
 * light grey surfaces, hairline borders. Same values as the iOS app's `Theme`.
 */
object BlocksColors {
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
}

val CardShape = RoundedCornerShape(16.dp)
val ButtonShape = RoundedCornerShape(14.dp)
val Hairline: Dp = 0.75.dp

private val scheme: ColorScheme =
    lightColorScheme(
        primary = BlocksColors.Ink,
        onPrimary = BlocksColors.Surface,
        secondary = BlocksColors.Lime,
        onSecondary = BlocksColors.Ink,
        background = BlocksColors.Ground,
        onBackground = BlocksColors.Ink,
        surface = BlocksColors.Surface,
        onSurface = BlocksColors.Ink,
        surfaceVariant = BlocksColors.Sunken,
        onSurfaceVariant = BlocksColors.Muted,
        surfaceContainer = BlocksColors.Surface,
        surfaceContainerLow = BlocksColors.Ground,
        surfaceContainerHigh = BlocksColors.Surface,
        error = BlocksColors.Danger,
        outline = BlocksColors.Line,
        outlineVariant = BlocksColors.Line,
    )

@Composable
fun BlocksTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, content = content)
}

object Type {
    fun heading(size: Int) = TextStyle(fontSize = size.sp, fontWeight = FontWeight.SemiBold, color = BlocksColors.Ink)

    fun body(
        size: Int = 15,
        weight: FontWeight = FontWeight.Normal,
        color: Color = BlocksColors.Ink,
    ) = TextStyle(fontSize = size.sp, fontWeight = weight, color = color)

    val mono = TextStyle(fontSize = 12.sp, fontFamily = FontFamily.Monospace, color = BlocksColors.Ink2)
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
                .background(BlocksColors.Surface)
                .border(Hairline, BlocksColors.Line, CardShape)
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
                containerColor = BlocksColors.Lime,
                contentColor = BlocksColors.Ink,
                disabledContainerColor = BlocksColors.Lime.copy(alpha = 0.45f),
                disabledContentColor = BlocksColors.Ink.copy(alpha = 0.6f),
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
        border = BorderStroke(1.dp, BlocksColors.Line),
        colors =
            ButtonDefaults.outlinedButtonColors(
                containerColor = BlocksColors.Surface,
                contentColor = if (destructive) BlocksColors.Danger else BlocksColors.Ink,
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

/** The app mark: a block on a lime tile (iOS `AppMark`). */
@Composable
fun AppMark(size: Dp = 56.dp) {
    Box(
        modifier = Modifier.size(size).clip(RoundedCornerShape(size * 0.28f)).background(BlocksColors.Lime),
        contentAlignment = Alignment.Center,
    ) {
        BlockGlyph(Modifier.size(size * 0.62f))
    }
}

/**
 * An isometric block in ink: the top face solid, the sides lighter. The same geometry as the iOS
 * `BlockGlyph` and the launcher icon.
 */
@Composable
fun BlockGlyph(
    modifier: Modifier = Modifier,
    color: Color = BlocksColors.Ink,
) {
    Canvas(modifier) {
        val w = size.width
        val h = size.height

        fun face(
            alpha: Float,
            vararg points: Pair<Float, Float>,
        ) {
            val path =
                Path().apply {
                    moveTo(points[0].first * w, points[0].second * h)
                    points.drop(1).forEach { lineTo(it.first * w, it.second * h) }
                    close()
                }
            drawPath(path, color.copy(alpha = alpha))
        }
        face(1f, 0.5f to 0f, 1f to 0.25f, 0.5f to 0.5f, 0f to 0.25f)
        face(0.72f, 0f to 0.25f, 0.5f to 0.5f, 0.5f to 1f, 0f to 0.75f)
        face(0.5f, 0.5f to 0.5f, 1f to 0.25f, 1f to 0.75f, 0.5f to 1f)
    }
}

/** A section title inside a card. */
@Composable
fun CardTitle(
    text: String,
    trailing: String? = null,
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(text, style = Type.heading(17), modifier = Modifier.weight(1f))
        if (trailing != null) Text(trailing, style = Type.body(13, color = BlocksColors.Muted))
    }
}

/** A red banner for an error, with a dismiss button. */
@Composable
fun ErrorBanner(
    message: String,
    onDismiss: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(ButtonShape)
                .background(BlocksColors.DangerSoft)
                .padding(start = 14.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(Icons.Filled.Warning, contentDescription = null, tint = BlocksColors.Danger, modifier = Modifier.size(20.dp))
        Text(message, style = Type.body(14), modifier = Modifier.weight(1f))
        IconButton(onClick = onDismiss) {
            Icon(Icons.Filled.Close, contentDescription = "Dismiss", tint = BlocksColors.Muted, modifier = Modifier.size(18.dp))
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
        Text(label, style = Type.body(12, FontWeight.SemiBold, BlocksColors.Muted))
        Text(value, style = Type.mono)
    }
}
