package network.calimero.calendar.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Update
import androidx.compose.material.icons.filled.WbSunny
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.calendar.app.CalendarModel
import network.calimero.calendar.data.CalEvent
import network.calimero.calendar.data.CalMember
import network.calimero.calendar.data.CalendarConstants
import network.calimero.calendar.data.ErrorText
import network.calimero.calendar.data.EventDraft
import network.calimero.calendar.data.shortId
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

private val dateLabel = DateTimeFormatter.ofPattern("EEE, MMM d, yyyy", Locale.getDefault())

/** Create, edit or view one event. */
@Composable
fun EventSheet(
    model: CalendarModel,
    target: EventTarget,
    members: List<CalMember>,
    onDismiss: () -> Unit,
) {
    val existing = (target as? EventTarget.Existing)?.event
    val editable = existing == null || model.canEdit(existing)
    var draft by remember {
        mutableStateOf(existing?.let { EventDraft.from(it) } ?: newDraft(target as EventTarget.New))
    }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    val title =
        when {
            existing == null -> "New event"
            editable -> "Edit event"
            else -> "Event"
        }

    val done: (@Composable () -> Unit)? =
        if (!editable) {
            { TextButton(onClick = onDismiss) { Text("Done", color = Tokens.ink) } }
        } else {
            null
        }
    AppSheet(title, onDismiss, trailing = done) {
        val readOnly = existing?.takeIf { !editable }
        if (readOnly != null) {
            ViewOnly(readOnly, model)
            return@AppSheet
        }
        TextInput(draft.title, { draft = draft.copy(title = it) }, "Title")
        ToggleRow("All day", draft.allDay, Icons.Filled.WbSunny) { draft = draft.withAllDay(it) }
        DateTimeRow("Starts", Icons.Filled.Schedule, draft.start, draft.allDay) { draft = draft.withStart(it) }
        DateTimeRow("Ends", Icons.Filled.Update, draft.end, draft.allDay) { draft = draft.copy(end = it) }
        val sharedAlready = existing != null && !existing.isLocal
        ToggleRow(
            "Private",
            draft.isPrivate,
            Icons.Filled.Lock,
            enabled = !sharedAlready,
            caption = if (sharedAlready) "Shared events can't be made private again." else "Only on this device. A private event never leaves your phone.",
        ) { draft = draft.withPrivate(it) }
        Text("Color", style = Tokens.label)
        ColorRow(draft.color) { draft = draft.copy(color = it) }
        if (!draft.isPrivate) {
            Text("Invite teammates", style = Tokens.label)
            val others = members.filter { !it.id.equals(model.account, ignoreCase = true) }
            if (others.isEmpty()) {
                Text("No teammates have joined yet.", style = Tokens.caption)
            } else {
                Card {
                    Column {
                        others.forEachIndexed { i, m ->
                            if (i > 0) HorizontalDivider(color = Tokens.line)
                            Row(
                                Modifier
                                    .fillMaxWidth()
                                    .clickable { draft = draft.togglePeer(m.id) }
                                    .padding(horizontal = 12.dp, vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Avatar(m.name.ifEmpty { m.id }, size = 30.dp)
                                Spacer(Modifier.width(10.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(m.name.ifEmpty { shortId(m.id) }, style = Tokens.body)
                                    Text(shortId(m.id), style = Tokens.caption.copy(fontSize = 11.sp))
                                }
                                Checkbox(
                                    checked = m.id in draft.peers,
                                    onCheckedChange = { draft = draft.togglePeer(m.id) },
                                    colors = CheckboxDefaults.colors(checkedColor = Tokens.lime, checkmarkColor = Tokens.ink, uncheckedColor = Tokens.faint),
                                )
                            }
                        }
                    }
                }
            }
        }
        TextInput(draft.description, { draft = draft.copy(description = it) }, "Description", singleLine = false, minLines = 3)
        error?.let { Text(it, style = Tokens.caption.copy(color = Tokens.danger)) }
        PrimaryButton(
            if (busy) {
                "Saving…"
            } else if (existing == null) {
                "Create"
            } else {
                "Save"
            },
            busy = busy,
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                val invalid = draft.error
                if (invalid != null) {
                    error = invalid
                    return@PrimaryButton
                }
                busy = true
                scope.launch {
                    try {
                        model.save(existing, draft)
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        onDismiss()
                    } catch (e: Exception) {
                        error = ErrorText.of(e, "save the event")
                    } finally {
                        busy = false
                    }
                }
            },
        )
        if (existing != null) {
            TextButton(onClick = { confirmDelete = true }, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Filled.Delete, contentDescription = null, tint = Tokens.danger, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("Delete event", color = Tokens.danger, fontWeight = FontWeight.Medium)
            }
            DetailsDisclosure(listOf("Event id" to existing.id, "Owner" to ownerLabel(existing)))
        }
    }
    if (confirmDelete && existing != null) {
        DeleteDialog(onConfirm = {
            confirmDelete = false
            scope.launch {
                try {
                    model.delete(existing)
                    onDismiss()
                } catch (e: Exception) {
                    error = ErrorText.of(e, "delete the event")
                }
            }
        }, onDismiss = { confirmDelete = false })
    }
}

@Composable
private fun ViewOnly(
    event: CalEvent,
    model: CalendarModel,
) {
    val zone = java.time.ZoneId.systemDefault()
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .size(12.dp)
                .clip(CircleShape)
                .background(Tokens.eventColor(event.color)),
        )
        Spacer(Modifier.width(10.dp))
        Text(event.title, style = Tokens.heading.copy(fontSize = 20.sp))
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Filled.Schedule, contentDescription = null, tint = Tokens.muted, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        val start = event.start.atZone(zone)
        val end = event.end.atZone(zone)
        Text(
            if (event.allDay) {
                "${dateLabel.format(start)} · All day"
            } else {
                "${dateLabel.format(start)} · ${hourMinute.format(start)} – ${hourMinute.format(end)}"
            },
            style = Tokens.body,
        )
    }
    if (event.isPrivate) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Lock, contentDescription = null, tint = Tokens.muted, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text("Private", style = Tokens.body)
        }
    }
    Text("Organiser: ${model.nameOf(event.owner)}", style = Tokens.caption)
    if (event.peers.isNotEmpty()) {
        Text("Invited: " + event.peers.joinToString(", ") { model.nameOf(it) }, style = Tokens.caption)
    }
    if (event.description.isNotBlank()) Text(event.description, style = Tokens.body)
    Text("Only the owner can edit this event.", style = Tokens.caption)
    DetailsDisclosure(listOf("Event id" to event.id, "Owner" to ownerLabel(event)))
}

