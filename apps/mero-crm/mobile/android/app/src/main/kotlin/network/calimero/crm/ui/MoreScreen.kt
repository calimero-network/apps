package network.calimero.crm.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ArrowDownward
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.Remove
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.ViewWeek
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.crm.app.LocalNames
import network.calimero.crm.app.MemoryStore
import network.calimero.crm.app.Notice
import network.calimero.crm.app.Workspace
import network.calimero.crm.app.WorkspacesModel
import network.calimero.crm.core.Account
import network.calimero.crm.core.ActivityKind
import network.calimero.crm.core.HealthLevel
import network.calimero.crm.core.Money
import network.calimero.crm.generated.AutomationView
import network.calimero.crm.generated.StageView

/** Insights, pipeline setup, inviting the team, and the way out. */
@Composable
fun MoreScreen() {
    val model = LocalModel.current
    val nav = LocalNav.current
    val platform = LocalPlatform.current
    var inviting by remember { mutableStateOf(false) }
    var confirmSignOut by remember { mutableStateOf(false) }
    Screen("More", large = true) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item {
                CrmCard(padding = 14.dp) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        AppMark(40)
                        Spacer(Modifier.width(12.dp))
                        Column {
                            Text(model.pipeline.name, fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
                            Text(model.pipeline.workspaceName.ifEmpty { "Workspace" }, fontSize = 13.sp, color = Palette.ink2)
                        }
                    }
                }
            }
            item { SectionLabel("Pipeline") }
            item {
                Group {
                    MoreRow("Insights", Icons.Outlined.BarChart, chevron = true) { nav.push(Route.Insights) }
                    Divider()
                    MoreRow("Stages", Icons.Outlined.ViewWeek, chevron = true) { nav.push(Route.Stages) }
                    Divider()
                    MoreRow("Automations", Icons.Outlined.Bolt, chevron = true) { nav.push(Route.Automations) }
                    Divider()
                    MoreRow("Pipeline settings", Icons.Outlined.Settings, chevron = true) { nav.push(Route.Settings) }
                }
            }
            item { SectionLabel("Workspace") }
            item {
                Group {
                    MoreRow("Invite people", Icons.Outlined.PersonAdd) { inviting = true }
                    Divider()
                    MoreRow("Switch pipeline", Icons.Outlined.GridView) { nav.switchPipeline() }
                }
            }
            item { SectionLabel("Account") }
            item {
                Group {
                    MoreRow("Signed in as ${Account.short(model.me)}", Icons.Outlined.AccountCircle, onClick = null)
                    Divider()
                    MoreRow("Sign out", Icons.AutoMirrored.Outlined.Logout, color = Palette.danger) { confirmSignOut = true }
                }
            }
            item {
                Spacer(Modifier.height(8.dp))
                DetailsDisclosure(
                    listOf(
                        "Pipeline (context)" to model.pipeline.contextId,
                        "Workspace (namespace)" to model.pipeline.namespaceId,
                        "Account" to model.me,
                    ),
                ) {
                    platform.copy("Value", it)
                    model.notice.value = Notice("Copied")
                }
            }
        }
    }
    if (inviting) InviteSheet(onDismiss = { inviting = false })
    if (confirmSignOut) {
        AlertDialog(
            onDismissRequest = { confirmSignOut = false },
            text = { Text("Sign out of Mero CRM on this device?") },
            confirmButton = {
                LinkButton("Sign out", color = Palette.danger, onClick = {
                    confirmSignOut = false
                    nav.signOut()
                })
            },
            dismissButton = { LinkButton("Cancel", onClick = { confirmSignOut = false }) },
        )
    }
}

@Composable
private fun Group(content: @Composable () -> Unit) {
    Surface(shape = RoundedCornerShape(14.dp), color = Palette.surface, border = BorderStroke(1.dp, Palette.hairline)) {
        Column { content() }
    }
}

