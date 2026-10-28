package network.calimero.vote.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.compose.animation.AnimatedVisibility
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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import network.calimero.vote.core.VoteFormat

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
        modifier = (if (compact) modifier else modifier.fillMaxWidth()).defaultMinSize(minHeight = if (compact) 36.dp else 50.dp),
        shape = CircleShape,
        colors =
            ButtonDefaults.buttonColors(
                containerColor = Palette.Lime,
                contentColor = Palette.Ink,
                disabledContainerColor = Palette.Lime.copy(alpha = 0.45f),
                disabledContentColor = Palette.Ink.copy(alpha = 0.5f),
            ),
        contentPadding =
            ButtonDefaults.ContentPadding.let {
                if (compact) {
                    androidx.compose.foundation.layout
                        .PaddingValues(horizontal = 16.dp)
                } else {
                    it
                }
            },
    ) {
        if (busy) {
            CircularProgressIndicator(modifier = Modifier.size(18.dp), color = Palette.Ink, strokeWidth = 2.dp)
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
        modifier = (if (compact) modifier else modifier.fillMaxWidth()).defaultMinSize(minHeight = if (compact) 36.dp else 50.dp),
        shape = CircleShape,
        border = androidx.compose.foundation.BorderStroke(1.dp, Palette.Hairline),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = Palette.Ink),
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
        }
        Text(text, fontSize = if (compact) 15.sp else 17.sp, fontWeight = FontWeight.SemiBold)
    }
}

/** A person's (round) or a place's (rounded square) initials on a tone. */
@Composable
fun Avatar(
    label: String,
    seed: String = label,
    size: Dp = 40.dp,
    square: Boolean = false,
    icon: ImageVector? = null,
) {
    val (background, ink) = Palette.Tones[VoteFormat.tone(seed)]
    val shape: Shape = if (square) RoundedCornerShape(size * 0.28f) else CircleShape
    Box(
        modifier = Modifier.size(size).clip(shape).background(background),
        contentAlignment = Alignment.Center,
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = ink, modifier = Modifier.size(size * 0.46f))
        } else {
            Text(VoteFormat.initial(label), color = ink, fontWeight = FontWeight.Bold, fontSize = (size.value * 0.38f).sp)
        }
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
        modifier =
            modifier
                .fillMaxWidth()
                .clip(shape)
                .background(Palette.Surface)
                .border(0.5.dp, Palette.Hairline, shape)
                .let { if (onClick != null) it.clickable(onClick = onClick) else it },
    ) { content() }
}

@Composable
fun EmptyState(
    icon: ImageVector,
    title: String,
    message: String,
    action: String? = null,
    onAction: () -> Unit = {},
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(64.dp).clip(CircleShape).background(Palette.LimeSoft), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(30.dp))
        }
        Text(title, fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 20.sp, color = Palette.Ink)
        Text(message, fontSize = 15.sp, color = Palette.Muted, textAlign = TextAlign.Center)
        if (action != null) PrimaryButton(action, onAction, compact = true, modifier = Modifier.padding(top = 4.dp))
    }
}

@Composable
fun ErrorState(
    message: String,
    retry: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(60.dp).clip(CircleShape).background(Palette.DangerSoft), contentAlignment = Alignment.Center) {
            Icon(Icons.Outlined.WarningAmber, contentDescription = null, tint = Palette.Danger, modifier = Modifier.size(26.dp))
        }
        Text("Couldn't load this", fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 19.sp, color = Palette.Ink)
        Text(message, fontSize = 15.sp, color = Palette.Muted, textAlign = TextAlign.Center)
        SecondaryButton("Try again", retry, compact = true)
    }
}

/** A dismissable line at the top of a screen for a failed action. */
@Composable
fun NoticeBanner(
    text: String?,
    dismiss: () -> Unit,
) {
    AnimatedVisibility(visible = text != null) {
        Row(
            modifier =
                Modifier
                    .padding(horizontal = 16.dp, vertical = 8.dp)
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(Palette.DangerSoft)
                    .padding(start = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Filled.Error, contentDescription = null, tint = Palette.Danger, modifier = Modifier.size(18.dp))
            Text(text.orEmpty(), fontSize = 14.sp, color = Palette.Ink, modifier = Modifier.weight(1f).padding(horizontal = 10.dp, vertical = 12.dp))
            IconButton(onClick = dismiss) { Icon(Icons.Filled.Close, contentDescription = "Dismiss", tint = Palette.Muted, modifier = Modifier.size(16.dp)) }
        }
    }
}

