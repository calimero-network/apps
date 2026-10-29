package network.calimero.sign.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily

/**
 * Calimero light: lime accent fills with ink text on them, near-black ink, white and very light
 * grey surfaces, hairline borders. iOS `Theme.swift` holds the same values.
 */
object Palette {
    val Lime = Color(0xFFA5FF11)
    val LimeSoft = Color(0xFFEEFFD1)
    val Ink = Color(0xFF0B0B0C)
    val InkSoft = Color(0xFF3C4049)
    val Muted = Color(0xFF6B7080)
    val Ground = Color(0xFFF5F6F8)
    val Surface = Color.White
    val Sunken = Color(0xFFF0F1F4)
    val Hairline = Color(0xFFE3E5EA)
    val Danger = Color(0xFFC2214E)
    val DangerSoft = Color(0xFFFFE7EC)

    /** Waiting on somebody: the web's `--glass-wait-ink` on a soft amber. */
    val Wait = Color(0xFF6B4E00)
    val WaitSoft = Color(0xFFFFF1C2)

    /** Done: the web's `--glass-good-ink` on a soft green. */
    val Good = Color(0xFF0B6B43)
    val GoodSoft = Color(0xFFD9F5E6)

    /** Avatar tones, picked by `SignFormat.tone`: background, ink. */
    val Tones =
        listOf(
            Color(0xFFE4F9C4) to Color(0xFF2F5000),
            Color(0xFFDDE7FF) to Color(0xFF23408F),
            Color(0xFFFFE4D1) to Color(0xFF8A3B0B),
            Color(0xFFF3DDFB) to Color(0xFF6A1E86),
            Color(0xFFD5F4EE) to Color(0xFF0D5E50),
            Color(0xFFFFF1C2) to Color(0xFF6B4E00),
        )
}

/**
 * Headings: the system face, semibold. The web app ships no display face of its own (Figtree
 * for everything), so there is none to bundle. (iOS `Typeface.display`.)
 */
val Display = FontFamily.Default

@Composable
fun SignTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme =
            lightColorScheme(
                primary = Palette.Ink,
                onPrimary = Color.White,
                primaryContainer = Palette.Lime,
                onPrimaryContainer = Palette.Ink,
                secondary = Palette.InkSoft,
                background = Palette.Ground,
                onBackground = Palette.Ink,
                surface = Palette.Surface,
                onSurface = Palette.Ink,
                surfaceVariant = Palette.Sunken,
                onSurfaceVariant = Palette.Muted,
                surfaceContainerLow = Palette.Surface,
                surfaceContainer = Palette.Surface,
                surfaceContainerHigh = Palette.Surface,
                outline = Palette.Hairline,
                outlineVariant = Palette.Hairline,
                error = Palette.Danger,
            ),
        content = content,
    )
}
