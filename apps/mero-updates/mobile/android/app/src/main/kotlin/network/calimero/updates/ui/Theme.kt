package network.calimero.updates.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.TrendingDown
import androidx.compose.material.icons.automirrored.outlined.TrendingFlat
import androidx.compose.material.icons.automirrored.outlined.TrendingUp
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import network.calimero.updates.R
import network.calimero.updates.core.Catalog
import network.calimero.updates.core.Metrics
import network.calimero.updates.core.People
import network.calimero.updates.generated.CategoryView

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
    val good = Color(0xFF0B6B43)
    val goodSoft = Color(0xFFE3F5EC)
    val warn = Color(0xFF6B4E00)
    val warnSoft = Color(0xFFFFF3D1)
    val danger = Color(0xFFD93A2B)
    val dangerSoft = Color(0xFFFDECEA)
}

/** Power Grotesk, the web app's display face, for headings. */
val Display = FontFamily(Font(R.font.power_grotesk_regular, FontWeight.Normal), Font(R.font.power_grotesk_bold, FontWeight.Bold))

fun displayStyle(size: TextUnit) = TextStyle(fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = size, color = Palette.ink)

/** A category's colour, or the faint ink when it has none. */
fun cssColor(css: String): Color = Catalog.rgb(css)?.let { Color(0xFF000000 or it) } ?: Palette.ink3

private val colors =
    lightColorScheme(
        primary = Palette.ink,
        onPrimary = Palette.surface,
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
fun UpdatesTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = colors, content = content)
}

/** A white card with a hairline border and 14dp corners. */
@Composable
fun UpdatesCard(
    modifier: Modifier = Modifier,
    padding: Dp = 16.dp,
    background: Color = Palette.surface,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val shape = RoundedCornerShape(14.dp)
    Surface(
        modifier = modifier.fillMaxWidth().clip(shape).then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier),
        shape = shape,
        color = background,
        border = BorderStroke(1.dp, Palette.hairline),
    ) {
        Column(Modifier.padding(padding), verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
    }
}

/** "TEAM", "DRAFTS": 13sp semibold uppercase, ink-2. */
@Composable
fun SectionLabel(
    text: String,
    modifier: Modifier = Modifier,
    trailing: String? = null,
) {
    Row(modifier.fillMaxWidth().padding(start = 4.dp, end = 4.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text.uppercase(), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.6.sp, color = Palette.ink2, modifier = Modifier.weight(1f))
        if (trailing != null) Text(trailing, fontSize = 13.sp, color = Palette.ink3)
    }
}

/** A screen's heading and the line under it. */
@Composable
fun PageHeader(
    title: String,
    subtitle: String,
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title, style = displayStyle(28.sp))
        Text(subtitle, fontSize = 15.sp, color = Palette.ink2)
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
    compact: Boolean = false,
) {
    Button(
        onClick = onClick,
        enabled = enabled && !busy,
        modifier = modifier.height(if (compact) 36.dp else 50.dp),
        shape = RoundedCornerShape(if (compact) 10.dp else 14.dp),
        colors =
            ButtonDefaults.buttonColors(
                containerColor = Palette.lime,
                contentColor = Palette.ink,
                disabledContainerColor = Palette.lime.copy(alpha = 0.45f),
                disabledContentColor = Palette.ink.copy(alpha = 0.5f),
            ),
        contentPadding = PaddingValues(horizontal = if (compact) 14.dp else 20.dp),
    ) {
        if (busy) {
            CircularProgressIndicator(Modifier.size(16.dp), color = Palette.ink, strokeWidth = 2.dp)
            Spacer(Modifier.width(8.dp))
        } else if (icon != null) {
            Icon(icon, contentDescription = null, Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
        }
        Text(text, fontWeight = FontWeight.SemiBold, fontSize = if (compact) 14.sp else 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
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
    compact: Boolean = false,
) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.height(if (compact) 36.dp else 46.dp),
        shape = RoundedCornerShape(if (compact) 10.dp else 14.dp),
        border = BorderStroke(1.dp, Palette.hairline),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = color, containerColor = Palette.surface),
        contentPadding = PaddingValues(horizontal = if (compact) 12.dp else 16.dp),
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
        }
        Text(text, fontWeight = FontWeight.SemiBold, fontSize = if (compact) 14.sp else 16.sp, maxLines = 1)
    }
}

