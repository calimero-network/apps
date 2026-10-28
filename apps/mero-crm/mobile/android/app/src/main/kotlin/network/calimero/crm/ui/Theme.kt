package network.calimero.crm.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.CheckBox
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Event
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.KeyboardArrowUp
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import network.calimero.crm.core.ActivityKind
import network.calimero.crm.core.DealHealth
import network.calimero.crm.core.DueTone
import network.calimero.crm.core.HealthLevel

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
    val limeSoft = Color(0xFFEEFFD0)
    val good = Color(0xFF1F9A5B)
    val goodSoft = Color(0xFFE6F5EC)
    val warn = Color(0xFFB86E0F)
    val warnSoft = Color(0xFFFBF0E1)
    val danger = Color(0xFFD0384D)
    val dangerSoft = Color(0xFFFCEBED)

    fun health(level: HealthLevel): Color =
        when (level) {
            HealthLevel.HEALTHY -> good
            HealthLevel.AT_RISK -> warn
            HealthLevel.CRITICAL -> danger
        }

    fun tone(tone: DueTone): Pair<Color, Color> =
        when (tone) {
            DueTone.OVERDUE -> danger to dangerSoft
            DueTone.TODAY -> ink to lime
            DueTone.SOON -> ink to sunken
            DueTone.LATER -> ink2 to sunken
        }
}

/** Material twins of the iOS app's SF Symbols for the activity kinds. */
fun kindIcon(raw: String): ImageVector =
    when (ActivityKind.of(raw)) {
        ActivityKind.CALL -> Icons.Outlined.Phone
        ActivityKind.MEETING -> Icons.Outlined.Event
        ActivityKind.TASK -> Icons.Outlined.CheckBox
        ActivityKind.EMAIL -> Icons.Outlined.Email
        ActivityKind.DEADLINE -> Icons.Outlined.Flag
        null -> Icons.Outlined.Circle
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
fun CrmTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = colors, content = content)
}

/** A white card with a hairline border and 14dp corners. */
@Composable
fun CrmCard(
    modifier: Modifier = Modifier,
    padding: Dp = 16.dp,
    spacing: Dp = 12.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        color = Palette.surface,
        border = BorderStroke(1.dp, Palette.hairline),
    ) {
        Column(Modifier.padding(padding), verticalArrangement = Arrangement.spacedBy(spacing), content = content)
    }
}

/** A card's title row: icon, title, trailing note, and an optional action at the end. */
@Composable
fun CardTitle(
    title: String,
    icon: ImageVector? = null,
    trailing: String? = null,
    action: (@Composable () -> Unit)? = null,
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = Palette.ink, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
        }
        Text(title, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, modifier = Modifier.weight(1f))
        if (trailing != null) Text(trailing, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink3)
        if (action != null) {
            Spacer(Modifier.width(8.dp))
            action()
        }
    }
}

/** "OVERDUE · 3": 13sp semibold uppercase. */
@Composable
fun SectionLabel(
    text: String,
    modifier: Modifier = Modifier,
    trailing: String? = null,
    color: Color = Palette.ink2,
) {
    Row(modifier.fillMaxWidth().padding(top = 8.dp, bottom = 2.dp, start = 4.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text.uppercase(), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.6.sp, color = color, modifier = Modifier.weight(1f))
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
        modifier = modifier.fillMaxWidth().height(50.dp),
        shape = RoundedCornerShape(14.dp),
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

/** A secondary action: hairline outline, ink (or tinted) text. */
@Composable
fun SecondaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    icon: ImageVector? = null,
    color: Color = Palette.ink,
    compact: Boolean = false,
) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.height(if (compact) 40.dp else 46.dp),
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, Palette.hairline),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = color, containerColor = Palette.surface),
        contentPadding = PaddingValues(horizontal = if (compact) 10.dp else 16.dp),
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
        }
        Text(text, fontWeight = FontWeight.SemiBold, fontSize = if (compact) 14.sp else 16.sp, maxLines = 1)
    }
}

