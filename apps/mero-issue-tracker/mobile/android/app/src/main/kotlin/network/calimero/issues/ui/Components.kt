package network.calimero.issues.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PriorityHigh
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Contrast
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import network.calimero.issues.core.TrackerFormat

/** The status icons "Move to…" lists (SF Symbols on iOS: circle, circle.lefthalf.filled, nosign, checkmark.circle). */
fun statusIcon(status: String): ImageVector =
    when (status) {
        "In progress" -> Icons.Outlined.Contrast
        "Blocked" -> Icons.Outlined.Block
        "Done" -> Icons.Outlined.CheckCircle
        else -> Icons.Outlined.RadioButtonUnchecked
    }

fun Modifier.card(padding: Dp = 16.dp): Modifier =
    this
        .fillMaxWidth()
        .clip(RoundedCornerShape(Palette.radius))
        .background(Palette.surface)
        .border(0.75.dp, Palette.line, RoundedCornerShape(Palette.radius))
        .padding(padding)

/** Lime fill, ink text: every primary action. */
@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier.fillMaxWidth(),
    enabled: Boolean = true,
    busy: Boolean = false,
    icon: ImageVector? = null,
) {
    Button(
        onClick = onClick,
        enabled = enabled && !busy,
        modifier = modifier.heightIn(min = 50.dp),
        shape = RoundedCornerShape(Palette.radius),
        colors =
            ButtonDefaults.buttonColors(
                containerColor = Palette.lime,
                contentColor = Palette.ink,
                disabledContainerColor = Palette.lime.copy(alpha = 0.45f),
                disabledContentColor = Palette.ink.copy(alpha = 0.7f),
            ),
    ) {
        if (busy) {
            CircularProgressIndicator(Modifier.size(18.dp), color = Palette.ink, strokeWidth = 2.dp)
            Spacer(Modifier.width(8.dp))
        } else if (icon != null) {
            Icon(icon, contentDescription = null, Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
        }
        Text(text, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
    }
}

/** White, hairline: secondary actions. */
@Composable
fun SecondaryButton(
    text: String,
    onClick: () -> Unit,
    enabled: Boolean = true,
    icon: ImageVector? = null,
) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.fillMaxWidth().heightIn(min = 50.dp),
        shape = RoundedCornerShape(Palette.radius),
        border = BorderStroke(1.dp, Palette.line),
        colors = ButtonDefaults.outlinedButtonColors(containerColor = Palette.surface, contentColor = Palette.ink),
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
        }
        Text(text, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun StatusDot(
    status: String,
    size: Dp = 9.dp,
) {
    Box(Modifier.size(size).clip(CircleShape).background(Palette.status(status)))
}

/** Three ascending bars filled by priority; urgent is a tinted square with a bang. */
@Composable
fun PriorityGlyph(
    priority: String,
    size: Dp = 15.dp,
) {
    val label = Modifier.semantics { contentDescription = "Priority $priority" }
    if (priority == "urgent") {
        Box(
            label.size(size).clip(RoundedCornerShape(4.dp)).background(Palette.priority("urgent")),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Filled.PriorityHigh, contentDescription = null, tint = Color.White, modifier = Modifier.size(size * 0.7f))
        }
    } else {
        val filled = mapOf("low" to 1, "medium" to 2, "high" to 3)[priority] ?: 0
        Row(label.size(size), horizontalArrangement = Arrangement.spacedBy(1.5.dp), verticalAlignment = Alignment.Bottom) {
            listOf(5, 8, 11).forEachIndexed { i, h ->
                Box(
                    Modifier
                        .width(3.dp)
                        .height(h.dp)
                        .clip(RoundedCornerShape(1.5.dp))
                        .background(if (i < filled) Palette.priority(priority) else Palette.lineStrong),
                )
            }
        }
    }
}

@Composable
fun LabelChip(
    label: String,
    onRemove: (() -> Unit)? = null,
) {
    Row(
        Modifier.clip(CircleShape).background(Palette.sunken).padding(start = 8.dp, end = if (onRemove != null) 4.dp else 8.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Box(Modifier.size(7.dp).clip(CircleShape).background(Palette.swatches[TrackerFormat.labelSwatch(label)]))
        Text(label, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = Palette.text2, maxLines = 1)
        if (onRemove != null) {
            Icon(
                Icons.Filled.Close,
                contentDescription = "Remove label $label",
                tint = Palette.text3,
                modifier =
                    Modifier
                        .size(16.dp)
                        .clip(CircleShape)
                        .clickable(onClick = onRemove)
                        .padding(2.dp),
            )
        }
    }
}

/** A round initial for a person (assignee free text, or an account key). */
@Composable
fun Avatar(
    seed: String?,
    size: Dp = 24.dp,
) {
    if (seed.isNullOrEmpty()) {
        Icon(Icons.Outlined.AccountCircle, contentDescription = null, tint = Palette.text3, modifier = Modifier.size(size))
    } else {
        Box(
            Modifier.size(size).clip(CircleShape).background(Palette.swatches[TrackerFormat.swatch(seed)]),
            contentAlignment = Alignment.Center,
        ) {
            Text(seed.take(1).lowercase(), fontSize = (size.value * 0.48f).sp, fontWeight = FontWeight.SemiBold, color = Palette.ink)
        }
    }
}

@Composable
fun Pill(
    text: String,
    mono: Boolean = false,
) {
    Text(
        text,
        style =
            if (mono) {
                TextStyle(fontFamily = FontFamily.Monospace, fontSize = 12.sp)
            } else {
                TextStyle(fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            },
        color = Palette.text2,
        modifier = Modifier.clip(CircleShape).background(Palette.sunken).padding(horizontal = 9.dp, vertical = 4.dp),
    )
}

/** Empty, loading-failed and first-run states: an icon, a line, a reason, an action. */
@Composable
fun EmptyState(
    icon: ImageVector,
    title: String,
    message: String,
    action: Pair<String, () -> Unit>? = null,
) {
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            Modifier.size(60.dp).clip(RoundedCornerShape(18.dp)).background(Palette.lime.copy(alpha = 0.35f)),
            contentAlignment = Alignment.Center,
        ) { Icon(icon, contentDescription = null, tint = Palette.ink, modifier = Modifier.size(28.dp)) }
        Spacer(Modifier.height(14.dp))
        Text(title, fontSize = 19.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink, textAlign = TextAlign.Center)
        Spacer(Modifier.height(10.dp))
        Text(message, fontSize = 15.sp, color = Palette.text2, textAlign = TextAlign.Center)
        if (action != null) {
            Spacer(Modifier.height(18.dp))
            PrimaryButton(action.first, action.second, modifier = Modifier)
        }
    }
}

@Composable
fun CenteredProgress() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Palette.ink) }
}