@Composable
private fun MoreRow(
    title: String,
    icon: ImageVector,
    color: Color = Palette.ink,
    chevron: Boolean = false,
    onClick: (() -> Unit)?,
) {
    val base = Modifier.fillMaxWidth()
    Row(
        (if (onClick != null) base.clickable(onClick = onClick) else base).heightIn(min = 50.dp).padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = if (color == Palette.ink) Palette.ink2 else color, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(14.dp))
        Text(title, fontSize = 16.sp, color = color, modifier = Modifier.weight(1f))
        if (chevron) Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, contentDescription = null, tint = Palette.ink3)
    }
}

/** Mint a link to this workspace and share it. */
@Composable
private fun InviteSheet(onDismiss: () -> Unit) {
    val model = LocalModel.current
    val platform = LocalPlatform.current
    val scope = rememberCoroutineScope()
    val workspaces = remember { WorkspacesModel(model.backend, null, LocalNames(MemoryStore())) }
    var link by remember { mutableStateOf<String?>(null) }
    val busy by workspaces.isWorking.collectAsState()
    val error by workspaces.error.collectAsState()
    val name = model.pipeline.workspaceName

    suspend fun mint() {
        link = workspaces.inviteLink(Workspace(model.pipeline.namespaceId, name, 0, emptyList()))
    }
    LaunchedEffect(Unit) { mint() }
    CrmSheet("Invite people", onDismiss, cancelLabel = "Done") {
        Text(
            "Anyone with this link can join ${name.ifEmpty { "this workspace" }} and see its pipelines. It opens in the app or in the browser.",
            fontSize = 15.sp,
            color = Palette.ink2,
        )
        val current = link
        if (current != null) {
            Surface(shape = RoundedCornerShape(10.dp), color = Palette.surface, border = BorderStroke(1.dp, Palette.hairline), modifier = Modifier.fillMaxWidth()) {
                Text(current, fontFamily = FontFamily.Monospace, fontSize = 13.sp, maxLines = 4, modifier = Modifier.padding(12.dp))
            }
            PrimaryButton("Share link", onClick = { platform.share("Join ${name.ifEmpty { "my workspace" }} on Mero CRM", current) }, icon = Icons.Outlined.Share)
            SecondaryButton("Copy link", onClick = {
                platform.copy("Invitation", current)
                model.notice.value = Notice("Invitation link copied")
            }, icon = Icons.Outlined.ContentCopy, modifier = Modifier.fillMaxWidth())
        } else if (busy) {
            Row(Modifier.fillMaxWidth().padding(vertical = 20.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(18.dp), color = Palette.ink, strokeWidth = 2.dp)
                Spacer(Modifier.width(10.dp))
                Text("Creating a link…", color = Palette.ink2)
            }
        }
        if (error != null) {
            ErrorLine(error)
            SecondaryButton("Try again", onClick = { scope.launch { mint() } }, modifier = Modifier.fillMaxWidth())
        }
    }
}

// Insights

