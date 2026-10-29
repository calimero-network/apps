package network.calimero.stream.ui

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import network.calimero.stream.R
import network.calimero.stream.core.People

/**
 * Calimero light for the lists: lime accent fills with ink text on them, near-black ink, white and
 * very light grey surfaces, hairline borders. The call itself is dark, like the web app's stage.
 * iOS `Theme.swift` holds the same values.
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
    val Danger = Color(0xFFC62828)
    val DangerSoft = Color(0xFFFFE7EC)
    val WarnSoft = Color(0xFFFFF1C2)

    // The call.
    val Stage = Color(0xFF131215)
    val Tile = Color(0xFF222126)
    val Control = Color(0xFF2E2D33)
    val StageText = Color(0xFFE8E8EA)
    val StageFaint = Color(0xFF9A9AA0)

    /** Avatar tones: background, ink. */
    private val tones =
        listOf(
            Color(0xFFE4F9C4) to Color(0xFF2F5000),
            Color(0xFFDDE7FF) to Color(0xFF23408F),
            Color(0xFFFFE4D1) to Color(0xFF8A3B0B),
            Color(0xFFF3DDFB) to Color(0xFF6A1E86),
            Color(0xFFD5F4EE) to Color(0xFF0D5E50),
            Color(0xFFFFF1C2) to Color(0xFF6B4E00),
        )

    /** The same FNV-1a pick as iOS, so a person has the same colour on both. */
    fun tone(seed: String): Pair<Color, Color> {
        var hash = 2_166_136_261L
        for (byte in seed.toByteArray()) hash = ((hash xor (byte.toLong() and 0xFF)) * 16_777_619L) and 0xFFFF_FFFFL
        return tones[(hash % tones.size).toInt()]
    }
}

/** Power Grotesk, the web app's display face (app/public/fonts/powerGrotesk). */
val Display =
    FontFamily(
        Font(R.font.power_grotesk_regular, FontWeight.Normal),
        Font(R.font.power_grotesk_bold, FontWeight.Bold),
    )

@Composable
fun StreamTheme(content: @Composable () -> Unit) {
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

/** A light tap on primary actions (iOS uses the same moments). */
@Composable
fun rememberTap(): () -> Unit {
    val haptics = LocalHapticFeedback.current
    return remember(haptics) { { haptics.performHapticFeedback(HapticFeedbackType.LongPress) } }
}

/** Lime fill, ink text: the one primary action on a screen. */
@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    busy: Boolean = false,
    compact: Boolean = false,
    icon: ImageVector? = null,
) {
    Button(
        onClick = onClick,
        enabled = enabled && !busy,
        modifier = (if (compact) modifier else modifier.fillMaxWidth()).heightIn(min = if (compact) 36.dp else 50.dp),
        shape = CircleShape,
        colors =
            ButtonDefaults.buttonColors(
                containerColor = Palette.Lime,
                contentColor = Palette.Ink,
                disabledContainerColor = Palette.Lime.copy(alpha = 0.45f),
                disabledContentColor = Palette.Ink.copy(alpha = 0.6f),
            ),
    ) {
        if (busy) {
            CircularProgressIndicator(Modifier.size(18.dp), color = Palette.Ink, strokeWidth = 2.dp)
        } else {
            if (icon != null) {
                Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
            }
            Text(text, fontSize = if (compact) 15.sp else 17.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

/** Outlined, for the second action. */
@Composable
fun SecondaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
    icon: ImageVector? = null,
) {
    OutlinedButton(
        onClick = onClick,
        modifier = (if (compact) modifier else modifier.fillMaxWidth()).heightIn(min = if (compact) 36.dp else 50.dp),
        shape = CircleShape,
        border = androidx.compose.foundation.BorderStroke(1.dp, Palette.Hairline),
        colors = ButtonDefaults.outlinedButtonColors(containerColor = Palette.Surface, contentColor = Palette.Ink),
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
        }
        Text(text, fontSize = if (compact) 15.sp else 17.sp, fontWeight = FontWeight.SemiBold)
    }
}

/** A person's initials on a tone. */
@Composable
fun Avatar(
    name: String,
    seed: String = name,
    size: Int = 40,
) {
    val (bg, ink) = Palette.tone(seed)
    Box(Modifier.size(size.dp).clip(CircleShape).background(bg), contentAlignment = Alignment.Center) {
        Text(People.initials(name), color = ink, fontWeight = FontWeight.Bold, fontSize = (size * 0.38f).sp)
    }
}

/** White, rounded, hairline-bordered. */
@Composable
fun Card(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    val shape = RoundedCornerShape(14.dp)
    Box(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(Palette.Surface)
            .border(0.5.dp, Palette.Hairline, shape)
            .let { if (onClick != null) it.clickable(onClick = onClick) else it },
    ) { content() }
}

/** A rounded square holding an icon: the leading mark on a list row. */
@Composable
fun RowIcon(icon: ImageVector) {
    Box(
        Modifier.size(42.dp).clip(RoundedCornerShape(12.dp)).background(Palette.LimeSoft),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(20.dp)) }
}

@Composable
fun EmptyState(
    icon: ImageVector,
    title: String,
    message: String,
) {
    Column(
        Modifier.fillMaxWidth().padding(28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(64.dp).clip(CircleShape).background(Palette.LimeSoft), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(28.dp))
        }
        Text(title, fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 20.sp, color = Palette.Ink)
        Text(message, fontSize = 15.sp, color = Palette.Muted, textAlign = TextAlign.Center)
    }
}

