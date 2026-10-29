@file:Suppress("MatchingDeclarationName")

package network.calimero.docs.ui

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
object DocsTheme {
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

    /** Link text: the web's accent ink (`--primary-ink`). */
    val link = Color(0xFF3451D1)

    /** A block with comments on it, tinted like the web's section wash. */
    val commentWash = Color(0x38A5FF11)
    val codeGround = Color(0xFFF3F3F0)

    val radius: Dp = 14.dp
    val hairline: Dp = 0.75.dp
    val cardShape = RoundedCornerShape(14.dp)

    /** Headings: the system face, semibold (the Mero Docs web app ships no Power Grotesk; it sets Inter). */
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
fun DocsMaterialTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme =
            lightColorScheme(
                primary = DocsTheme.ink,
                onPrimary = Color.White,
                secondary = DocsTheme.lime,
                onSecondary = DocsTheme.ink,
                background = DocsTheme.ground,
                onBackground = DocsTheme.ink,
                surface = DocsTheme.surface,
                onSurface = DocsTheme.ink,
                surfaceVariant = DocsTheme.sunken,
                onSurfaceVariant = DocsTheme.muted,
                outline = DocsTheme.lineStrong,
                error = DocsTheme.danger,
                surfaceContainerLow = DocsTheme.surface,
                surfaceContainer = DocsTheme.surface,
                surfaceContainerHigh = DocsTheme.surface,
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
                containerColor = DocsTheme.lime,
                contentColor = DocsTheme.ink,
                disabledContainerColor = DocsTheme.lime.copy(alpha = 0.45f),
                disabledContentColor = DocsTheme.ink,
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
        border = BorderStroke(DocsTheme.hairline, DocsTheme.lineStrong),
        colors = ButtonDefaults.outlinedButtonColors(containerColor = DocsTheme.surface, contentColor = DocsTheme.ink),
        modifier = modifier.then(if (fullWidth) Modifier.fillMaxWidth() else Modifier).defaultMinSize(minHeight = 44.dp),
    ) { content() }
}

/** A white card with a hairline border. */
fun Modifier.card(padding: Dp = 16.dp): Modifier =
    this
        .background(DocsTheme.surface, DocsTheme.cardShape)
        .border(DocsTheme.hairline, DocsTheme.line, DocsTheme.cardShape)
        .padding(padding)
