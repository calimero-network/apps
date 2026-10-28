@file:Suppress("MatchingDeclarationName")

package network.calimero.battleships.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import network.calimero.battleships.R

/**
 * Calimero light: lime accent fills with ink text on them, near-black ink, white and very light
 * grey surfaces, hairline borders. The board keeps the web app's content colours (hit red, miss
 * blue, pending amber). iOS `Theme.swift` holds the same values.
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

    // The board.
    val Water = Color(0xFFF2F4F7)
    val Ship = Color(0xFF2B2F38)
    val Hit = Color(0xFFC81E1E)
    val Sunk = Color(0xFF7A1010)
    val Miss = Color(0xFF2563A8)
    val Pending = Color(0xFFA16207)
    val PendingSoft = Color(0xFFFFF1C2)
}

private const val SEMIBOLD = 600
private const val BOLD = 700
private const val REGULAR = 400

/** Figtree, the web app's face (packages/glass), bundled as a variable font. */
@OptIn(ExperimentalTextApi::class)
val Display =
    FontFamily(
        Font(R.font.figtree, FontWeight.Normal, variationSettings = FontVariation.Settings(FontVariation.weight(REGULAR))),
        Font(R.font.figtree, FontWeight.SemiBold, variationSettings = FontVariation.Settings(FontVariation.weight(SEMIBOLD))),
        Font(R.font.figtree, FontWeight.Bold, variationSettings = FontVariation.Settings(FontVariation.weight(BOLD))),
    )

@Composable
fun BattleshipsTheme(content: @Composable () -> Unit) {
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
