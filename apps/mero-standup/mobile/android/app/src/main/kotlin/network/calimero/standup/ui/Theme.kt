package network.calimero.standup.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import network.calimero.standup.core.People

/** The Calimero light palette (same values as the iOS app's Theme.swift). */
object Palette {
    val ink = Color(0xFF0B0B0C)
    val ink2 = Color(0xFF5B5E66)
    val ink3 = Color(0xFF8E9199)
    val background = Color(0xFFF6F7F8)
    val surface = Color(0xFFFFFFFF)
    val sunken = Color(0xFFEFF0F2)
    val hairline = Color(0xFFE3E5E8)
    val lime = Color(0xFFA5FF11)
    val danger = Color(0xFFD93A2B)
    val dangerSoft = Color(0xFFFDECEA)
}

private val colors =
    lightColorScheme(
        primary = Palette.lime,
        onPrimary = Palette.ink,
        secondary = Palette.ink,
        onSecondary = Palette.surface,
        background = Palette.background,
        onBackground = Palette.ink,
        surface = Palette.surface,
        onSurface = Palette.ink,
        surfaceVariant = Palette.sunken,
        onSurfaceVariant = Palette.ink2,
        surfaceContainer = Palette.surface,
        surfaceContainerLow = Palette.surface,
        surfaceContainerHigh = Palette.surface,
        surfaceContainerHighest = Palette.sunken,
        outline = Palette.hairline,
        outlineVariant = Palette.hairline,
        error = Palette.danger,
        primaryContainer = Palette.lime,
        onPrimaryContainer = Palette.ink,
        secondaryContainer = Palette.lime,
        onSecondaryContainer = Palette.ink,
    )

@Composable
fun StandupTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = colors, content = content)
}

/** A white card with a hairline border and 14dp corners. */
@Composable
fun StandupCard(
    modifier: Modifier = Modifier,
    padding: Dp = 16.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        color = Palette.surface,
        border = BorderStroke(1.dp, Palette.hairline),
    ) {
        Column(Modifier.padding(padding), verticalArrangement = Arrangement.spacedBy(10.dp), content = content)
    }
}

/** "TEAM", "NOT POSTED YET": 13sp semibold uppercase, ink-2. */
@Composable
fun SectionLabel(
    text: String,
    modifier: Modifier = Modifier,
    trailing: String? = null,
) {
    Row(modifier.fillMaxWidth().padding(top = 8.dp, bottom = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text.uppercase(), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.6.sp, color = Palette.ink2, modifier = Modifier.weight(1f))
        if (trailing != null) Text(trailing, fontSize = 13.sp, color = Palette.ink3)
    }
}

/** The primary action: lime fill, ink text. */
@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    busy: Boolean = false,
    icon: ImageVector? = null,
) {
    Button(
        onClick = onClick,
        enabled = enabled && !busy,
        modifier = modifier.height(50.dp),
        shape = RoundedCornerShape(12.dp),
        colors =
            ButtonDefaults.buttonColors(
                containerColor = Palette.lime,
                contentColor = Palette.ink,
                disabledContainerColor = Palette.lime.copy(alpha = 0.45f),
                disabledContentColor = Palette.ink.copy(alpha = 0.5f),
            ),
        contentPadding = PaddingValues(horizontal = 20.dp),
    ) {
        if (busy) {
            CircularProgressIndicator(Modifier.size(16.dp), color = Palette.ink, strokeWidth = 2.dp)
            Spacer(Modifier.width(8.dp))
        } else if (icon != null) {
            Icon(icon, contentDescription = null, Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
        }
        Text(text, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
    }
}

/** A secondary action: hairline outline, ink text. */
@Composable
fun SecondaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    icon: ImageVector? = null,
    color: Color = Palette.ink,
) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.height(44.dp),
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, Palette.hairline),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = color, containerColor = Palette.surface),
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
        }
        Text(text, fontWeight = FontWeight.Medium)
    }
}