/** A dismissable line for a failed action. */
@Composable
fun NoticeBanner(
    text: String,
    onDismiss: () -> Unit,
    icon: ImageVector = Icons.Outlined.ErrorOutline,
    tint: Color = Palette.Danger,
    background: Color = Palette.DangerSoft,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(background)
            .padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(20.dp))
        Text(text, fontSize = 14.sp, color = Palette.Ink, modifier = Modifier.weight(1f))
        Icon(
            Icons.Outlined.Close,
            contentDescription = "Dismiss",
            tint = Palette.Muted,
            modifier = Modifier.size(18.dp).clickable(onClick = onDismiss),
        )
    }
}

/** Ids and other technical values, folded away behind "Details". */
@Composable
fun DetailsDisclosure(
    rows: List<Pair<String, String>>,
    copy: (String, String) -> Unit,
    dark: Boolean = false,
) {
    var open by remember { mutableStateOf(false) }
    val faint = if (dark) Palette.StageFaint else Palette.InkSoft
    Column(Modifier.fillMaxWidth().animateContentSize()) {
        Row(
            Modifier.fillMaxWidth().clickable { open = !open }.padding(vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(Icons.Outlined.Info, contentDescription = null, tint = faint, modifier = Modifier.size(18.dp))
            Text("Details", color = faint, fontSize = 15.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
            Icon(Icons.Outlined.ExpandMore, contentDescription = null, tint = faint, modifier = Modifier.rotate(if (open) 180f else 0f))
        }
        if (open) {
            for ((label, value) in rows.filter { it.second.isNotEmpty() }) {
                CopyRow(label, value, copy, dark)
            }
        }
    }
}

@Composable
private fun CopyRow(
    label: String,
    value: String,
    copy: (String, String) -> Unit,
    dark: Boolean,
) {
    var copied by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(label, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = if (dark) Palette.StageFaint else Palette.Muted)
            Text(
                value,
                fontSize = 13.sp,
                fontFamily = FontFamily.Monospace,
                color = if (dark) Palette.StageText else Palette.Ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        IconButton(onClick = {
            copy(label, value)
            copied = true
        }) {
            Icon(
                if (copied) Icons.Outlined.Check else Icons.Outlined.ContentCopy,
                contentDescription = if (copied) "Copied" else "Copy $label",
                tint = if (dark) Palette.StageFaint else Palette.InkSoft,
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

/** The header every create sheet shares: Cancel, a title, and the action. */
@Composable
fun SheetBar(
    title: String,
    action: String,
    canAct: Boolean,
    busy: Boolean,
    onCancel: () -> Unit,
    onAct: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            "Cancel",
            color = Palette.Ink,
            fontSize = 16.sp,
            modifier = Modifier.clickable(enabled = !busy, onClick = onCancel).padding(8.dp),
        )
        Text(
            title,
            fontSize = 16.sp,
            fontWeight = FontWeight.SemiBold,
            color = Palette.Ink,
            modifier = Modifier.weight(1f),
            textAlign = TextAlign.Center,
        )
        PrimaryButton(action, onAct, enabled = canAct, busy = busy, compact = true, modifier = Modifier.defaultMinSize(minWidth = 64.dp))
    }
}