/** A failure over content that is still on screen. */
@Composable
fun NoticeBanner(
    text: String?,
    dismiss: () -> Unit,
) {
    AnimatedVisibility(visible = text != null) {
        Row(
            Modifier.padding(horizontal = Palette.gutter, vertical = 6.dp).card(12.dp),
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(Icons.Outlined.WarningAmber, contentDescription = null, tint = Palette.danger)
            Text(text.orEmpty(), fontSize = 14.sp, color = Palette.ink, modifier = Modifier.weight(1f))
            Icon(
                Icons.Filled.Close,
                contentDescription = "Dismiss",
                tint = Palette.text3,
                modifier = Modifier.clip(CircleShape).clickable(onClick = dismiss),
            )
        }
    }
}

/** Technical ids behind a disclosure. */
@Composable
fun DetailsDisclosure(rows: List<Pair<String, String>>) {
    var open by remember { mutableStateOf(false) }
    Column(Modifier.card()) {
        Row(Modifier.fillMaxWidth().clickable { open = !open }, verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.Info, contentDescription = null, tint = Palette.text2, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text("Details", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Palette.text2, modifier = Modifier.weight(1f))
            Icon(if (open) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, contentDescription = null, tint = Palette.text2)
        }
        if (open) {
            SelectionContainer {
                Column(Modifier.padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    rows.forEach { (name, value) ->
                        Column {
                            Text(name, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Palette.text3)
                            Text(value, fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = Palette.text2)
                        }
                    }
                }
            }
        }
    }
}

/** Section heading inside cards and sheets: an optional lime number and an uppercase eyebrow. */
@Composable
fun Eyebrow(
    title: String,
    n: Int? = null,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (n != null) {
            Box(Modifier.size(20.dp).clip(CircleShape).background(Palette.lime), contentAlignment = Alignment.Center) {
                Text("$n", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Palette.ink)
            }
        }
        Text(title.uppercase(), fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.5.sp, color = Palette.text3)
    }
}

/** A white, hairline text field. */
@Composable
fun Field(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    singleLine: Boolean = true,
    minLines: Int = 1,
    mono: Boolean = false,
    keyboardType: KeyboardType = KeyboardType.Text,
    textSize: Int = 16,
    bold: Boolean = false,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        placeholder = { Text(placeholder, color = Palette.text3, fontSize = textSize.sp) },
        modifier = modifier.fillMaxWidth(),
        singleLine = singleLine,
        minLines = minLines,
        maxLines = if (singleLine) 1 else 10,
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
        textStyle =
            TextStyle(
                fontSize = textSize.sp,
                fontFamily = if (mono) FontFamily.Monospace else FontFamily.Default,
                fontWeight = if (bold) FontWeight.SemiBold else FontWeight.Normal,
                color = Palette.ink,
            ),
        shape = RoundedCornerShape(12.dp),
        colors =
            OutlinedTextFieldDefaults.colors(
                focusedContainerColor = Palette.surface,
                unfocusedContainerColor = Palette.surface,
                focusedBorderColor = Palette.ink,
                unfocusedBorderColor = Palette.line,
                cursorColor = Palette.ink,
            ),
    )
}

@Composable
fun LabeledField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    keyboardType: KeyboardType = KeyboardType.Text,
) {
    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
        Text(label, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Palette.text2)
        Field(value, onValueChange, placeholder, keyboardType = keyboardType)
    }
}

@Composable
fun ErrorLine(text: String?) {
    if (text != null) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon(Icons.Outlined.WarningAmber, contentDescription = null, tint = Palette.danger, modifier = Modifier.size(18.dp))
            Text(text, fontSize = 14.sp, color = Palette.danger)
        }
    }
}

@Composable
fun CardColumn(
    padding: Dp = 16.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(Modifier.card(padding), content = content)
}

@Composable
fun SmallIconButton(
    icon: ImageVector,
    description: String,
    onClick: () -> Unit,
    tint: Color = Palette.text2,
) {
    IconButton(onClick = onClick) { Icon(icon, contentDescription = description, tint = tint) }
}

/** The "questionmark.circle" of the iOS app. */
val MissingIcon: ImageVector get() = Icons.AutoMirrored.Outlined.HelpOutline

@Composable
fun OneLine(
    text: String,
    size: Int = 14,
    color: Color = Palette.ink,
    weight: FontWeight = FontWeight.Normal,
    modifier: Modifier = Modifier,
) {
    Text(text, fontSize = size.sp, color = color, fontWeight = weight, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = modifier)
}
