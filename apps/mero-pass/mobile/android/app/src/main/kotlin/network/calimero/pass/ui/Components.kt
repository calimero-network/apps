package network.calimero.pass.ui

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import network.calimero.pass.core.ItemView
import network.calimero.pass.core.PasswordTools

// The shared pieces every screen is built from: the Compose twins of iOS `Theme.swift`.

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
        contentPadding = if (compact) PaddingValues(horizontal = 16.dp) else ButtonDefaults.ContentPadding,
    ) {
        if (busy) {
            CircularProgressIndicator(modifier = Modifier.size(18.dp), color = Palette.Ink, strokeWidth = 2.dp)
        } else {
            ButtonContent(text, icon, compact)
        }
    }
}

/** Outlined, for the second action. */
@Composable
fun SecondaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    compact: Boolean = false,
    destructive: Boolean = false,
    icon: ImageVector? = null,
) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = (if (compact) modifier else modifier.fillMaxWidth()).defaultMinSize(minHeight = if (compact) 36.dp else 50.dp),
        shape = CircleShape,
        border = BorderStroke(1.dp, Palette.Hairline),
        colors = ButtonDefaults.outlinedButtonColors(containerColor = Palette.Surface, contentColor = if (destructive) Palette.Danger else Palette.Ink),
        contentPadding = if (compact) PaddingValues(horizontal = 16.dp) else ButtonDefaults.ContentPadding,
    ) { ButtonContent(text, icon, compact) }
}

@Composable
private fun ButtonContent(
    text: String,
    icon: ImageVector?,
    compact: Boolean,
) {
    if (icon != null) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
    }
    Text(text, fontSize = if (compact) 15.sp else 17.sp, fontWeight = FontWeight.SemiBold)
}

/** A plain row action inside a section (iOS: a `Button` in a `List` row). */
@Composable
fun RowAction(
    text: String,
    icon: ImageVector,
    onClick: () -> Unit,
    enabled: Boolean = true,
    destructive: Boolean = false,
) {
    val tint = if (destructive) Palette.Danger else Palette.Ink
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(enabled = enabled, onClick = onClick)
            .padding(vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = tint.copy(alpha = if (enabled) 1f else 0.4f), modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(12.dp))
        Text(text, fontSize = 16.sp, color = tint.copy(alpha = if (enabled) 1f else 0.4f))
    }
}

/** A team's, vault's or item's tile: its initial on a colour from its name. */
@Composable
fun Tile(
    name: String,
    size: Dp = 40.dp,
    icon: ImageVector? = null,
) {
    val (background, ink) = Palette.tile(name)
    Box(
        Modifier
            .size(size)
            .clip(RoundedCornerShape(size * 0.28f))
            .background(background),
        contentAlignment = Alignment.Center,
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = ink, modifier = Modifier.size(size * 0.48f))
        } else {
            Text(ItemView.monogram(name), color = ink, fontWeight = FontWeight.Bold, fontSize = (size.value * 0.42f).sp)
        }
    }
}

/** White, rounded, hairline-bordered: one group of rows (iOS: an inset-grouped `List` section). */
@Composable
fun PassCard(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Palette.Surface)
            .border(0.5.dp, Palette.Hairline, RoundedCornerShape(14.dp))
            .padding(horizontal = 16.dp, vertical = 4.dp),
        content = content,
    )
}

/** A section: its small heading, the card, and an optional footer. */
@Composable
fun PassSection(
    header: String? = null,
    footer: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) {
        if (header != null) {
            SectionLabel(header, Modifier.padding(start = 4.dp, bottom = 6.dp))
        }
        PassCard(content = content)
        if (footer != null) {
            Text(footer, fontSize = 12.sp, color = Palette.Muted, modifier = Modifier.padding(start = 4.dp, top = 6.dp))
        }
    }
}

@Composable
fun RowDivider() {
    HorizontalDivider(color = Palette.Hairline, thickness = 0.5.dp)
}

@Composable
fun EmptyState(
    icon: ImageVector,
    title: String,
    message: String,
    action: String? = null,
    run: () -> Unit = {},
) {
    Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(64.dp).clip(CircleShape).background(Palette.LimeSoft), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(28.dp))
        }
        Spacer(Modifier.height(12.dp))
        Text(title, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink, textAlign = TextAlign.Center)
        Spacer(Modifier.height(8.dp))
        Text(message, fontSize = 15.sp, color = Palette.Muted, textAlign = TextAlign.Center)
        if (action != null) {
            Spacer(Modifier.height(14.dp))
            PrimaryButton(action, run, compact = true)
        }
    }
}