@Composable
fun InsightsScreen() {
    val model = LocalModel.current
    val nav = LocalNav.current
    val state by model.state.collectAsState()
    val s = remember(state.version) { model.stats() }
    val currency = model.currency

    fun m(v: ULong) = Money.format(v, currency, compact = true)
    Screen("Insights", back = true) {
        Refreshable {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                val tiles =
                    listOf(
                        Triple("Open pipeline", m(s.openValue), "${s.openCount} deals"),
                        Triple("Weighted", m(s.weightedValue), "value × stage odds"),
                        Triple("Won this month", m(s.wonThisMonth), "${s.wonCount} won in total"),
                        Triple("Win rate", s.winRate?.let { "$it%" } ?: "—", "${s.wonCount} won · ${s.lostCount} lost"),
                        Triple("Average deal", s.avgWonValue?.let { m(it) } ?: "—", "won deals"),
                        Triple("Sales cycle", s.avgCycleDays?.let { "${it}d" } ?: "—", "created to won"),
                    )
                items(tiles.chunked(2).size) { row ->
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        for ((label, value, sub) in tiles.chunked(2)[row]) Tile(label, value, sub, Modifier.weight(1f))
                    }
                }
                item {
                    CrmCard {
                        CardTitle("Value by stage")
                        val top = maxOf(1uL, s.perStage.maxOfOrNull { it.value } ?: 1uL)
                        for (row in s.perStage) Bar(row.stage.name, "${row.count} · ${m(row.value)}", row.value.toFloat() / top.toFloat())
                    }
                }
                item {
                    CrmCard {
                        CardTitle("Forecast", trailing = "weighted by stage")
                        val top = maxOf(1uL, s.forecast.maxOfOrNull { it.value } ?: 1uL)
                        for (f in s.forecast) Bar(f.label, "${m(f.weighted)} of ${m(f.value)}", f.value.toFloat() / top.toFloat())
                    }
                }
                item {
                    CrmCard {
                        CardTitle("Lost reasons")
                        if (s.lostReasons.isEmpty()) Text("Nothing lost yet.", fontSize = 15.sp, color = Palette.ink2)
                        for (r in s.lostReasons) InfoRow(r.reason, "${r.count}")
                    }
                }
                item {
                    CrmCard {
                        CardTitle("By owner")
                        if (s.byOwner.isEmpty()) Text("No deals yet.", fontSize = 15.sp, color = Palette.ink2)
                        for (o in s.byOwner) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Avatar(model.ownerLabel(o.owner), size = 28.dp)
                                Spacer(Modifier.width(10.dp))
                                Text(model.ownerLabel(o.owner), fontSize = 15.sp, modifier = Modifier.weight(1f))
                                Column(horizontalAlignment = Alignment.End) {
                                    Text("${m(o.wonValue)} won", fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                                    Text("${m(o.openValue)} open", fontSize = 12.sp, color = Palette.ink2)
                                }
                            }
                        }
                    }
                }
                item {
                    val attention =
                        model.openDeals
                            .map { it to model.health(it) }
                            .filter { it.second.level != HealthLevel.HEALTHY }
                            .sortedBy { it.second.score }
                            .take(8)
                    CrmCard {
                        CardTitle("Needs attention")
                        if (attention.isEmpty()) Text("Every open deal is on track.", fontSize = 15.sp, color = Palette.ink2)
                        for ((deal, health) in attention) {
                            Row(Modifier.fillMaxWidth().clickable { nav.push(Route.Deal(deal.id)) }, verticalAlignment = Alignment.Top) {
                                Box(Modifier.padding(top = 6.dp)) { HealthDot(health) }
                                Spacer(Modifier.width(10.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(deal.title, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                                    Text(health.reasons.firstOrNull() ?: health.level.label, fontSize = 13.sp, color = Palette.ink2)
                                }
                                Text("${health.score}", fontWeight = FontWeight.Bold, fontSize = 15.sp, color = Palette.health(health.level))
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Tile(
    label: String,
    value: String,
    sub: String,
    modifier: Modifier,
) {
    Surface(modifier = modifier, shape = RoundedCornerShape(14.dp), color = Palette.surface, border = BorderStroke(1.dp, Palette.hairline)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(label, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink2)
            Text(value, fontSize = 22.sp, fontWeight = FontWeight.Bold, maxLines = 1)
            Text(sub, fontSize = 12.sp, color = Palette.ink3, maxLines = 1)
        }
    }
}

@Composable
private fun Bar(
    label: String,
    detail: String,
    fraction: Float,
) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row {
            Text(label, fontSize = 15.sp, modifier = Modifier.weight(1f))
            Text(detail, fontSize = 13.sp, color = Palette.ink2)
        }
        Box(
            Modifier
                .fillMaxWidth()
                .height(6.dp)
                .clip(CircleShape)
                .background(Palette.sunken),
        ) {
            Box(
                Modifier
                    .fillMaxWidth(fraction.coerceIn(0f, 1f))
                    .height(6.dp)
                    .clip(CircleShape)
                    .background(Palette.lime),
            )
        }
    }
}

// Stages

@Composable
fun StagesScreen() {
    val model = LocalModel.current
    val state by model.state.collectAsState()
    val scope = rememberCoroutineScope()
    var editing by remember { mutableStateOf<StageView?>(null) }
    var adding by remember { mutableStateOf(false) }
    Screen("Stages", back = true) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item {
                Group {
                    state.stages.forEachIndexed { i, stage ->
                        Row(Modifier.fillMaxWidth().padding(start = 14.dp, end = 4.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f).clickable { editing = stage }) {
                                Text(stage.name, fontSize = 16.sp, fontWeight = FontWeight.Medium)
                                val open = model.openDeals(stage.id).size
                                Text("${stage.probability}% win · $open open deal${if (open == 1) "" else "s"}", fontSize = 13.sp, color = Palette.ink2)
                            }
                            IconButton(onClick = { scope.launch { model.moveStage(stage, -1) } }, enabled = i > 0) {
                                Icon(Icons.Outlined.ArrowUpward, contentDescription = "Move ${stage.name} up")
                            }
                            IconButton(onClick = { scope.launch { model.moveStage(stage, 1) } }, enabled = i < state.stages.lastIndex) {
                                Icon(Icons.Outlined.ArrowDownward, contentDescription = "Move ${stage.name} down")
                            }
                        }
                        if (i < state.stages.lastIndex) Divider()
                    }
                }
            }
            item {
                Text(
                    "The columns of your pipeline, in order. Probability drives the weighted forecast.",
                    fontSize = 13.sp,
                    color = Palette.ink2,
                    modifier = Modifier.padding(horizontal = 4.dp),
                )
            }
            item { Group { MoreRow("Add stage", Icons.Outlined.Add) { adding = true } } }
        }
    }
    editing?.let { StageEditorSheet(it, onDismiss = { editing = null }) }
    if (adding) StageEditorSheet(null, onDismiss = { adding = false })
}

@Composable
private fun StageEditorSheet(
    stage: StageView?,
    onDismiss: () -> Unit,
) {
    val model = LocalModel.current
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf(stage?.name.orEmpty()) }
    var probability by remember { mutableStateOf(stage?.probability?.toString() ?: "50") }
    var busy by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    val p = probability.trim().toIntOrNull()?.takeIf { it in 0..100 }
    val openDeals = stage?.let { model.openDeals(it.id).size } ?: 0
    CrmSheet(
        if (stage == null) "New stage" else "Edit stage",
        onDismiss,
        action = if (stage == null) "Add stage" else "Save",
        busy = busy,
        enabled = name.isNotBlank() && p != null,
        onAction = {
            val prob = p ?: return@CrmSheet
            busy = true
            scope.launch {
                val ok = if (stage == null) model.addStage(name, prob) else model.updateStage(stage, name, prob)
                busy = false
                if (ok) onDismiss()
            }
        },
    ) {
        Field("Name", name, { name = it }, "e.g. Demo")
        Field("Win probability (%)", probability, { probability = it }, "0–100", keyboard = KeyboardType.Number)
        if (p == null) Text("A whole number from 0 to 100.", fontSize = 13.sp, color = Palette.danger)
        if (stage != null) {
            SecondaryButton(
                "Delete stage",
                onClick = { confirmDelete = true },
                icon = Icons.Outlined.Delete,
                color = Palette.danger,
                enabled = openDeals == 0,
                modifier = Modifier.fillMaxWidth(),
            )
            if (openDeals > 0) Text("Move its $openDeals open deal${if (openDeals == 1) "" else "s"} first.", fontSize = 13.sp, color = Palette.ink2)
        }
    }
    if (confirmDelete && stage != null) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            text = { Text("Delete the ${stage.name} stage and its automations?") },
            confirmButton = {
                LinkButton("Delete stage", color = Palette.danger, onClick = {
                    confirmDelete = false
                    scope.launch { if (model.deleteStage(stage)) onDismiss() }
                })
            },
            dismissButton = { LinkButton("Cancel", onClick = { confirmDelete = false }) },
        )
    }
}

