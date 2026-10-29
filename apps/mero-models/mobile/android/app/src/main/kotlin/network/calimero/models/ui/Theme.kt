@file:Suppress("MatchingDeclarationName")

package network.calimero.models.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Calimero light: lime accent fills with ink on them, near-black text, white and very light grey
 * surfaces, hairline borders, rounded cards. iOS's `Theme.swift` holds the same values.
 */
object ModelsTheme {
    val lime = Color(0xFFA5FF11)
    val ink = Color(0xFF0B0B0C)
    val ink2 = Color(0xFF3A3B40)
    val muted = Color(0xFF6E7076)
    val faint = Color(0xFF9A9CA2)
    val ground = Color(0xFFF6F6F4)
    val surface = Color.White
    val sunken = Color(0xFFEFEFEC)
    val line = Color(0x140B0B0C)
    val lineStrong = Color(0x240B0B0C)
    val danger = Color(0xFFC2264B)

    /** A check-out by someone else: the web outliner's amber. */
    val amber = Color(0xFFB86E00)

    /** The viewport's backdrop before a scene says otherwise (the web studio's default). */
    val viewport = Color(0xFF24262B)

    val radius: Dp = 14.dp
    val hairline: Dp = 0.75.dp
    val cardShape = RoundedCornerShape(14.dp)

    /** Headings: the system face, semibold (the web ships no Power Grotesk). */
    fun heading(size: Int) = TextStyle(fontSize = size.sp, fontWeight = FontWeight.SemiBold, color = ink)

    fun body(
        size: Int = 15,
        weight: FontWeight = FontWeight.Normal,
        color: Color = ink2,
    ) = TextStyle(fontSize = size.sp, fontWeight = weight, color = color)

    /** A colour per member, stable and identical on iOS. */
    fun memberColor(id: String): Color {
        val palette = listOf(0xFF3E63F5, 0xFFE5484D, 0xFF12A594, 0xFFF76B15, 0xFF8E4EC6, 0xFFD6409F, 0xFF0090FF, 0xFF46A758)
        var sum = 0
        for (ch in id) sum = (sum * 31 + ch.code) and 0x7FFFFFFF
        return Color(palette[sum % palette.size])
    }
}

@Composable
fun ModelsMaterialTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme =
            lightColorScheme(
                primary = ModelsTheme.ink,
                onPrimary = Color.White,
                secondary = ModelsTheme.lime,
                onSecondary = ModelsTheme.ink,
                background = ModelsTheme.ground,
                onBackground = ModelsTheme.ink,
                surface = ModelsTheme.surface,
                onSurface = ModelsTheme.ink,
                surfaceVariant = ModelsTheme.sunken,
                onSurfaceVariant = ModelsTheme.muted,
                outline = ModelsTheme.lineStrong,
                error = ModelsTheme.danger,
                surfaceContainerLow = ModelsTheme.surface,
                surfaceContainer = ModelsTheme.surface,
                surfaceContainerHigh = ModelsTheme.surface,
            ),
        content = content,
    )
}

/** Lime fill, ink text: the primary action. */
@Composable
fun PrimaryButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    fullWidth: Boolean = true,
    content: @Composable () -> Unit,
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(14.dp),
        colors =
            ButtonDefaults.buttonColors(
                containerColor = ModelsTheme.lime,
                contentColor = ModelsTheme.ink,
                disabledContainerColor = ModelsTheme.lime.copy(alpha = 0.45f),
                disabledContentColor = ModelsTheme.ink,
            ),
        contentPadding = PaddingValues(horizontal = 20.dp),
        modifier = modifier.then(if (fullWidth) Modifier.fillMaxWidth() else Modifier).defaultMinSize(minHeight = 50.dp),
    ) { content() }
}

/** White fill, hairline border. */
@Composable
fun SecondaryButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    fullWidth: Boolean = true,
    content: @Composable () -> Unit,
) {
    OutlinedButton(
        onClick = onClick,
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(ModelsTheme.hairline, ModelsTheme.lineStrong),
        colors = ButtonDefaults.outlinedButtonColors(containerColor = ModelsTheme.surface, contentColor = ModelsTheme.ink),
        modifier = modifier.then(if (fullWidth) Modifier.fillMaxWidth() else Modifier).defaultMinSize(minHeight = 44.dp),
    ) { content() }
}

/** A white card with a hairline border. */
fun Modifier.card(padding: Dp = 16.dp): Modifier =
    this
        .background(ModelsTheme.surface, ModelsTheme.cardShape)
        .border(ModelsTheme.hairline, ModelsTheme.line, ModelsTheme.cardShape)
        .padding(padding)
