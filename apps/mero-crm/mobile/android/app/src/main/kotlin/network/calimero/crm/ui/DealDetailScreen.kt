package network.calimero.crm.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.Undo
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.Cancel
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.SearchOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.crm.app.Notice
import network.calimero.crm.core.Assistant
import network.calimero.crm.core.Days
import network.calimero.crm.core.DealField
import network.calimero.crm.core.Money
import network.calimero.crm.generated.DealDetail
import network.calimero.crm.generated.DealView

private data class EditRequest(
    val focus: DealField?,
)

/** One deal: where it stands, the assistant, its activities and notes. */
@Composable
fun DealDetailScreen(dealId: String) {
    val model = LocalModel.current
    val nav = LocalNav.current
    val platform = LocalPlatform.current
    val state by model.state.collectAsState()
    val scope = rememberCoroutineScope()
    var detail by remember { mutableStateOf<DealDetail?>(null) }
    var missing by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<EditRequest?>(null) }
    var acting by remember { mutableStateOf(false) }
    var losing by remember { mutableStateOf(false) }
    var scheduling by remember { mutableStateOf(false) }
    var emailing by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }

    LaunchedEffect(dealId, state.version) {
        try {
            detail = model.detail(dealId)
            missing = false
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            if (detail == null) missing = true
        }
    }
    val deal = detail?.deal

    Screen(
        deal?.title ?: "Deal",
        back = true,
        actions = {
            if (deal != null) {
                Box {
                    IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreHoriz, contentDescription = "Deal actions") }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        DropdownMenuItem(text = { Text("Edit") }, leadingIcon = { Icon(Icons.Outlined.Edit, null) }, onClick = {
                            menu = false
                            editing = EditRequest(null)
                        })
                        if (deal.status == "open") {
                            DropdownMenuItem(text = { Text("Move to stage…") }, leadingIcon = { Icon(Icons.AutoMirrored.Outlined.ArrowForward, null) }, onClick = {
                                menu = false
                                acting = true
                            })
                        }
                        if (model.isMe(deal.createdBy)) {
                            DropdownMenuItem(
                                text = { Text("Delete deal", color = Palette.danger) },
                                leadingIcon = { Icon(Icons.Outlined.Delete, null, tint = Palette.danger) },
                                onClick = {
                                    menu = false
                                    confirmDelete = true
                                },
                            )
                        }
                    }
                }
            }
        },
    ) {
        val d = detail
        when {
            missing ->
                Column(Modifier.padding(16.dp)) {
                    CrmCard { EmptyState(Icons.Outlined.SearchOff, "This deal no longer exists", "It may have been deleted by its creator.") }
                }
            d == null ->
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Palette.ink) }
            else ->
                Refreshable {
                    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        item { Header(d.deal) }
                        item {
                            if (d.deal.status == "open") {
                                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                    SecondaryButton("Won", onClick = { scope.launch { model.markWon(d.deal) } }, icon = Icons.Outlined.CheckCircle, color = Palette.good, compact = true, modifier = Modifier.weight(1f))
                                    SecondaryButton("Lost", onClick = { losing = true }, icon = Icons.Outlined.Cancel, color = Palette.danger, compact = true, modifier = Modifier.weight(1f))
                                    SecondaryButton("Move", onClick = { acting = true }, icon = Icons.AutoMirrored.Outlined.ArrowForward, compact = true, modifier = Modifier.weight(1f))
                                }
                            } else {
                                SecondaryButton("Reopen", onClick = { scope.launch { model.reopen(d.deal) } }, icon = Icons.AutoMirrored.Outlined.Undo, compact = true, modifier = Modifier.fillMaxWidth())
                            }
                        }
                        item { StageStrip(d.deal) }
                        item { DetailsCard(d, onEdit = { editing = EditRequest(null) }) }
                        item { AssistantCard(d, onFix = { editing = EditRequest(it) }, onEmail = { emailing = true }) }
                        item { ActivitiesCard(d, onSchedule = { scheduling = true }) }
                        item { NotesCard(d) }
                        item {
                            DetailsDisclosure(
                                listOf(
                                    "Deal id" to d.deal.id,
                                    "Contact id" to (d.deal.contactId ?: "—"),
                                    "Created by" to d.deal.createdBy,
                                    "Pipeline (context)" to model.pipeline.contextId,
                                ),
                            ) {
                                platform.copy("Value", it)
                                model.notice.value = Notice("Copied")
                            }
                        }
                    }
                }
        }
    }
    val current = detail?.deal
    if (current != null) {
        editing?.let { req -> DealEditorSheet(editing = current, focus = req.focus, onDismiss = { editing = null }) }
        if (acting) DealActionsSheet(current, onDismiss = { acting = false })
        if (losing) DealActionsSheet(current, startLosing = true, onDismiss = { losing = false })
        if (emailing) EmailDraftSheet(current, detail?.contact, onDismiss = { emailing = false })
        if (confirmDelete) {
            AlertDialog(
                onDismissRequest = { confirmDelete = false },
                text = { Text("Delete “${current.title}” with its activities and notes? This cannot be undone.") },
                confirmButton = {
                    LinkButton("Delete deal", color = Palette.danger, onClick = {
                        confirmDelete = false
                        scope.launch { if (model.deleteDeal(current)) nav.pop() }
                    })
                },
                dismissButton = { LinkButton("Cancel", onClick = { confirmDelete = false }) },
            )
        }
    }
    if (scheduling) ActivitySheet(dealId, onDismiss = { scheduling = false })
}