@Composable
fun ErrorState(
    message: String,
    retry: () -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(60.dp).clip(CircleShape).background(Palette.DangerSoft), contentAlignment = Alignment.Center) {
            Icon(Icons.Outlined.WarningAmber, contentDescription = null, tint = Palette.Danger, modifier = Modifier.size(26.dp))
        }
        Spacer(Modifier.height(12.dp))
        Text("Couldn't load this", fontSize = 19.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
        Spacer(Modifier.height(8.dp))
        Text(message, fontSize = 15.sp, color = Palette.Muted, textAlign = TextAlign.Center)
        Spacer(Modifier.height(12.dp))
        SecondaryButton("Try again", retry, compact = true)
    }
}

@Composable
fun LoadingBox(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().padding(vertical = 40.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = Palette.Ink)
    }
}

enum class Tone { DANGER, WARN, INFO }

/** A notice strip: danger for failures, warn for "waiting", info for what happened. */
@Composable
fun Banner(
    tone: Tone,
    icon: ImageVector,
    text: String,
    modifier: Modifier = Modifier,
    title: String? = null,
    dismiss: (() -> Unit)? = null,
) {
    val accent =
        when (tone) {
            Tone.DANGER -> Palette.Danger
            Tone.WARN -> Palette.Warn
            Tone.INFO -> Palette.Ink
        }
    val background =
        when (tone) {
            Tone.DANGER -> Palette.DangerSoft
            Tone.WARN -> Palette.WarnSoft
            Tone.INFO -> Palette.LimeSoft
        }
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(background)
            .padding(12.dp),
    ) {
        Icon(icon, contentDescription = null, tint = accent, modifier = Modifier.size(18.dp).padding(top = 1.dp))
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            if (title != null) Text(title, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
            Text(text, fontSize = 14.sp, color = Palette.InkSoft)
        }
        if (dismiss != null) {
            Icon(
                Icons.Filled.Close,
                contentDescription = "Dismiss",
                tint = Palette.Muted,
                modifier =
                    Modifier
                        .size(28.dp)
                        .clip(CircleShape)
                        .clickable(onClick = dismiss)
                        .padding(6.dp),
            )
        }
    }
}

/** A failure, with a close button. */
@Composable
fun ErrorBanner(
    text: String,
    modifier: Modifier = Modifier,
    dismiss: (() -> Unit)? = null,
) = Banner(Tone.DANGER, Icons.Filled.Error, text, modifier, dismiss = dismiss)

/** Ids and other technical values, folded away behind "Details". */
@Composable
fun DetailsDisclosure(rows: List<Pair<String, String>>) {
    var open by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .clickable { open = !open }
                .padding(vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Outlined.Info, contentDescription = null, tint = Palette.InkSoft, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text("Details", fontSize = 15.sp, fontWeight = FontWeight.Medium, color = Palette.InkSoft, modifier = Modifier.weight(1f))
            Icon(Icons.Filled.KeyboardArrowDown, contentDescription = null, tint = Palette.InkSoft, modifier = Modifier.rotate(if (open) 180f else 0f))
        }
        if (open) {
            Column(Modifier.padding(bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                rows.filter { it.second.isNotEmpty() }.forEach { CopyRow(it.first, it.second) }
            }
        }
    }
}

/** An id with a copy button (never a secret: secrets go through [AppServices.copySecret]). */
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
            Clipboard.copyPlain(context, label, value)
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

/** A small pill: lime when strong, grey otherwise. */
@Composable
fun PassBadge(
    text: String,
    strong: Boolean = false,
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
                .padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

/** A small upper-case section heading. */
@Composable
fun SectionLabel(
    text: String,
    modifier: Modifier = Modifier,
) {
    Text(
        text.uppercase(),
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 0.8.sp,
        color = Palette.Muted,
        modifier = modifier,
    )
}

/** The header every sheet shares: Cancel (or Done), a title, and the action. */
@Composable
fun SheetBar(
    title: String,
    action: String?,
    cancel: () -> Unit,
    canAct: Boolean = true,
    busy: Boolean = false,
    act: () -> Unit = {},
) {
    Column {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = cancel, enabled = !busy) {
                Text(if (action == null) "Done" else "Cancel", fontSize = 16.sp, color = Palette.Ink)
            }
            Text(
                title,
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
                color = Palette.Ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.Center,
                modifier = Modifier.weight(1f),
            )
            if (action != null) {
                PrimaryButton(action, act, enabled = canAct, busy = busy, compact = true, modifier = Modifier.padding(end = 8.dp))
            } else {
                Spacer(Modifier.width(72.dp))
            }
        }
        HorizontalDivider(color = Palette.Hairline, thickness = 0.5.dp)
    }
}

