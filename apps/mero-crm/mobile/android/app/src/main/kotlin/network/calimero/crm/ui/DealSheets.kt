package network.calimero.crm.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Cancel
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.MoveToInbox
import androidx.compose.material.icons.outlined.RadioButtonChecked
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.crm.core.Account
import network.calimero.crm.core.ActivityDraft
import network.calimero.crm.core.ActivityKind
import network.calimero.crm.core.Assistant
import network.calimero.crm.core.Days
import network.calimero.crm.core.DealDraft
import network.calimero.crm.core.DealField
import network.calimero.crm.core.LostReasons
import network.calimero.crm.generated.ContactView
import network.calimero.crm.generated.DealView
import java.net.URLEncoder
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/** "Move to stage…" (the phone's stand-in for dragging a card), plus closing the deal. */
@Composable
fun DealActionsSheet(
    deal: DealView,
    startLosing: Boolean = false,
    onDismiss: () -> Unit,
) {
    val model = LocalModel.current
    val state by model.state.collectAsState()
    val scope = rememberCoroutineScope()
    var losing by remember { mutableStateOf(startLosing) }
    var reason by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }

    fun run(body: suspend () -> Boolean) {
        busy = true
        scope.launch {
            val ok = body()
            busy = false
            if (ok) onDismiss()
        }
    }

    CrmSheet(
        deal.title,
        onDismiss,
        action = if (losing) "Mark as lost" else null,
        busy = busy,
        onAction = { run { model.markLost(deal, reason) } },
    ) {
        if (losing) {
            Text("Why was “${deal.title}” lost? It helps the whole team see patterns.", color = Palette.ink2, fontSize = 15.sp)
            FlowChips(LostReasons.common, reason) { reason = it }
            Field("Reason", reason, { reason = it }, "Optional")
        } else {
            SectionLabel("Move to stage")
            Surface(shape = RoundedCornerShape(14.dp), color = Palette.surface, border = BorderStroke(1.dp, Palette.hairline)) {
                Column {
                    state.stages.forEachIndexed { i, stage ->
                        val current = stage.id == deal.stageId
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clickable(enabled = !busy && deal.status == "open") { run { model.move(deal, stage.id) } }
                                .heightIn(min = 48.dp)
                                .padding(horizontal = 14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                if (current) Icons.Outlined.RadioButtonChecked else Icons.Outlined.RadioButtonUnchecked,
                                contentDescription = null,
                                tint = if (current) Palette.ink else Palette.ink3,
                                modifier = Modifier.size(20.dp),
                            )
                            Spacer(Modifier.width(12.dp))
                            Text(stage.name, fontSize = 16.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
                            Text("${stage.probability}%", fontSize = 15.sp, color = Palette.ink3)
                        }
                        if (i < state.stages.lastIndex) Divider()
                    }
                }
            }
            SectionLabel("Close the deal")
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SecondaryButton(
                    "Won",
                    onClick = { run { model.markWon(deal) } },
                    icon = Icons.Outlined.CheckCircle,
                    color = Palette.good,
                    enabled = !busy,
                    modifier = Modifier.weight(1f),
                )
                SecondaryButton(
                    "Lost",
                    onClick = { losing = true },
                    icon = Icons.Outlined.Cancel,
                    color = Palette.danger,
                    enabled = !busy,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

/** New deal, or edit one. A form: one branch per field. */
@Suppress("CyclomaticComplexMethod")
@Composable
fun DealEditorSheet(
    editing: DealView? = null,
    initial: DealDraft = DealDraft(),
    focus: DealField? = null,
    onDismiss: () -> Unit,
) {
    val model = LocalModel.current
    val state by model.state.collectAsState()
    val scope = rememberCoroutineScope()
    var draft by remember {
        val start = editing?.let { DealDraft.of(it, model.zone) } ?: initial
        mutableStateOf(
            start.copy(
                stageId =
                    start.stageId.ifEmpty {
                        model.stages
                            .firstOrNull()
                            ?.id
                            .orEmpty()
                    },
                owner = if (editing == null && start.owner == null) model.me else start.owner,
                expectedClose = if (focus == DealField.EXPECTED_CLOSE && start.expectedClose == null) LocalDate.now(model.zone) else start.expectedClose,
            ),
        )
    }
    var busy by remember { mutableStateOf(false) }
    val owners =
        model.ownerOptions.let { options ->
            val o = draft.owner
            if (o != null && options.none { Account.same(it, o) || it == o }) options + o else options
        }
    CrmSheet(
        if (editing == null) "New deal" else "Edit deal",
        onDismiss,
        action = if (editing == null) "Add deal" else "Save",
        busy = busy,
        enabled = draft.isValid,
        onAction = {
            busy = true
            scope.launch {
                val ok = if (editing == null) model.createDeal(draft) != null else model.updateDeal(editing.id, draft)
                busy = false
                if (ok) onDismiss()
            }
        },
    ) {
        Field("Title", draft.title, { draft = draft.copy(title = it) }, "What are you selling, to whom?")
        Field("Value (${model.currency})", draft.value, { draft = draft.copy(value = it) }, "e.g. 12k", keyboard = KeyboardType.Text)
        if (draft.parsedValue == null) Text("Value must be a number, e.g. 12000 or 12k.", color = Palette.danger, fontSize = 13.sp)
        Field("Organization", draft.organization, { draft = draft.copy(organization = it) }, "Company")
        val contactChoices =
            buildList {
                add(Choice("None") { draft = draft.copy(contactId = null, creatingContact = false) })
                if (editing == null) add(Choice("New person…") { draft = draft.copy(contactId = null, creatingContact = true) })
                for (c in state.contacts) {
                    add(Choice(if (c.organization.isEmpty()) c.name else "${c.name} · ${c.organization}") { draft = draft.copy(contactId = c.id, creatingContact = false) })
                }
            }
        PickerField(
            "Contact person",
            if (draft.creatingContact) "New person" else model.contact(draft.contactId)?.name ?: "None",
            contactChoices,
        )
        if (draft.creatingContact) {
            Field("Name", draft.newContactName, { draft = draft.copy(newContactName = it) }, "Full name", capitalization = KeyboardCapitalization.Words)
            Field(
                "Email",
                draft.newContactEmail,
                { draft = draft.copy(newContactEmail = it) },
                "name@company.com",
                keyboard = KeyboardType.Email,
                capitalization = KeyboardCapitalization.None,
            )
        }
        if (editing == null) {
            PickerField(
                "Stage",
                model.stage(draft.stageId)?.name ?: "Choose a stage",
                state.stages.map { s -> Choice("${s.name} · ${s.probability}%") { draft = draft.copy(stageId = s.id) } },
            )
        }
        PickerField(
            "Owner",
            model.ownerLabel(draft.owner),
            listOf(Choice("Unassigned") { draft = draft.copy(owner = null) }) + owners.map { o -> Choice(model.ownerLabel(o)) { draft = draft.copy(owner = o) } },
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Expected close", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink2, modifier = Modifier.weight(1f))
            Switch(
                checked = draft.expectedClose != null,
                onCheckedChange = { on -> draft = draft.copy(expectedClose = if (on) LocalDate.now(model.zone) else null) },
                colors = SwitchDefaults.colors(checkedTrackColor = Palette.good, checkedThumbColor = Palette.surface),
            )
        }
        draft.expectedClose?.let { day -> DateField("Close date", day) { draft = draft.copy(expectedClose = it) } }
        Field("Source", draft.source, { draft = draft.copy(source = it) }, "Referral, inbound…")
    }
}

/** A day, opening Material's date picker. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DateField(
    label: String,
    day: LocalDate,
    onPick: (LocalDate) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink2)
        Surface(
            onClick = { open = true },
            shape = RoundedCornerShape(10.dp),
            color = Palette.surface,
            border = BorderStroke(1.dp, Palette.hairline),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Row(Modifier.padding(horizontal = 14.dp, vertical = 15.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(day.format(DateTimeFormatter.ofPattern("EEE, MMM d, yyyy")), fontSize = 16.sp, modifier = Modifier.weight(1f))
                Icon(Icons.Outlined.CalendarMonth, contentDescription = null, tint = Palette.ink3, modifier = Modifier.size(18.dp))
            }
        }
    }
    if (open) {
        val picker = rememberDatePickerState(initialSelectedDateMillis = day.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
        DatePickerDialog(
            onDismissRequest = { open = false },
            confirmButton = {
                LinkButton("OK", onClick = {
                    picker.selectedDateMillis?.let { onPick(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate()) }
                    open = false
                })
            },
            dismissButton = { LinkButton("Cancel", onClick = { open = false }) },
        ) { DatePicker(state = picker) }
    }
}

/** Schedule a call, meeting, task, email or deadline. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ActivitySheet(
    dealId: String?,
    onDismiss: () -> Unit,
) {
    val model = LocalModel.current
    val state by model.state.collectAsState()
    val scope = rememberCoroutineScope()
    var draft by remember { mutableStateOf(ActivityDraft(due = Days.dueIn(1, model.now(), model.zone), dealId = dealId)) }
    var busy by remember { mutableStateOf(false) }
    var pickingTime by remember { mutableStateOf(false) }
    val dueLocal = Instant.ofEpochMilli(draft.due.toLong()).atZone(model.zone)
    CrmSheet(
        "Schedule",
        onDismiss,
        action = "Schedule",
        busy = busy,
        enabled = draft.isValid,
        onAction = {
            busy = true
            scope.launch {
                val ok = model.schedule(draft)
                busy = false
                if (ok) onDismiss()
            }
        },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Type", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink2)
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (k in ActivityKind.entries) Chip(k.label, selected = draft.kind == k, icon = kindIcon(k.raw)) { draft = draft.copy(kind = k) }
            }
        }
        Field("What needs to happen?", draft.subject, { draft = draft.copy(subject = it) }, "e.g. Call about the proposal")
        if (dealId == null) {
            PickerField(
                "Deal",
                draft.dealId?.let { model.deal(it)?.title } ?: "No deal",
                listOf(Choice("No deal") { draft = draft.copy(dealId = null) }) +
                    state.deals.filter { it.status == "open" }.map { d -> Choice(d.title) { draft = draft.copy(dealId = d.id) } },
            )
        }
        DateField("Due", dueLocal.toLocalDate()) { day -> draft = draft.copy(due = Days.atTime(day, dueLocal.hour, model.zone)) }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Time", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink2, modifier = Modifier.weight(1f))
            SmallButton(dueLocal.format(DateTimeFormatter.ofPattern("HH:mm")), onClick = { pickingTime = true }, filled = false)
        }
        Field("Note", draft.note, { draft = draft.copy(note = it) }, "Optional", singleLine = false, minLines = 2)
    }
    if (pickingTime) {
        val picker = rememberTimePickerState(initialHour = dueLocal.hour, initialMinute = dueLocal.minute)
        AlertDialog(
            onDismissRequest = { pickingTime = false },
            confirmButton = {
                LinkButton("OK", onClick = {
                    val at = dueLocal.withHour(picker.hour).withMinute(picker.minute)
                    draft = draft.copy(due = at.toInstant().toEpochMilli().toULong())
                    pickingTime = false
                })
            },
            dismissButton = { LinkButton("Cancel", onClick = { pickingTime = false }) },
            text = { TimePicker(state = picker) },
        )
    }
}

/** The assistant's follow-up email: copy, open in the mail app, or log it. */
@Composable
fun EmailDraftSheet(
    deal: DealView,
    contact: ContactView?,
    onDismiss: () -> Unit,
) {
    val model = LocalModel.current
    val platform = LocalPlatform.current
    val scope = rememberCoroutineScope()
    val email = remember(deal, contact) { Assistant.followUpEmail(deal, model.stages, contact, "") }
    CrmSheet("Follow-up email", onDismiss, cancelLabel = "Close") {
        CrmCard {
            Text("SUBJECT", fontSize = 11.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.5.sp, color = Palette.ink3)
            Text(email.subject, fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
            Divider()
            Text(email.body, fontSize = 15.sp)
        }
        PrimaryButton("Copy", onClick = {
            platform.copy("Email", "Subject: ${email.subject}\n\n${email.body}")
            model.notice.value =
                network.calimero.crm.app
                    .Notice("Email copied")
        }, icon = Icons.Outlined.ContentCopy)
        val address = contact?.email.orEmpty()
        if (address.isNotEmpty()) {
            SecondaryButton(
                "Open in Mail",
                onClick = {
                    fun enc(s: String) = URLEncoder.encode(s, "UTF-8").replace("+", "%20")
                    platform.open("mailto:$address?subject=${enc(email.subject)}&body=${enc(email.body)}")
                },
                icon = Icons.Outlined.Email,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        SecondaryButton(
            "Log as email activity",
            onClick = {
                scope.launch {
                    val ok =
                        model.schedule(
                            ActivityDraft(
                                kind = ActivityKind.EMAIL,
                                subject = email.subject,
                                due = Days.dueIn(0, model.now(), model.zone),
                                dealId = deal.id,
                                note = email.body,
                            ),
                        )
                    if (ok) onDismiss()
                }
            },
            icon = Icons.Outlined.MoveToInbox,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
