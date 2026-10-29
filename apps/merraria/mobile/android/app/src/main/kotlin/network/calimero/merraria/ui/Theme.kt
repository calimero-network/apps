package network.calimero.merraria.ui

import android.view.HapticFeedbackConstants
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
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
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import network.calimero.merraria.R

/**
 * The Calimero light style for the shell: lime accent fills with ink text on them, near-black ink,
 * white and very light grey surfaces, hairline borders. The game keeps its own look; its controls are
 * dark glass with lime when held. Same values as the iOS app's `Theme`.
 */
object MerrariaColors {
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

    /** The game's own night-sky ground (`app/index.html`), behind the page while it loads. */
    val GameGround = Color(0xFF0B140E)

    /** On-screen controls: dark glass, a white hairline, white icons; lime while held. */
    val Control = Color(0x6B0B0B0C)
    val ControlLine = Color(0x47FFFFFF)
}

val CardShape = RoundedCornerShape(16.dp)
val ButtonShape = RoundedCornerShape(14.dp)
val Hairline: Dp = 0.75.dp

private val scheme: ColorScheme =
    lightColorScheme(
        primary = MerrariaColors.Ink,
        onPrimary = MerrariaColors.Surface,
        secondary = MerrariaColors.Lime,
        onSecondary = MerrariaColors.Ink,
        background = MerrariaColors.Ground,
        onBackground = MerrariaColors.Ink,
        surface = MerrariaColors.Surface,
        onSurface = MerrariaColors.Ink,
        surfaceVariant = MerrariaColors.Sunken,
        onSurfaceVariant = MerrariaColors.Muted,
        surfaceContainer = MerrariaColors.Surface,
        surfaceContainerLow = MerrariaColors.Ground,
        surfaceContainerHigh = MerrariaColors.Surface,
        error = MerrariaColors.Danger,
        outline = MerrariaColors.Line,
        outlineVariant = MerrariaColors.Line,
    )

@Composable
fun MerrariaTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, content = content)
}

object Type {
    fun heading(size: Int) = TextStyle(fontSize = size.sp, fontWeight = FontWeight.SemiBold, color = MerrariaColors.Ink)

    fun body(
        size: Int = 15,
        weight: FontWeight = FontWeight.Normal,
        color: Color = MerrariaColors.Ink,
    ) = TextStyle(fontSize = size.sp, fontWeight = weight, color = color)

    val mono = TextStyle(fontSize = 12.sp, fontFamily = FontFamily.Monospace, color = MerrariaColors.Ink2)
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
                .background(MerrariaColors.Surface)
                .border(Hairline, MerrariaColors.Line, CardShape)
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
                containerColor = MerrariaColors.Lime,
                contentColor = MerrariaColors.Ink,
                disabledContainerColor = MerrariaColors.Lime.copy(alpha = 0.45f),
                disabledContentColor = MerrariaColors.Ink.copy(alpha = 0.6f),
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
        border = BorderStroke(1.dp, MerrariaColors.Line),
        colors =
            ButtonDefaults.outlinedButtonColors(
                containerColor = MerrariaColors.Surface,
                contentColor = if (destructive) MerrariaColors.Danger else MerrariaColors.Ink,
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

/** The app mark: the web app's grass block and pickaxe (`app/public/favicon.svg`). */
@Composable
fun AppMark(size: Dp = 56.dp) {
    Image(painter = painterResource(R.drawable.app_mark), contentDescription = null, modifier = Modifier.size(size))
}

/** One hotbar tile's colour swatch, as the web HUD draws it. */
@Composable
fun TileSwatch(
    color: Long,
    size: Dp = 20.dp,
) {
    val shape = RoundedCornerShape(size * 0.18f)
    Box(
        Modifier
            .size(size)
            .clip(shape)
            .background(Color(0xFF000000 or color))
            .border(0.75.dp, Color(0x40000000), shape),
    )
}

/** A section title inside a card. */
@Composable
fun CardTitle(
    text: String,
    trailing: String? = null,
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(text, style = Type.heading(17), modifier = Modifier.weight(1f))
        if (trailing != null) Text(trailing, style = Type.body(13, color = MerrariaColors.Muted))
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
                .background(MerrariaColors.DangerSoft)
                .padding(start = 14.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(Icons.Filled.Warning, contentDescription = null, tint = MerrariaColors.Danger, modifier = Modifier.size(20.dp))
        Text(message, style = Type.body(14), modifier = Modifier.weight(1f))
        IconButton(onClick = onDismiss) {
            Icon(Icons.Filled.Close, contentDescription = "Dismiss", tint = MerrariaColors.Muted, modifier = Modifier.size(18.dp))
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
        Text(label, style = Type.body(12, FontWeight.SemiBold, MerrariaColors.Muted))
        Text(value, style = Type.mono)
    }
}