/** A small pill button, for "Schedule in 2d". */
@Composable
fun SmallButton(
    text: String,
    onClick: () -> Unit,
    filled: Boolean = true,
    enabled: Boolean = true,
    icon: ImageVector? = null,
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(999.dp),
        color = if (filled) Palette.lime else Palette.sunken,
        contentColor = Palette.ink.copy(alpha = if (enabled) 1f else 0.4f),
    ) {
        Row(Modifier.heightIn(min = 32.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            if (icon != null) {
                Icon(icon, contentDescription = null, Modifier.size(14.dp))
                Spacer(Modifier.width(4.dp))
            }
            Text(text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        }
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
        Text(text, color = color, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
    }
}

/** A selectable pill: filters, kinds, stages. Lime when selected. */
@Composable
fun Chip(
    text: String,
    selected: Boolean = false,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    count: Int? = null,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(999.dp),
        color = if (selected) Palette.lime else Palette.surface,
        contentColor = Palette.ink,
        border = if (selected) null else BorderStroke(1.dp, Palette.hairline),
        modifier = modifier,
    ) {
        Row(Modifier.heightIn(min = 34.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            if (icon != null) {
                Icon(icon, contentDescription = null, Modifier.size(15.dp))
                Spacer(Modifier.width(6.dp))
            }
            Text(text, fontSize = 14.sp, fontWeight = FontWeight.Medium, maxLines = 1)
            if (count != null) {
                Spacer(Modifier.width(6.dp))
                Text("$count", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = if (selected) Palette.ink else Palette.ink3)
            }
        }
    }
}

/** Pills that wrap onto as many lines as they need. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun FlowChips(
    items: List<String>,
    selected: String,
    onTap: (String) -> Unit,
) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (item in items) Chip(item, selected = item == selected) { onTap(item) }
    }
}

/** A static label pill. */
@Composable
fun Pill(
    text: String,
    icon: ImageVector? = null,
    fg: Color = Palette.ink2,
    bg: Color = Palette.sunken,
) {
    Row(
        Modifier.clip(RoundedCornerShape(999.dp)).background(bg).padding(horizontal = 8.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = fg, modifier = Modifier.size(12.dp))
            Spacer(Modifier.width(4.dp))
        }
        Text(text, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
fun StatusPill(status: String) {
    when (status) {
        "won" -> Pill("Won", Icons.Outlined.Check, Palette.good, Palette.goodSoft)
        "lost" -> Pill("Lost", Icons.Outlined.Close, Palette.danger, Palette.dangerSoft)
        else -> Pill("Open", fg = Palette.ink, bg = Palette.limeSoft)
    }
}

@Composable
fun HealthDot(health: DealHealth) {
    Box(Modifier.size(8.dp).clip(CircleShape).background(Palette.health(health.level)))
}

/** Initials on a soft colour from the seed. */
@Composable
fun Avatar(
    seed: String,
    size: Dp = 36.dp,
) {
    val hue = avatarHue(seed).toFloat()
    Box(Modifier.size(size).clip(CircleShape).background(Color.hsl(hue, 0.70f, 0.90f)), contentAlignment = Alignment.Center) {
        Text(initials(seed), color = Color.hsl(hue, 0.45f, 0.28f), fontSize = (size.value * 0.38f).sp, fontWeight = FontWeight.SemiBold)
    }
}

fun initials(name: String): String =
    name
        .trim()
        .split(Regex("\\s+"))
        .take(2)
        .mapNotNull { it.firstOrNull()?.uppercase() }
        .joinToString("")
        .ifEmpty { "?" }

fun avatarHue(seed: String): Int {
    var h = 0u
    for (b in seed.toByteArray()) h = h * 31u + (b.toInt() and 0xff).toUInt()
    return (h % 360u).toInt()
}

/** An empty state: icon, title, message, centred. */
@Composable
fun EmptyState(
    icon: ImageVector,
    title: String,
    message: String? = null,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxWidth().padding(vertical = 28.dp, horizontal = 16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(56.dp).clip(RoundedCornerShape(16.dp)).background(Palette.sunken), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = Palette.ink2, modifier = Modifier.size(28.dp))
        }
        Spacer(Modifier.height(10.dp))
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
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(Palette.dangerSoft)
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Outlined.ErrorOutline, contentDescription = null, tint = Palette.danger, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(8.dp))
        Text(text, color = Palette.danger, fontSize = 14.sp)
    }
}

/** A key–value line in a details card. */
@Composable
fun InfoRow(
    label: String,
    value: String,
    valueColor: Color = Palette.ink,
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Text(label, fontSize = 15.sp, color = Palette.ink2)
        Spacer(Modifier.width(12.dp).weight(1f))
        Text(value, fontSize = 15.sp, fontWeight = FontWeight.Medium, color = valueColor, textAlign = TextAlign.End)
    }
}

/** A value and what it is, in a pill: "3 open deals". */
@Composable
fun StatPill(
    value: String,
    label: String,
) {
    Row(
        Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(Palette.surface)
            .border(1.dp, Palette.hairline, RoundedCornerShape(999.dp))
            .padding(horizontal = 12.dp, vertical = 7.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        Text(value, fontSize = 15.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.width(5.dp))
        Text(label, fontSize = 13.sp, color = Palette.ink2)
    }
}

/** Copyable technical values, behind a "Details" disclosure. */
@Composable
fun DetailsDisclosure(
    rows: List<Pair<String, String>>,
    onCopy: (String) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    CrmCard(padding = 14.dp, spacing = 10.dp) {
        Row(Modifier.fillMaxWidth().clickable { open = !open }, verticalAlignment = Alignment.CenterVertically) {
            Text("Details", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink2, modifier = Modifier.weight(1f))
            Icon(if (open) Icons.Outlined.KeyboardArrowUp else Icons.Outlined.KeyboardArrowDown, contentDescription = null, tint = Palette.ink2)
        }
        if (open) {
            for ((label, value) in rows) {
                Column(Modifier.fillMaxWidth().clickable { onCopy(value) }) {
                    Text(label, fontSize = 12.sp, color = Palette.ink2)
                    Text(value, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
                }
            }
            Text("Tap a value to copy it.", fontSize = 12.sp, color = Palette.ink3)
        }
    }
}

@Composable
fun Divider() = HorizontalDivider(color = Palette.hairline, thickness = 1.dp)