/** A quiet text action: "Reply", "Edit note", "Undo". */
@Composable
fun LinkButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    color: Color = Palette.ink2,
    enabled: Boolean = true,
) {
    TextButton(onClick = onClick, modifier = modifier, enabled = enabled, contentPadding = PaddingValues(horizontal = 4.dp, vertical = 0.dp)) {
        Text(text, color = color, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
    }
}

/** A circle with initials; lime for the team. */
@Composable
fun Avatar(
    account: String,
    name: String,
    team: Boolean = false,
    size: Dp = 36.dp,
) {
    val hue = People.avatarHue(account).toFloat()
    Box(
        Modifier.size(size).clip(CircleShape).background(if (team) Palette.lime else Color.hsv(hue, 0.25f, 0.96f)),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            People.initials(name, account),
            color = if (team) Palette.ink else Color.hsv(hue, 0.6f, 0.35f),
            fontSize = (size.value * 0.38f).sp,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

enum class BadgeTone { LIME, MUTED, GOOD, WARN }

/** A pill: "New", "Answered", "Draft". */
@Composable
fun Badge(
    text: String,
    tone: BadgeTone = BadgeTone.LIME,
    icon: ImageVector? = null,
) {
    val (fg, bg) =
        when (tone) {
            BadgeTone.LIME -> Palette.ink to Palette.lime
            BadgeTone.MUTED -> Palette.ink2 to Palette.sunken
            BadgeTone.GOOD -> Palette.good to Palette.goodSoft
            BadgeTone.WARN -> Palette.warn to Palette.warnSoft
        }
    Row(
        Modifier.clip(RoundedCornerShape(999.dp)).background(bg).padding(horizontal = 8.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = fg, modifier = Modifier.size(12.dp))
            Spacer(Modifier.width(4.dp))
        }
        Text(text, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = fg)
    }
}

/** A chip: filters, "I can help". Lime when selected. */
@Composable
fun Chip(
    text: String,
    selected: Boolean = false,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    count: ULong = 0uL,
    onClick: (() -> Unit)? = null,
) {
    Surface(
        onClick = onClick ?: {},
        enabled = onClick != null,
        shape = RoundedCornerShape(999.dp),
        color = if (selected) Palette.lime else Palette.sunken,
        contentColor = Palette.ink,
        modifier = modifier.height(34.dp),
    ) {
        Row(Modifier.padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            if (icon != null) {
                Icon(icon, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
            }
            Text(text, fontSize = 14.sp, fontWeight = FontWeight.Medium, maxLines = 1)
            if (count > 0uL) {
                Spacer(Modifier.width(6.dp))
                Text("$count", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = Palette.ink2)
            }
        }
    }
}

/** A category: its colour dot, emoji and name. */
@Composable
fun CategoryChip(
    category: CategoryView,
    selected: Boolean = false,
    count: ULong = 0uL,
    suffix: String = "",
    onClick: (() -> Unit)? = null,
) {
    Surface(
        onClick = onClick ?: {},
        enabled = onClick != null,
        shape = RoundedCornerShape(999.dp),
        color = if (selected) Palette.lime else Palette.sunken,
        contentColor = Palette.ink,
        modifier = Modifier.height(if (onClick == null) 24.dp else 32.dp),
    ) {
        Row(Modifier.padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(8.dp).clip(CircleShape).background(cssColor(category.color)))
            Spacer(Modifier.width(6.dp))
            if (category.emoji.isNotEmpty()) {
                Text(category.emoji, fontSize = 13.sp)
                Spacer(Modifier.width(4.dp))
            }
            Text(category.name + suffix, fontSize = 13.sp, fontWeight = FontWeight.Medium, maxLines = 1)
            if (count > 0uL) {
                Spacer(Modifier.width(4.dp))
                Text("$count", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Palette.ink2)
            }
        }
    }
}

/** An icon on a rounded tile, for headers and empty states. */
@Composable
fun IconTile(
    icon: ImageVector,
    accent: Boolean = false,
    size: Dp = 40.dp,
) {
    Box(
        Modifier.size(size).clip(RoundedCornerShape(size / 3.5f)).background(if (accent) Palette.lime else Palette.sunken),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = Palette.ink, modifier = Modifier.size(size * 0.5f))
    }
}

/** An empty state: icon, title, message, centered. */
@Composable
fun EmptyState(
    icon: ImageVector,
    title: String,
    message: String? = null,
) {
    Column(Modifier.fillMaxWidth().padding(vertical = 24.dp, horizontal = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        IconTile(icon, size = 52.dp)
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
    Row(verticalAlignment = Alignment.Top) {
        Icon(Icons.Outlined.ErrorOutline, contentDescription = null, tint = Palette.danger, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(6.dp))
        Text(text, color = Palette.danger, fontSize = 13.sp)
    }
}

/** A grey placeholder while the first read is in flight. */
@Composable
fun SkeletonCard(height: Dp = 120.dp) {
    Box(
        Modifier
            .fillMaxWidth()
            .height(height)
            .clip(RoundedCornerShape(14.dp))
            .background(Palette.sunken),
    )
}

/** A grey rounded input with a length cap. */
@Composable
fun InputField(
    value: String,
    onChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    maxLength: Int = 20_000,
    singleLine: Boolean = true,
    minLines: Int = 1,
    maxLines: Int = if (singleLine) 1 else Int.MAX_VALUE,
    textStyle: TextStyle = TextStyle(fontSize = 16.sp, color = Palette.ink),
) {
    TextField(
        value = value,
        onValueChange = { onChange(it.take(maxLength)) },
        placeholder = { Text(placeholder, color = Palette.ink3, style = textStyle) },
        singleLine = singleLine,
        minLines = minLines,
        maxLines = maxLines,
        textStyle = textStyle,
        shape = RoundedCornerShape(10.dp),
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
        colors =
            TextFieldDefaults.colors(
                focusedContainerColor = Palette.sunken,
                unfocusedContainerColor = Palette.sunken,
                focusedIndicatorColor = Color.Transparent,
                unfocusedIndicatorColor = Color.Transparent,
                cursorColor = Palette.ink,
            ),
        modifier = modifier.fillMaxWidth(),
    )
}

/** A create/edit sheet: title, scrollable content, keyboard-safe. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UpdatesSheet(
    title: String,
    onDismiss: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Palette.background,
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .imePadding()
                .navigationBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(start = 20.dp, end = 20.dp, bottom = 20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(title, style = displayStyle(22.sp))
            content()
        }
    }
}

/** Copyable technical values, behind a "Details" disclosure. */
@Composable
fun DetailsDisclosure(
    rows: List<Pair<String, String>>,
    copy: (String, String) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .clickable { open = !open }
                .padding(vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Outlined.Info, contentDescription = null, tint = Palette.ink2, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text("Details", color = Palette.ink2, fontWeight = FontWeight.Medium, fontSize = 15.sp, modifier = Modifier.weight(1f))
            Icon(if (open) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, contentDescription = null, tint = Palette.ink2)
        }
        AnimatedVisibility(open) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(top = 4.dp)) {
                rows.forEach { (label, value) ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(label, fontSize = 12.sp, color = Palette.ink2)
                            SelectionContainer { Text(value, fontSize = 12.sp, fontFamily = FontFamily.Monospace, color = Palette.ink) }
                        }
                        IconButton(onClick = { copy(label, value) }) {
                            Icon(Icons.Outlined.ContentCopy, contentDescription = "Copy $label", tint = Palette.ink2, modifier = Modifier.size(18.dp))
                        }
                    }
                }
            }
        }
    }
}