@Composable
private fun Header(deal: DealView) {
    val model = LocalModel.current
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(deal.title, fontWeight = FontWeight.Bold, fontSize = 24.sp, modifier = Modifier.weight(1f, fill = false))
            Spacer(Modifier.width(10.dp))
            StatusPill(deal.status)
        }
        val parts =
            listOf(
                deal.organization,
                deal.contactName.orEmpty(),
                if (deal.owner.isNullOrEmpty()) "" else "owned by ${model.ownerLabel(deal.owner)}",
                if (deal.status == "lost" && deal.lostReason.isNotEmpty()) "lost: ${deal.lostReason}" else "",
            ).filter { it.isNotEmpty() }
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = Palette.ink)) { append(Money.format(deal.value, model.currency)) }
                if (parts.isNotEmpty()) withStyle(SpanStyle(color = Palette.ink2)) { append(" · " + parts.joinToString(" · ")) }
            },
            fontSize = 15.sp,
        )
    }
}

@Composable
private fun StageStrip(deal: DealView) {
    val model = LocalModel.current
    val scope = rememberCoroutineScope()
    val index = model.stages.indexOfFirst { it.id == deal.stageId }
    val open = deal.status == "open"
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            itemsIndexed(model.stages) { i, stage ->
                Surface(
                    onClick = { scope.launch { model.move(deal, stage.id) } },
                    enabled = open && i != index,
                    shape = RoundedCornerShape(999.dp),
                    color =
                        when {
                            i == index -> Palette.lime
                            i < index -> Palette.limeSoft
                            else -> Palette.surface
                        },
                    border = if (i <= index) null else BorderStroke(1.dp, Palette.hairline),
                ) {
                    Text(
                        stage.name,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = if (i <= index) Palette.ink else Palette.ink2,
                        modifier = Modifier.heightIn(min = 32.dp).padding(horizontal = 12.dp, vertical = 7.dp),
                    )
                }
            }
        }
        if (open) {
            val days = maxOf(0, Days.between(deal.stageEnteredAt, model.now(), model.zone))
            Text("In this stage for $days day${if (days == 1) "" else "s"}", fontSize = 12.sp, color = Palette.ink3)
        }
    }
}