/** Ids and other technical values, folded away behind "Details". */
@Composable
fun DetailsDisclosure(rows: List<Pair<String, String>>) {
    var open by remember { mutableStateOf(false) }
    Column {
        Row(
            modifier = Modifier.fillMaxWidth().clickable { open = !open }.padding(vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Outlined.Info, contentDescription = null, tint = Palette.InkSoft, modifier = Modifier.size(18.dp))
            Text("Details", fontSize = 15.sp, fontWeight = FontWeight.Medium, color = Palette.InkSoft, modifier = Modifier.weight(1f).padding(start = 8.dp))
            Icon(
                Icons.Filled.KeyboardArrowDown,
                contentDescription = null,
                tint = Palette.InkSoft,
                modifier = Modifier.rotate(if (open) 180f else 0f),
            )
        }
        AnimatedVisibility(open) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(bottom = 8.dp)) {
                rows.filter { it.second.isNotEmpty() }.forEach { (label, value) -> CopyRow(label, value) }
            }
        }
    }
}

@Composable
fun CopyRow(
    label: String,
    value: String,
) {
    val context = LocalContext.current
    var copied by remember { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(label, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = Palette.Muted)
            Text(value, fontSize = 13.sp, fontFamily = FontFamily.Monospace, color = Palette.Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        IconButton(onClick = {
            copy(context, label, value)
            copied = true
        }) {
            Icon(
                if (copied) Icons.Filled.Check else Icons.Outlined.ContentCopy,
                contentDescription = if (copied) "Copied" else "Copy $label",
                tint = Palette.InkSoft,
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

/** A lime pill that says something is done or yours. */
@Composable
fun Badge(
    text: String,
    strong: Boolean = true,
) {
    Text(
        text,
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        color = Palette.Ink,
        modifier =
            Modifier
                .clip(CircleShape)
                .background(if (strong) Palette.Lime else Palette.Sunken)
                .padding(horizontal = 8.dp, vertical = 2.dp),
    )
}

/** The bar every create/edit sheet shares: Cancel, a title, and the action. */
@Composable
fun SheetBar(
    title: String,
    action: String,
    canAct: Boolean,
    busy: Boolean,
    cancel: () -> Unit,
    act: () -> Unit,
) {
    Column {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = cancel, enabled = !busy) { Text("Cancel", color = Palette.Ink, fontSize = 16.sp) }
            Text(
                title,
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
                color = Palette.Ink,
                textAlign = TextAlign.Center,
                modifier = Modifier.weight(1f),
            )
            PrimaryButton(action, act, enabled = canAct, busy = busy, compact = true)
            Spacer(Modifier.width(8.dp))
        }
        HorizontalDivider(thickness = 0.5.dp, color = Palette.Hairline)
    }
}

@Composable
fun Hairline(modifier: Modifier = Modifier) = HorizontalDivider(modifier, thickness = 0.5.dp, color = Palette.Hairline)

@Composable
fun Skeleton(
    width: Dp?,
    height: Dp,
    shape: Shape = RoundedCornerShape(4.dp),
) {
    Box(
        Modifier
            .let { if (width != null) it.width(width) else it.fillMaxWidth() }
            .height(height)
            .clip(shape)
            .background(Palette.Sunken),
    )
}

@Composable
fun IconCircle(
    icon: ImageVector,
    tone: Color,
    tint: Color = Palette.Ink,
) {
    Box(Modifier.size(60.dp).clip(CircleShape).background(tone), contentAlignment = Alignment.Center) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(26.dp))
    }
}

fun copy(
    context: Context,
    label: String,
    value: String,
) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText(label, value))
}

fun share(
    context: Context,
    text: String,
    fileName: String? = null,
) {
    val send =
        Intent(Intent.ACTION_SEND).apply {
            type = if (fileName != null) "application/json" else "text/plain"
            putExtra(Intent.EXTRA_TEXT, text)
            if (fileName != null) {
                putExtra(Intent.EXTRA_SUBJECT, fileName)
                putExtra(Intent.EXTRA_TITLE, fileName)
            }
        }
    context.startActivity(Intent.createChooser(send, null))
}