/** A KPI value's change: arrow and "+12%". */
@Composable
fun DeltaLabel(delta: String) {
    val direction = Metrics.direction(delta)
    val color =
        when (direction) {
            Metrics.Direction.UP -> Palette.good
            Metrics.Direction.DOWN -> Palette.danger
            Metrics.Direction.FLAT -> Palette.ink2
        }
    val icon =
        when (direction) {
            Metrics.Direction.UP -> Icons.AutoMirrored.Outlined.TrendingUp
            Metrics.Direction.DOWN -> Icons.AutoMirrored.Outlined.TrendingDown
            Metrics.Direction.FLAT -> Icons.AutoMirrored.Outlined.TrendingFlat
        }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(14.dp))
        Spacer(Modifier.width(3.dp))
        Text(delta, color = color, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    }
}

/** A trend line for a series of KPI values. */
@Composable
fun Sparkline(values: List<String>) {
    val points = Metrics.points(values)
    if (points.size < 2) {
        Text("Not enough reports for a trend", fontSize = 12.sp, color = Palette.ink3, modifier = Modifier.height(48.dp).padding(top = 14.dp))
        return
    }
    Canvas(Modifier.fillMaxWidth().height(48.dp)) {
        val pad = 3.dp.toPx()
        val lo = points.min()
        val span = points.max() - lo
        val xy =
            points.mapIndexed { i, v ->
                val x = pad + i.toFloat() / (points.size - 1) * (size.width - pad * 2)
                val t = if (span == 0.0) 0.5f else ((v - lo) / span).toFloat()
                Offset(x, size.height - pad - t * (size.height - pad * 2))
            }
        val line = Path().apply { xy.forEachIndexed { i, p -> if (i == 0) moveTo(p.x, p.y) else lineTo(p.x, p.y) } }
        val fill =
            Path().apply {
                addPath(line)
                lineTo(size.width - pad, size.height - pad)
                lineTo(pad, size.height - pad)
                close()
            }
        drawPath(fill, Palette.ink.copy(alpha = 0.06f))
        drawPath(line, Palette.ink, style = Stroke(width = 1.75.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
        drawCircle(Palette.ink, radius = 3.dp.toPx(), center = xy.last())
    }
}

/** A hairline-bordered rounded box. */
fun Modifier.hairline(): Modifier = this.border(1.dp, Palette.hairline, RoundedCornerShape(14.dp))