@Composable
private fun DetailsCard(
    detail: DealDetail,
    onEdit: () -> Unit,
) {
    val model = LocalModel.current
    val nav = LocalNav.current
    val platform = LocalPlatform.current
    val deal = detail.deal
    val today = Days.startOfDay(model.now(), model.zone)
    CrmCard {
        CardTitle("Details", action = { LinkButton("Edit", onClick = onEdit) })
        InfoRow("Value", Money.format(deal.value, model.currency))
        InfoRow("Organization", deal.organization.ifEmpty { "—" })
        InfoRow("Contact person", deal.contactName ?: "None")
        InfoRow("Owner", model.ownerLabel(deal.owner))
        val close = deal.expectedClose
        InfoRow(
            "Expected close",
            close?.let { Days.short(it, model.zone, model.now()) } ?: "Not set",
            if (deal.status == "open" && close != null && close < today) Palette.danger else Palette.ink,
        )
        InfoRow("Source", deal.source.ifEmpty { "—" })
        var facts = "Added ${Days.short(deal.createdAt, model.zone, model.now())}"
        deal.closedAt?.let { facts += " · closed ${Days.short(it, model.zone, model.now())}" }
        Text(facts, fontSize = 12.sp, color = Palette.ink3)
        detail.contact?.let { c ->
            Divider()
            Row(Modifier.fillMaxWidth().clickable { nav.push(Route.Contact(c.id)) }, verticalAlignment = Alignment.CenterVertically) {
                Avatar(c.name)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(c.name, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                    val sub = listOf(c.jobTitle, c.organization).filter { it.isNotEmpty() }.joinToString(" at ")
                    if (sub.isNotEmpty()) Text(sub, fontSize = 13.sp, color = Palette.ink2)
                }
                Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, contentDescription = null, tint = Palette.ink3)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                if (c.email.isNotEmpty()) {
                    SecondaryButton("Email", onClick = { platform.open("mailto:${c.email}") }, icon = Icons.Outlined.Email, compact = true, modifier = Modifier.weight(1f))
                }
                if (c.phone.isNotEmpty()) {
                    SecondaryButton("Call", onClick = { platform.open("tel:${c.phone.filter { !it.isWhitespace() }}") }, icon = Icons.Outlined.Phone, compact = true, modifier = Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun AssistantCard(
    detail: DealDetail,
    onFix: (DealField?) -> Unit,
    onEmail: () -> Unit,
) {
    val model = LocalModel.current
    val platform = LocalPlatform.current
    val scope = rememberCoroutineScope()
    val deal = detail.deal
    val health = model.health(deal)
    val actions = Assistant.nextActions(deal, model.stages, model.rottingDays, model.now(), model.zone)
    CrmCard {
        CardTitle("Deal assistant", icon = Icons.Outlined.AutoAwesome)
        if (deal.status == "open") {
            Row(verticalAlignment = Alignment.Top) {
                Box(Modifier.size(58.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(
                        progress = { health.score / 100f },
                        modifier = Modifier.size(58.dp),
                        color = Palette.health(health.level),
                        trackColor = Palette.sunken,
                        strokeWidth = 6.dp,
                    )
                    Text("${health.score}", fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
                }
                Spacer(Modifier.width(14.dp))
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(health.level.label, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, color = Palette.health(health.level))
                    Text("Win likelihood ~${health.winLikelihood}% (stage ${deal.probability}%, adjusted for health)", fontSize = 13.sp, color = Palette.ink2)
                    for (r in health.reasons) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Outlined.ErrorOutline, contentDescription = null, modifier = Modifier.size(14.dp))
                            Spacer(Modifier.width(6.dp))
                            Text(r, fontSize = 13.sp)
                        }
                    }
                }
            }
            if (actions.isNotEmpty()) {
                SectionLabel("Suggested next steps")
                for (a in actions) {
                    Row(Modifier.padding(vertical = 4.dp), verticalAlignment = Alignment.Top) {
                        Icon(
                            a.activity?.let { kindIcon(it.kind.raw) } ?: Icons.Outlined.Build,
                            contentDescription = null,
                            tint = Palette.ink2,
                            modifier = Modifier.padding(top = 2.dp).size(18.dp),
                        )
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(a.title, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                            Text(a.why, fontSize = 13.sp, color = Palette.ink2)
                        }
                        Spacer(Modifier.width(6.dp))
                        SmallButton(a.buttonTitle, filled = a.activity != null, onClick = {
                            val s = a.activity
                            if (s != null) scope.launch { model.schedule(s, deal) } else onFix(a.field)
                        })
                    }
                }
            }
        } else {
            Text(
                if (deal.status == "won") "Closed won. Nice work." else "Closed lost. Reopen it if the conversation comes back.",
                fontSize = 15.sp,
                color = Palette.ink2,
            )
        }
        SecondaryButton("Draft follow-up email", onClick = onEmail, icon = Icons.Outlined.Email, compact = true, modifier = Modifier.fillMaxWidth())
        SecondaryButton(
            "Copy AI coaching prompt",
            onClick = {
                platform.copy("Prompt", Assistant.coachingPrompt(detail, model.stages, model.currency, model.rottingDays, model.now(), model.zone))
                model.notice.value = Notice("Prompt copied. Paste it into your AI assistant.")
            },
            icon = Icons.Outlined.ContentCopy,
            compact = true,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun ActivitiesCard(
    detail: DealDetail,
    onSchedule: () -> Unit,
) {
    val open = detail.activities.count { !it.done }
    CrmCard {
        CardTitle("Activities", trailing = "$open open", action = { SmallButton("Schedule", onClick = onSchedule, icon = Icons.Outlined.Add) })
        if (detail.activities.isEmpty()) Text("Nothing scheduled yet.", fontSize = 15.sp, color = Palette.ink2)
        detail.activities.forEachIndexed { i, a ->
            ActivityRow(a, showDeal = false)
            if (i < detail.activities.lastIndex) Divider()
        }
    }
}

@Composable
private fun NotesCard(detail: DealDetail) {
    val model = LocalModel.current
    val scope = rememberCoroutineScope()
    var note by remember { mutableStateOf("") }
    CrmCard {
        CardTitle("Notes")
        TextBox(note, { note = it }, "What did you learn? Budget, decision makers, objections…", singleLine = false, minLines = 2)
        if (note.isNotBlank()) {
            Row(Modifier.fillMaxWidth()) {
                Spacer(Modifier.weight(1f))
                SmallButton("Add note", onClick = {
                    val body = note
                    scope.launch { if (model.addNote(detail.deal.id, body)) note = "" }
                })
            }
        }
        for (n in detail.notes) {
            Row(Modifier.padding(vertical = 4.dp), verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(n.body, fontSize = 15.sp)
                    Text("${model.personLabel(n.author)} · ${Days.ago(n.createdAt, model.now(), model.zone)}", fontSize = 12.sp, color = Palette.ink3)
                }
                if (model.isMe(n.author)) {
                    IconButton(onClick = { scope.launch { model.deleteNote(n) } }) {
                        Icon(Icons.Outlined.Delete, contentDescription = "Delete note", tint = Palette.ink3, modifier = Modifier.size(18.dp))
                    }
                }
            }
        }
    }
}
