package network.calimero.chess.ui

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
import network.calimero.chess.R

/**
 * The Calimero light style: lime accent fills with ink text on them, near-black ink, white and very
 * light grey surfaces, hairline borders. Same values as the iOS app's `Theme`.
 */
object ChessColors {
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

    // The board: flat squares, the light one near-white, the dark one a quiet sage grey. Lime marks
    // what is selected and what just moved.
    val SquareLight = Color(0xFFEEF0E8)
    val SquareDark = Color(0xFFB7C1AA)
    val SquareSelected = Color(0xBFA5FF11)
    val SquareLast = Color(0x61A5FF11)
    val SquareHint = Color(0x330B0B0C)
    val SquareCheck = Color(0xD9E5484D)
}

val CardShape = RoundedCornerShape(16.dp)
val ButtonShape = RoundedCornerShape(14.dp)
val Hairline: Dp = 0.75.dp

private val scheme: ColorScheme =
    lightColorScheme(
        primary = ChessColors.Ink,
        onPrimary = ChessColors.Surface,
        secondary = ChessColors.Lime,
        onSecondary = ChessColors.Ink,
        background = ChessColors.Ground,
        onBackground = ChessColors.Ink,
        surface = ChessColors.Surface,
        onSurface = ChessColors.Ink,
        surfaceVariant = ChessColors.Sunken,
        onSurfaceVariant = ChessColors.Muted,
        surfaceContainer = ChessColors.Surface,
        surfaceContainerLow = ChessColors.Ground,
        surfaceContainerHigh = ChessColors.Surface,
        error = ChessColors.Danger,
        outline = ChessColors.Line,
        outlineVariant = ChessColors.Line,
    )

@Composable
fun ChessTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, content = content)
}

object Type {
    fun heading(size: Int) = TextStyle(fontSize = size.sp, fontWeight = FontWeight.SemiBold, color = ChessColors.Ink)

    fun body(
        size: Int = 15,
        weight: FontWeight = FontWeight.Normal,
        color: Color = ChessColors.Ink,
    ) = TextStyle(fontSize = size.sp, fontWeight = weight, color = color)

    val mono = TextStyle(fontSize = 12.sp, fontFamily = FontFamily.Monospace, color = ChessColors.Ink2)
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
                .background(ChessColors.Surface)
                .border(Hairline, ChessColors.Line, CardShape)
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
                containerColor = ChessColors.Lime,
                contentColor = ChessColors.Ink,
                disabledContainerColor = ChessColors.Lime.copy(alpha = 0.45f),
                disabledContentColor = ChessColors.Ink.copy(alpha = 0.6f),
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
        border = BorderStroke(1.dp, ChessColors.Line),
        colors =
            ButtonDefaults.outlinedButtonColors(
                containerColor = ChessColors.Surface,
                contentColor = if (destructive) ChessColors.Danger else ChessColors.Ink,
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

/** One piece of the Chessnut set (res/drawable/piece_*.xml). */
@Composable
fun PieceImage(
    assetName: String,
    modifier: Modifier = Modifier,
) {
    Image(painter = painterResource(pieceDrawable(assetName)), contentDescription = null, modifier = modifier)
}

fun pieceDrawable(assetName: String): Int =
    when (assetName) {
        "wK" -> R.drawable.piece_wk
        "wQ" -> R.drawable.piece_wq
        "wR" -> R.drawable.piece_wr
        "wB" -> R.drawable.piece_wb
        "wN" -> R.drawable.piece_wn
        "wP" -> R.drawable.piece_wp
        "bK" -> R.drawable.piece_bk
        "bQ" -> R.drawable.piece_bq
        "bR" -> R.drawable.piece_br
        "bB" -> R.drawable.piece_bb
        "bN" -> R.drawable.piece_bn
        else -> R.drawable.piece_bp
    }

/** The app mark: a knight on a lime tile. */
@Composable
fun AppMark(size: Dp = 56.dp) {
    Box(
        modifier = Modifier.size(size).clip(RoundedCornerShape(size * 0.28f)).background(ChessColors.Lime),
        contentAlignment = Alignment.Center,
    ) {
        PieceImage("bN", Modifier.padding(size * 0.16f))
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
        if (trailing != null) Text(trailing, style = Type.body(13, color = ChessColors.Muted))
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
                .background(ChessColors.DangerSoft)
                .padding(start = 14.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(Icons.Filled.Warning, contentDescription = null, tint = ChessColors.Danger, modifier = Modifier.size(20.dp))
        Text(message, style = Type.body(14), modifier = Modifier.weight(1f))
        IconButton(onClick = onDismiss) {
            Icon(Icons.Filled.Close, contentDescription = "Dismiss", tint = ChessColors.Muted, modifier = Modifier.size(18.dp))
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
        Text(label, style = Type.body(12, FontWeight.SemiBold, ChessColors.Muted))
        Text(value, style = Type.mono)
    }
}
