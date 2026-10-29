package network.calimero.calendar.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Calimero light: lime fills with ink on them, near-black ink text, white cards on a light ground, hairlines. */
object Tokens {
    val lime = Color(0xFFA5FF11)
    val ink = Color(0xFF0B0B0C)
    val ground = Color(0xFFF6F7F8)
    val surface = Color(0xFFFFFFFF)
    val sunken = Color(0xFFF0F1F3)
    val line = Color(0x140B0B0C)
    val muted = Color(0xFF6B6F76)
    val faint = Color(0xFF9A9EA6)
    val danger = Color(0xFFE5484D)
    val now = Color(0xFFE5484D)

    val cardRadius = 14.dp
    val fieldRadius = 12.dp
    val gutter = 16.dp
    val hairline = 1.dp

    val title = TextStyle(fontSize = 28.sp, fontWeight = FontWeight.SemiBold, color = ink, letterSpacing = (-0.4).sp)
    val heading = TextStyle(fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = ink)
    val body = TextStyle(fontSize = 15.sp, color = ink)
    val caption = TextStyle(fontSize = 13.sp, color = muted)
    val label = TextStyle(fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = muted, letterSpacing = 0.6.sp)

    /** An event color from its stored `#rrggbb`, the default blue when unreadable. */
    fun eventColor(hex: String): Color {
        val clean = hex.trim().removePrefix("#")
        val value = clean.toLongOrNull(16) ?: return Color(0xFF3B6FE0)
        return if (clean.length == 6) Color(0xFF000000 or value) else Color(0xFF3B6FE0)
    }
}

@Composable
fun CalendarTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme =
            lightColorScheme(
                primary = Tokens.ink,
                onPrimary = Color.White,
                primaryContainer = Tokens.lime,
                onPrimaryContainer = Tokens.ink,
                secondary = Tokens.ink,
                secondaryContainer = Tokens.lime,
                onSecondaryContainer = Tokens.ink,
                tertiary = Tokens.ink,
                background = Tokens.ground,
                onBackground = Tokens.ink,
                surface = Tokens.surface,
                onSurface = Tokens.ink,
                surfaceVariant = Tokens.sunken,
                onSurfaceVariant = Tokens.muted,
                surfaceContainer = Tokens.surface,
                surfaceContainerHigh = Tokens.surface,
                surfaceContainerHighest = Tokens.sunken,
                surfaceContainerLow = Tokens.surface,
                outline = Tokens.line,
                outlineVariant = Tokens.line,
                error = Tokens.danger,
            ),
        content = content,
    )
}
