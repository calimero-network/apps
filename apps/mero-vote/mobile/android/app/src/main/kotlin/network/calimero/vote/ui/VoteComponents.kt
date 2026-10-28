package network.calimero.vote.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.vote.core.VoteErrorText
import network.calimero.vote.core.VoteFormat
import network.calimero.vote.generated.Phase

/** Callout tones, as the web's `Callout`. */
enum class Tone(
    val background: Color,
    val ink: Color,
    val icon: ImageVector,
) {
    SUCCESS(Palette.SuccessSoft, Palette.Success, Icons.Filled.CheckCircle),
    DANGER(Palette.DangerSoft, Palette.Danger, Icons.Outlined.Warning),
    WARNING(Palette.WarningSoft, Palette.Warning, Icons.Outlined.Warning),
    INFO(Palette.InfoSoft, Palette.Info, Icons.Outlined.Info),
}

/** A tinted box with an icon, an optional bold title and text. */
@Composable
fun Callout(
    tone: Tone,
    text: String,
    title: String? = null,
    icon: ImageVector = tone.icon,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(tone.background)
            .padding(12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(icon, contentDescription = null, tint = tone.ink, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(10.dp))
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            if (title != null) Text(title, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
            Text(text, fontSize = 14.sp, color = Palette.Ink)
        }
    }
}

/** A dismissable success line (the error one is [NoticeBanner]). */
@Composable
fun SuccessBanner(
    text: String?,
    dismiss: () -> Unit,
) {
    AnimatedVisibility(visible = text != null) {
        Row(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(Palette.LimeSoft)
                .padding(start = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Filled.Check, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(18.dp))
            Text(text.orEmpty(), fontSize = 14.sp, color = Palette.Ink, modifier = Modifier.weight(1f).padding(horizontal = 10.dp, vertical = 12.dp))
            IconButton(onClick = dismiss) { Icon(Icons.Filled.Close, contentDescription = "Dismiss", tint = Palette.Muted, modifier = Modifier.size(16.dp)) }
        }
    }
}

/** A poll's phase as a dot and a word. */
@Composable
fun PhaseBadge(phase: Phase) {
    val (bg, ink) =
        when (phase) {
            Phase.KeyCeremony -> Palette.WarningSoft to Palette.Warning
            Phase.Voting -> Palette.Lime to Palette.Ink
            Phase.Closing -> Palette.InfoSoft to Palette.Info
            Phase.Closed -> Palette.Sunken to Palette.InkSoft
        }
    Row(
        Modifier.clip(CircleShape).background(bg).padding(horizontal = 9.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(6.dp).clip(CircleShape).background(ink))
        Spacer(Modifier.width(6.dp))
        Text(VoteFormat.phaseLabel(phase), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = ink)
    }
}

/** A small coloured pill. */
@Composable
fun TonePill(
    text: String,
    background: Color,
    ink: Color,
    icon: ImageVector? = null,
) {
    Row(
        Modifier.clip(CircleShape).background(background).padding(horizontal = 8.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = ink, modifier = Modifier.size(12.dp))
            Spacer(Modifier.width(4.dp))
        }
        Text(text, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = ink)
    }
}

/** The rounded square beside a card's title. */
@Composable
fun IconTile(
    icon: ImageVector,
    accent: Boolean = false,
) {
    Box(
        Modifier.size(38.dp).clip(RoundedCornerShape(11.dp)).background(if (accent) Palette.Lime else Palette.Sunken),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(20.dp)) }
}

/** A white card with padding and spaced content. */
@Composable
fun SectionCard(content: @Composable ColumnScope.() -> Unit) {
    Card {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
    }
}

/** A card's head: tile, title, meta, and something trailing. */
@Composable
fun CardHead(
    icon: ImageVector,
    title: String,
    meta: String? = null,
    accent: Boolean = false,
    trailing: @Composable RowScope.() -> Unit = {},
) {
    Row(verticalAlignment = Alignment.Top) {
        IconTile(icon, accent)
        Column(Modifier.weight(1f).padding(start = 12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = Palette.Ink)
            if (meta != null) Text(meta, fontSize = 14.sp, color = Palette.Muted)
        }
        trailing()
    }
}

/** A status as an icon plus a word: done, waiting, or not applicable. */
@Composable
fun StatusWord(
    done: Boolean,
    waiting: Boolean,
    doneText: String,
) {
    when {
        done -> TonePill(doneText, Palette.SuccessSoft, Palette.Success, Icons.Filled.Check)
        waiting -> TonePill("Waiting", Palette.Sunken, Palette.InkSoft, Icons.Outlined.Schedule)
        else -> Text("—", fontSize = 13.sp, color = Palette.Muted)
    }
}

/** Danger fill, white text: closing and sealing. */
@Composable
fun DangerButton(
    text: String,
    onClick: () -> Unit,
    enabled: Boolean = true,
    busy: Boolean = false,
    icon: ImageVector? = null,
) {
    Button(
        onClick = onClick,
        enabled = enabled && !busy,
        modifier = Modifier.defaultMinSize(minHeight = 36.dp),
        shape = CircleShape,
        colors = ButtonDefaults.buttonColors(containerColor = Palette.Danger, contentColor = Color.White),
    ) {
        if (busy) {
            CircularProgressIndicator(modifier = Modifier.size(16.dp), color = Color.White, strokeWidth = 2.dp)
            Spacer(Modifier.width(8.dp))
        } else if (icon != null) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(6.dp))
        }
        Text(text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
    }
}