/** A quiet text action. */
@Composable
fun LinkButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    color: Color = Palette.ink,
    enabled: Boolean = true,
) {
    TextButton(onClick = onClick, modifier = modifier, enabled = enabled, contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp)) {
        Text(text, color = color, fontWeight = FontWeight.Medium, fontSize = 14.sp)
    }
}

/** A circle with initials, coloured from the account. */
@Composable
fun Avatar(
    account: String,
    name: String?,
    size: Dp = 36.dp,
) {
    val hue = People.avatarHue(account).toFloat()
    Box(
        Modifier.size(size).clip(CircleShape).background(Color.hsl(hue, 0.70f, 0.88f)),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            People.initials(account, name),
            color = Color.hsl(hue, 0.45f, 0.28f),
            fontSize = (size.value * 0.38f).sp,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

/** A pill: "Posted", "Standing" (lime) or "Superseded" (sunken). */
@Composable
fun Badge(
    text: String,
    lime: Boolean = true,
) {
    Text(
        text,
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        color = if (lime) Palette.ink else Palette.ink2,
        modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(if (lime) Palette.lime else Palette.sunken).padding(horizontal = 10.dp, vertical = 3.dp),
    )
}

/** A chip: tag filter, person, "I can help". Lime when selected. */
@Composable
fun Chip(
    text: String,
    selected: Boolean = false,
    modifier: Modifier = Modifier,
    leading: (@Composable () -> Unit)? = null,
    trailing: String? = null,
    onClick: (() -> Unit)? = null,
) {
    Surface(
        onClick = onClick ?: {},
        enabled = onClick != null,
        shape = RoundedCornerShape(999.dp),
        color = if (selected) Palette.lime else Palette.sunken,
        contentColor = Palette.ink,
        modifier = modifier,
    ) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
            if (leading != null) {
                leading()
                Spacer(Modifier.width(6.dp))
            }
            Text(text, fontSize = 14.sp, fontWeight = FontWeight.Medium)
            if (trailing != null) {
                Spacer(Modifier.width(4.dp))
                Text(trailing, fontSize = 13.sp, color = Palette.ink2)
            }
        }
    }
}

/** An empty state: icon, title, message, centered. */
@Composable
fun EmptyState(
    icon: ImageVector,
    title: String,
    message: String? = null,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxWidth().padding(vertical = 32.dp, horizontal = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(56.dp).clip(RoundedCornerShape(16.dp)).background(Palette.sunken), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = Palette.ink2, modifier = Modifier.size(28.dp))
        }
        Spacer(Modifier.height(12.dp))
        Text(title, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, textAlign = TextAlign.Center)
        if (message != null) {
            Spacer(Modifier.height(4.dp))
            Text(message, color = Palette.ink2, fontSize = 15.sp, textAlign = TextAlign.Center)
        }
    }
}

/** An inline error. */
@Composable
fun ErrorLine(text: String?) {
    if (text.isNullOrEmpty()) return
    Text(
        text,
        color = Palette.danger,
        fontSize = 14.sp,
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(10.dp))
                .background(Palette.dangerSoft)
                .padding(10.dp),
    )
}

/** Muted body text. */
@Composable
fun Muted(
    text: String,
    modifier: Modifier = Modifier,
) {
    Text(text, color = Palette.ink2, fontSize = 15.sp, modifier = modifier)
}

/** A hairline-bordered rounded box (for labelled field groups). */
fun Modifier.hairline(): Modifier = this.border(1.dp, Palette.hairline, RoundedCornerShape(10.dp))

/**
 * Reads [values] in the caller's composition, so it recomposes when they change: for the models'
 * derived properties (`mine`, `waiting`, `draft`), which read several flows at once.
 */
@Suppress("UNUSED_PARAMETER")
@Composable
fun Track(vararg values: Any?) {
    // Nothing to draw: passing the values is the read.
}