private fun ownerLabel(event: CalEvent): String = if (event.isLocal) "This device" else event.owner

private fun newDraft(target: EventTarget.New): EventDraft {
    val hour = target.hour ?: return EventDraft.newOn(target.day)
    val start = target.day.atTime(hour, 0)
    return EventDraft(start = start, end = start.plusHours(1))
}

@Composable
private fun RowIcon(icon: ImageVector) {
    Icon(icon, contentDescription = null, tint = Tokens.muted, modifier = Modifier.size(20.dp))
    Spacer(Modifier.width(12.dp))
}

@Composable
private fun ToggleRow(
    label: String,
    checked: Boolean,
    icon: ImageVector,
    enabled: Boolean = true,
    caption: String? = null,
    onChange: (Boolean) -> Unit,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        RowIcon(icon)
        Column(Modifier.weight(1f)) {
            Text(label, style = Tokens.body.copy(fontWeight = FontWeight.Medium))
            if (caption != null) Text(caption, style = Tokens.caption)
        }
        Switch(
            checked = checked,
            onCheckedChange = onChange,
            enabled = enabled,
            colors =
                SwitchDefaults.colors(
                    checkedTrackColor = Tokens.lime,
                    checkedThumbColor = Tokens.ink,
                    uncheckedTrackColor = Tokens.sunken,
                    uncheckedBorderColor = Tokens.line,
                ),
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DateTimeRow(
    label: String,
    icon: ImageVector,
    value: LocalDateTime,
    allDay: Boolean,
    onChange: (LocalDateTime) -> Unit,
) {
    var pickDate by remember { mutableStateOf(false) }
    var pickTime by remember { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(icon, contentDescription = null, tint = Tokens.muted, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(4.dp))
        Text(label, style = Tokens.body.copy(fontWeight = FontWeight.Medium), modifier = Modifier.weight(1f))
        Pill(dateLabel.format(value)) { pickDate = true }
        if (!allDay) Pill(hourMinute.format(value)) { pickTime = true }
    }
    if (pickDate) {
        val state =
            rememberDatePickerState(
                initialSelectedDateMillis =
                    value
                        .toLocalDate()
                        .atStartOfDay()
                        .toInstant(ZoneOffset.UTC)
                        .toEpochMilli(),
            )
        DatePickerDialog(
            onDismissRequest = { pickDate = false },
            confirmButton = {
                TextButton(onClick = {
                    state.selectedDateMillis?.let { ms ->
                        val day = Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate()
                        onChange(LocalDateTime.of(day, value.toLocalTime()))
                    }
                    pickDate = false
                }) { Text("Done", color = Tokens.ink) }
            },
            dismissButton = { TextButton(onClick = { pickDate = false }) { Text("Cancel", color = Tokens.muted) } },
        ) { DatePicker(state = state) }
    }
    if (pickTime) {
        val state = rememberTimePickerState(value.hour, value.minute, is24Hour = true)
        AlertDialog(
            onDismissRequest = { pickTime = false },
            confirmButton = {
                TextButton(onClick = {
                    onChange(value.withHour(state.hour).withMinute(state.minute))
                    pickTime = false
                }) { Text("Done", color = Tokens.ink) }
            },
            dismissButton = { TextButton(onClick = { pickTime = false }) { Text("Cancel", color = Tokens.muted) } },
            text = { TimePicker(state = state) },
            containerColor = Tokens.surface,
        )
    }
}

@Composable
private fun Pill(
    text: String,
    onClick: () -> Unit,
) {
    Text(
        text,
        fontSize = 14.sp,
        color = Tokens.ink,
        modifier =
            Modifier
                .clip(RoundedCornerShape(8.dp))
                .background(Tokens.sunken)
                .clickable(onClick = onClick)
                .padding(horizontal = 10.dp, vertical = 7.dp),
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ColorRow(
    selected: String,
    onSelect: (String) -> Unit,
) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        CalendarConstants.PALETTE.forEach { hex ->
            val isSelected = hex.equals(selected, ignoreCase = true)
            Box(
                Modifier
                    .size(32.dp)
                    .clip(CircleShape)
                    .background(Tokens.eventColor(hex))
                    .then(if (isSelected) Modifier.border(2.dp, Tokens.ink, CircleShape) else Modifier)
                    .clickable { onSelect(hex) },
                contentAlignment = Alignment.Center,
            ) {
                if (isSelected) Icon(Icons.Filled.Check, contentDescription = "Selected", tint = androidx.compose.ui.graphics.Color.White, modifier = Modifier.size(18.dp))
            }
        }
    }
}