// Automations (read-only on the phone)

@Composable
fun AutomationsScreen() {
    val model = LocalModel.current
    val state by model.state.collectAsState()
    Screen("Automations", back = true) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item {
                Group {
                    if (state.automations.isEmpty()) Text("No automations yet.", color = Palette.ink2, modifier = Modifier.padding(14.dp))
                    state.automations.forEachIndexed { i, a ->
                        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.Top) {
                            Icon(kindIcon(a.kind), contentDescription = null, tint = if (a.enabled) Palette.ink else Palette.ink3, modifier = Modifier.size(20.dp))
                            Spacer(Modifier.width(12.dp))
                            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(sentence(model.stage(a.stageId)?.name, a), fontSize = 15.sp, color = if (a.enabled) Palette.ink else Palette.ink3)
                                if (!a.enabled) Pill("Off")
                            }
                        }
                        if (i < state.automations.lastIndex) Divider()
                    }
                }
            }
            item {
                Text(
                    "When a deal enters a stage, these schedule an activity for the deal's owner automatically. Add and change them in Mero CRM on the web.",
                    fontSize = 13.sp,
                    color = Palette.ink2,
                    modifier = Modifier.padding(horizontal = 4.dp),
                )
            }
        }
    }
}

private fun sentence(
    stage: String?,
    a: AutomationView,
): String {
    val due = if (a.dueInDays == 0u) "for the same day" else "due in ${a.dueInDays} day${if (a.dueInDays == 1u) "" else "s"}"
    return "When a deal enters ${stage ?: "—"}, schedule ${ActivityKind.label(a.kind).lowercase()} “${a.subject}” $due."
}

