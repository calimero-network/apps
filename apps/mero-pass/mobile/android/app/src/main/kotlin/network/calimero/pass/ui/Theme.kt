package network.calimero.pass.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import network.calimero.pass.core.ItemView

/**
 * Calimero light: lime accent fills with ink text on them, near-black ink, white and very light
 * grey surfaces, hairline borders. iOS `Theme.swift` holds the same values. Headings are the
 * system face, semibold: the web app ships no display face of its own.
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
    val Warn = Color(0xFF8A5A00)
    val WarnSoft = Color(0xFFFFF4D6)
    val Good = Color(0xFF1E7A3C)
    private val Fair = Color(0xFFC27C0E)

    /** A tile's background and ink from a stable hue ([ItemView.hue]). */
    fun tile(name: String): Pair<Color, Color> {
        val hue = ItemView.hue(name).toFloat()
        return hsb(hue, 0.32f, 0.97f) to hsb(hue, 0.85f, 0.38f)
    }

    /** Strength meter colour for a 0–4 score. */
    fun strength(score: Int): Color =
        when {
            score <= 1 -> Danger
            score == 2 -> Fair
            else -> Good
        }

    /** HSB (as SwiftUI's `Color(hue:saturation:brightness:)`) to a colour. */
    private fun hsb(
        hue: Float,
        saturation: Float,
        brightness: Float,
    ): Color {
        val lightness = brightness * (1 - saturation / 2)
        val sl = if (lightness == 0f || lightness == 1f) 0f else (brightness - lightness) / minOf(lightness, 1 - lightness)
        return Color.hsl(hue, sl, lightness)
    }
}

@Composable
fun PassTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme =
            lightColorScheme(
                primary = Palette.Ink,
                onPrimary = Color.White,
                primaryContainer = Palette.Lime,
                onPrimaryContainer = Palette.Ink,
                secondary = Palette.InkSoft,
                secondaryContainer = Palette.Lime,
                onSecondaryContainer = Palette.Ink,
                background = Palette.Ground,
                onBackground = Palette.Ink,
                surface = Palette.Surface,
                onSurface = Palette.Ink,
                surfaceVariant = Palette.Sunken,
                onSurfaceVariant = Palette.Muted,
                surfaceContainerLowest = Palette.Surface,
                surfaceContainerLow = Palette.Surface,
                surfaceContainer = Palette.Surface,
                surfaceContainerHigh = Palette.Surface,
                surfaceContainerHighest = Palette.Sunken,
                outline = Palette.Hairline,
                outlineVariant = Palette.Hairline,
                error = Palette.Danger,
            ),
        content = content,
    )
}