/** A labelled text input in the sheets' style. */
@Composable
fun InputField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String = "",
    secure: Boolean = false,
    multiline: Boolean = false,
    monospaced: Boolean = false,
) {
    var revealed by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = Palette.Muted)
        Row(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(Palette.Sunken)
                .padding(horizontal = 12.dp, vertical = 12.dp),
            verticalAlignment = if (multiline) Alignment.Top else Alignment.CenterVertically,
        ) {
            Box(Modifier.weight(1f)) {
                if (value.isEmpty() && placeholder.isNotEmpty()) Text(placeholder, fontSize = 16.sp, color = Palette.Muted)
                androidx.compose.foundation.text.BasicTextField(
                    value = value,
                    onValueChange = onValueChange,
                    singleLine = !multiline,
                    minLines = if (multiline) 3 else 1,
                    maxLines = if (multiline) 10 else 1,
                    visualTransformation = if (secure && !revealed) PasswordVisualTransformation() else VisualTransformation.None,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false),
                    textStyle =
                        androidx.compose.ui.text.TextStyle(
                            fontSize = 16.sp,
                            color = Palette.Ink,
                            fontFamily = if (monospaced || secure) FontFamily.Monospace else FontFamily.Default,
                        ),
                    cursorBrush =
                        androidx.compose.ui.graphics
                            .SolidColor(Palette.Ink),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            if (secure) {
                Icon(
                    if (revealed) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                    contentDescription = if (revealed) "Hide $label" else "Show $label",
                    tint = Palette.InkSoft,
                    modifier = Modifier.padding(start = 8.dp).size(22.dp).clickable { revealed = !revealed },
                )
            }
        }
    }
}

/** A round grey icon button (iOS `IconButton`). */
@Composable
fun RoundIconButton(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
) {
    Box(
        Modifier
            .size(34.dp)
            .clip(CircleShape)
            .background(Palette.Sunken)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, contentDescription = label, tint = Palette.InkSoft, modifier = Modifier.size(17.dp)) }
}

@Composable
fun StrengthMeter(score: Int) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .weight(1f)
                .height(6.dp)
                .clip(CircleShape)
                .background(Palette.Sunken),
        ) {
            Box(
                Modifier
                    .fillMaxWidth((score + 1) / 5f)
                    .height(6.dp)
                    .clip(CircleShape)
                    .background(Palette.strength(score)),
            )
        }
        Spacer(Modifier.width(8.dp))
        Text(
            PasswordTools.strengthLabels[score],
            fontSize = 12.sp,
            fontWeight = FontWeight.Medium,
            color = Palette.strength(score),
            modifier = Modifier.width(80.dp),
        )
    }
}

/** The bar every screen shares: white, centred title, ink. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PassTopBar(
    title: String,
    back: (() -> Unit)? = null,
    actions: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit = {},
) {
    CenterAlignedTopAppBar(
        title = { Text(title, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        navigationIcon = {
            if (back != null) {
                IconButton(onClick = back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
            }
        },
        actions = actions,
        colors =
            TopAppBarDefaults.centerAlignedTopAppBarColors(
                containerColor = Palette.Surface,
                titleContentColor = Palette.Ink,
                navigationIconContentColor = Palette.Ink,
                actionIconContentColor = Palette.Ink,
            ),
    )
}

/** A bottom sheet in the app's style. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PassSheet(
    dismiss: () -> Unit,
    locked: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { !locked })
    ModalBottomSheet(
        onDismissRequest = { if (!locked) dismiss() },
        sheetState = state,
        containerColor = Palette.Surface,
        dragHandle = null,
    ) {
        Column(Modifier.fillMaxWidth().padding(top = 8.dp), content = content)
    }
}

/** A confirmation (iOS `confirmationDialog`). */
@Composable
fun ConfirmDialog(
    title: String,
    message: String,
    confirm: String,
    dismiss: () -> Unit,
    destructive: Boolean = true,
    other: Pair<String, () -> Unit>? = null,
    act: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = dismiss,
        containerColor = Palette.Surface,
        title = { Text(title, fontWeight = FontWeight.SemiBold, fontSize = 18.sp, color = Palette.Ink) },
        text = { Text(message, color = Palette.InkSoft) },
        confirmButton = {
            TextButton(onClick = {
                dismiss()
                act()
            }) { Text(confirm, color = if (destructive) Palette.Danger else Palette.Ink, fontWeight = FontWeight.SemiBold) }
        },
        dismissButton = {
            Row {
                if (other != null) {
                    TextButton(onClick = {
                        dismiss()
                        other.second()
                    }) { Text(other.first, color = Palette.Ink) }
                }
                TextButton(onClick = dismiss) { Text("Cancel", color = Palette.Ink) }
            }
        },
    )
}

/** A full-screen ground with the content centred, for loading. */
@Composable
fun CenteredProgress() {
    Box(Modifier.fillMaxSize().background(Palette.Ground), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = Palette.Ink)
    }
}