/** A titled fold for long technical content (the audit's checks). */
@Composable
fun Disclosure(
    title: String,
    content: @Composable ColumnScope.() -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    Column {
        Row(
            Modifier.fillMaxWidth().clickable { open = !open }.padding(vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Outlined.Info, contentDescription = null, tint = Palette.InkSoft, modifier = Modifier.size(18.dp))
            Text(title, fontSize = 15.sp, fontWeight = FontWeight.Medium, color = Palette.InkSoft, modifier = Modifier.weight(1f).padding(start = 8.dp))
            Icon(Icons.Filled.KeyboardArrowDown, contentDescription = null, tint = Palette.InkSoft, modifier = Modifier.rotate(if (open) 180f else 0f))
        }
        AnimatedVisibility(open) { Column(verticalArrangement = Arrangement.spacedBy(10.dp), content = content) }
    }
}

/** The bar every screen shares: white, centred title, ink. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VoteTopBar(
    title: String,
    subtitle: String? = null,
    navigation: @Composable () -> Unit = {},
    actions: @Composable RowScope.() -> Unit = {},
) {
    Column {
        CenterAlignedTopAppBar(
            title = {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(title, fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (subtitle != null) Text(subtitle, fontSize = 12.sp, color = Palette.Muted, maxLines = 1)
                }
            },
            navigationIcon = navigation,
            actions = actions,
            colors =
                TopAppBarDefaults.centerAlignedTopAppBarColors(
                    containerColor = Palette.Surface,
                    titleContentColor = Palette.Ink,
                    navigationIconContentColor = Palette.Ink,
                    actionIconContentColor = Palette.Ink,
                ),
        )
        Hairline()
    }
}

@Composable
fun BackButton(back: () -> Unit) {
    IconButton(onClick = back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
}

@Composable
fun plainFieldColors() =
    TextFieldDefaults.colors(
        focusedContainerColor = Color.Transparent,
        unfocusedContainerColor = Color.Transparent,
        focusedIndicatorColor = Color.Transparent,
        unfocusedIndicatorColor = Color.Transparent,
        cursorColor = Palette.Ink,
    )

@Composable
fun filledFieldColors() =
    TextFieldDefaults.colors(
        focusedContainerColor = Palette.Sunken,
        unfocusedContainerColor = Palette.Sunken,
        focusedIndicatorColor = Color.Transparent,
        unfocusedIndicatorColor = Color.Transparent,
        cursorColor = Palette.Ink,
    )

/** A rounded grey field with a placeholder. */
@Composable
fun FilledField(
    value: String,
    onChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    singleLine: Boolean = true,
    minLines: Int = 1,
    maxLength: Int = Int.MAX_VALUE,
) {
    TextField(
        value = value,
        onValueChange = { onChange(it.take(maxLength)) },
        placeholder = { Text(placeholder, color = Palette.Muted) },
        singleLine = singleLine,
        minLines = minLines,
        colors = filledFieldColors(),
        shape = RoundedCornerShape(12.dp),
        modifier = modifier.fillMaxWidth(),
    )
}

/** One name in, one async action out: new workspace, your name. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NameSheet(
    title: String,
    placeholder: String,
    action: String,
    note: String,
    initial: String = "",
    maxLength: Int = 64,
    dismiss: () -> Unit,
    submit: suspend (String) -> Unit,
) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf(initial) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val focus = remember { FocusRequester() }

    fun run() {
        if (busy || name.isBlank()) return
        busy = true
        error = null
        scope.launch {
            runCatching { submit(name) }
                .onSuccess {
                    state.hide()
                    dismiss()
                }.onFailure { error = VoteErrorText.describe(it) }
            busy = false
        }
    }
    ModalBottomSheet(onDismissRequest = dismiss, sheetState = state, containerColor = Palette.Surface, dragHandle = null) {
        Column(Modifier.imePadding()) {
            SheetBar(title, action, canAct = name.isNotBlank(), busy = busy, cancel = dismiss, act = ::run)
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                TextField(
                    value = name,
                    onValueChange = { name = it.take(maxLength) },
                    placeholder = { Text(placeholder, fontFamily = Display, fontSize = 22.sp, color = Palette.Muted) },
                    textStyle = TextStyle(fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 22.sp, color = Palette.Ink),
                    singleLine = true,
                    colors = plainFieldColors(),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { run() }),
                    modifier = Modifier.fillMaxWidth().focusRequester(focus),
                )
                Hairline()
                Text(note, fontSize = 14.sp, color = Palette.Muted)
                error?.let { Text(it, fontSize = 14.sp, color = Palette.Danger) }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
    LaunchedEffect(Unit) { focus.requestFocus() }
}

/** A chip that toggles a person in or out of a set: lime when in, grey when out. */
@Composable
fun ToggleChip(
    label: String,
    on: Boolean,
    toggle: () -> Unit,
) {
    Row(
        Modifier
            .clip(CircleShape)
            .background(if (on) Palette.Lime else Palette.Sunken)
            .clickable(onClick = toggle)
            .padding(horizontal = 12.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(if (on) Icons.Filled.Check else Icons.Filled.Add, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(13.dp))
        Spacer(Modifier.width(6.dp))
        Text(label, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = Palette.Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** A small ink-bordered outline used by option rows. */
val selectedBorder = BorderStroke(1.dp, Palette.Ink)
