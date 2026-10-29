package network.calimero.vote.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import network.calimero.vote.R

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
    val Success = Color(0xFF2F7D1F)
    val SuccessSoft = Color(0xFFE9F9D4)
    val Warning = Color(0xFF8A5A00)
    val WarningSoft = Color(0xFFFFF3D6)
    val Info = Color(0xFF23408F)
    val InfoSoft = Color(0xFFE5ECFF)

    /** Avatar tones, picked by `VoteFormat.tone`: background, ink. */
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

/** Power Grotesk, the web app's display face (app/public/fonts/powerGrotesk). */
val Display =
    FontFamily(
        Font(R.font.power_grotesk_regular, FontWeight.Normal),
        Font(R.font.power_grotesk_bold, FontWeight.Bold),
    )

@Composable
fun VoteTheme(content: @Composable () -> Unit) {
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