// Settings

@Composable
fun PipelineSettingsScreen() {
    val model = LocalModel.current
    val state by model.state.collectAsState()
    val scope = rememberCoroutineScope()
    var currency by remember { mutableStateOf(model.currency) }
    var rotting by remember { mutableStateOf(model.rottingDays) }
    Screen("Pipeline settings", back = true) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            item {
                CrmCard {
                    CardTitle("Currency")
                    Text("Every deal's value is in this currency.", fontSize = 13.sp, color = Palette.ink2)
                    Field("Code", currency, { currency = it.uppercase() }, "USD", capitalization = KeyboardCapitalization.Characters)
                    SmallButton(
                        "Save currency",
                        onClick = { scope.launch { model.setCurrency(currency) } },
                        enabled = currency.uppercase() != state.settings.currency && Money.isValidCode(currency),
                    )
                }
            }
            item {
                CrmCard {
                    CardTitle("Idle threshold")
                    Text("A deal with no activity for longer than this is flagged on the board.", fontSize = 13.sp, color = Palette.ink2)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("$rotting day${if (rotting == 1) "" else "s"}", fontWeight = FontWeight.SemiBold, fontSize = 17.sp, modifier = Modifier.weight(1f))
                        Surface(shape = RoundedCornerShape(10.dp), color = Palette.sunken) {
                            Row {
                                IconButton(onClick = { rotting = (rotting - 1).coerceAtLeast(1) }) { Icon(Icons.Outlined.Remove, contentDescription = "Fewer days") }
                                IconButton(onClick = { rotting = (rotting + 1).coerceAtMost(365) }) { Icon(Icons.Outlined.Add, contentDescription = "More days") }
                            }
                        }
                    }
                    SmallButton(
                        "Save threshold",
                        onClick = { scope.launch { model.setRottingDays(rotting) } },
                        enabled = rotting != state.settings.rottingDays.toInt(),
                    )
                }
            }
        }
    }
}
