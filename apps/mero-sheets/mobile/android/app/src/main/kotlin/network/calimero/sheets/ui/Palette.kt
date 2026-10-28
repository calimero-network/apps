package network.calimero.sheets.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The Calimero light look: lime fills with ink on them, near-black text, white cards with hairline
 * borders on a very light grey ground. The same values as the iOS app's `Theme`.
 */
object Palette {
    val lime = Color(0xFFA5FF11)
    val ink = Color(0xFF0B0B0C)
    val ground = Color(0xFFF5F6F8)
    val surface = Color.White
    val sunken = Color(0xFFF0F1F4)
    val line = Color(0xFFE3E5EA)
    val lineStrong = Color(0xFFCDD0D7)
    val text2 = Color(0xFF4A4D55)
    val text3 = Color(0xFF868B95)
    val danger = Color(0xFFC2304A)

    val radius = 14.dp
    val gutter = 16.dp

    /** Chart series, in the web's categorical order (`--c-series-1…8` in `app/src/index.css`). */
    val series =
        listOf(0xFF2A78D6, 0xFFEB6834, 0xFF1BAF7A, 0xFFEDA100, 0xFFE87BA4, 0xFF008300, 0xFF4A3AA7, 0xFFE34948).map { Color(it) }

    /** Grid chrome: header fill, and the comment marker. */
    val header = Color(0xFFF5F6F8)
    val marker = Color(0xFFEDA100)

    /** The web's eight label/avatar swatches. */
    val swatches =
        listOf(0xFFA5FF3F, 0xFF5FA8D3, 0xFFC77DBB, 0xFF8B9AA8, 0xFF6E8BB5, 0xFFE0A04B, 0xFF7FC96B, 0xFFB47FD6).map { Color(it) }

    val semibold = FontWeight.SemiBold

    fun heading(size: Int): TextUnit = size.sp
}

@Composable
fun SheetsTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme =
            lightColorScheme(
                primary = Palette.ink,
                onPrimary = Color.White,
                primaryContainer = Palette.lime,
                onPrimaryContainer = Palette.ink,
                secondaryContainer = Palette.lime,
                onSecondaryContainer = Palette.ink,
                background = Palette.ground,
                onBackground = Palette.ink,
                surface = Palette.ground,
                onSurface = Palette.ink,
                surfaceVariant = Palette.sunken,
                onSurfaceVariant = Palette.text2,
                surfaceContainer = Palette.surface,
                surfaceContainerLow = Palette.surface,
                surfaceContainerHigh = Palette.surface,
                surfaceContainerHighest = Palette.sunken,
                outline = Palette.lineStrong,
                outlineVariant = Palette.line,
                error = Palette.danger,
            ),
        content = content,
    )
}
