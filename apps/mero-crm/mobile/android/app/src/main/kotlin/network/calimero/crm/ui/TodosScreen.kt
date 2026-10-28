package network.calimero.crm.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material.icons.outlined.WbTwilight
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.crm.core.ActivityBucket
import network.calimero.crm.core.ActivityKind
import network.calimero.crm.core.Days
import network.calimero.crm.core.Insights
import network.calimero.crm.generated.ActivityView

/**
 * The to-do list: every call, meeting and task across the pipeline, grouped by when it is due.
 * Overdue first, because that is the list that loses deals.
 */
@Composable
fun TodosScreen() {
    val model = LocalModel.current
    val state by model.state.collectAsState()
    var kind by rememberSaveable { mutableStateOf<ActivityKind?>(null) }
    var mine by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    var creating by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }

    Screen(
        "To-dos",
        large = true,
        navigationIcon = {
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.FilterList, contentDescription = "Filter") }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(
                        text = { Text("Only mine") },
                        trailingIcon = { if (mine) Icon(Icons.Outlined.Check, contentDescription = null) },
                        onClick = {
                            mine = !mine
                            menu = false
                        },
                    )
                }
            }
        },
        actions = { IconButton(onClick = { creating = true }) { Icon(Icons.Outlined.Add, contentDescription = "Schedule an activity") } },
    ) {
        LoadGate {
            val list =
                state.activities
                    .filter { kind == null || it.kind == kind!!.raw }
                    .filter { !mine || model.isMe(it.owner) }
                    .filter { Insights.activityMatches(it, query) }
            val buckets = Insights.buckets(list, model.now(), model.zone)
            Refreshable {
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    item { SearchBox(query, { query = it }, "Search to-dos") }
                    item {
                        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Chip("All", selected = kind == null) { kind = null }
                            for (k in ActivityKind.entries) Chip(k.label, selected = kind == k, icon = kindIcon(k.raw)) { kind = k }
                        }
                    }
                    item {
                        val overdue = buckets.getValue(ActivityBucket.OVERDUE).size
                        Text(
                            buildAnnotatedString {
                                withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = if (overdue > 0) Palette.danger else Palette.ink)) { append("$overdue") }
                                append(" overdue · ")
                                withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = Palette.ink)) { append("${buckets.getValue(ActivityBucket.TODAY).size}") }
                                append(" today · ")
                                withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = Palette.ink)) { append("${buckets.getValue(ActivityBucket.UPCOMING).size}") }
                                append(" upcoming")
                            },
                            fontSize = 13.sp,
                            color = Palette.ink2,
                        )
                    }
                    if (list.isEmpty()) {
                        item {
                            EmptyState(
                                Icons.Outlined.Checklist,
                                "No activities",
                                "Schedule one with the + button, or from a deal. Automations can schedule them for you.",
                            )
                        }
                    } else {
                        for (bucket in ActivityBucket.entries) {
                            val all = buckets.getValue(bucket)
                            val shown = if (bucket == ActivityBucket.DONE) all.take(20) else all
                            if (shown.isEmpty() && bucket.emptyText == null) continue
                            item(key = "h-${bucket.name}") {
                                SectionLabel("${bucket.title} · ${shown.size}", color = if (bucket == ActivityBucket.OVERDUE) Palette.danger else Palette.ink2)
                            }
                            if (shown.isEmpty()) {
                                item(key = "e-${bucket.name}") { CrmCard(padding = 14.dp) { Text(bucket.emptyText.orEmpty(), fontSize = 13.sp, color = Palette.ink3) } }
                            }
                            items(shown, key = { it.id }) { a -> SwipeableActivity(a) }
                        }
                    }
                }
            }
        }
    }
    if (creating) ActivitySheet(null, onDismiss = { creating = false })
}

/** Swipe right: done (or not done). Swipe left: delete. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SwipeableActivity(a: ActivityView) {
    val model = LocalModel.current
    val scope = rememberCoroutineScope()
    val swipe =
        rememberSwipeToDismissBoxState(
            confirmValueChange = { value ->
                when (value) {
                    SwipeToDismissBoxValue.StartToEnd -> scope.launch { model.setDone(a, !a.done) }
                    SwipeToDismissBoxValue.EndToStart -> scope.launch { model.deleteActivity(a) }
                    SwipeToDismissBoxValue.Settled -> Unit
                }
                false
            },
        )
    SwipeToDismissBox(
        state = swipe,
        backgroundContent = {
            val toDone = swipe.dismissDirection == SwipeToDismissBoxValue.StartToEnd
            Row(
                Modifier
                    .fillMaxSize()
                    .clip(RoundedCornerShape(14.dp))
                    .background(if (toDone) Palette.good else Palette.danger)
                    .padding(horizontal = 20.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (!toDone) Spacer(Modifier.weight(1f))
                Icon(if (toDone) Icons.Outlined.Check else Icons.Outlined.Delete, contentDescription = null, tint = Palette.surface)
                Spacer(Modifier.width(6.dp))
                Text(if (toDone) (if (a.done) "Not done" else "Done") else "Delete", color = Palette.surface, fontWeight = FontWeight.SemiBold)
            }
        },
    ) {
        CrmCard(padding = 12.dp) { ActivityRow(a, showDeal = true) }
    }
}

/** One activity: tick it off, see what and when, snooze or delete it. */
@Composable
fun ActivityRow(
    a: ActivityView,
    showDeal: Boolean,
) {
    val model = LocalModel.current
    val nav = LocalNav.current
    val scope = rememberCoroutineScope()
    var menu by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        IconButton(onClick = { scope.launch { model.setDone(a, !a.done) } }, modifier = Modifier.size(32.dp)) {
            Icon(
                if (a.done) Icons.Filled.CheckCircle else Icons.Outlined.RadioButtonUnchecked,
                contentDescription = if (a.done) "Mark “${a.subject}” not done" else "Mark “${a.subject}” done",
                tint = if (a.done) Palette.good else Palette.ink3,
            )
        }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f).padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(kindIcon(a.kind), contentDescription = null, tint = Palette.ink2, modifier = Modifier.size(15.dp))
                Spacer(Modifier.width(6.dp))
                Text(
                    a.subject,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Medium,
                    color = if (a.done) Palette.ink3 else Palette.ink,
                    textDecoration = if (a.done) TextDecoration.LineThrough else null,
                )
            }
            if (a.note.isNotEmpty() && !showDeal) Text(a.note, fontSize = 13.sp, color = Palette.ink2, maxLines = 3)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (a.done) {
                    Text("Done ${Days.ago(a.doneAt ?: 0uL, model.now(), model.zone)}", fontSize = 12.sp, color = Palette.ink3)
                } else {
                    DueChip(a.kind, a.dueAt)
                }
                if (a.automationId != null) Pill("Auto", Icons.Outlined.Bolt)
                if (showDeal) {
                    val owner = if (a.owner.isNullOrEmpty()) "" else " · ${model.ownerLabel(a.owner)}"
                    Text((a.dealTitle ?: "No deal") + owner, fontSize = 12.sp, color = Palette.ink2, maxLines = 1)
                }
            }
        }
        Box {
            IconButton(onClick = { menu = true }, modifier = Modifier.size(32.dp)) {
                Icon(Icons.Outlined.MoreHoriz, contentDescription = "More for “${a.subject}”", tint = Palette.ink3)
            }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                val dealId = a.dealId
                if (showDeal && dealId != null) {
                    DropdownMenuItem(text = { Text("Open deal") }, leadingIcon = { Icon(Icons.AutoMirrored.Outlined.OpenInNew, null) }, onClick = {
                        menu = false
                        nav.push(Route.Deal(dealId))
                    })
                }
                if (!a.done) {
                    DropdownMenuItem(text = { Text("Tomorrow") }, leadingIcon = { Icon(Icons.Outlined.WbTwilight, null) }, onClick = {
                        menu = false
                        scope.launch { model.snooze(a) }
                    })
                }
                DropdownMenuItem(
                    text = { Text("Delete", color = Palette.danger) },
                    leadingIcon = { Icon(Icons.Outlined.Delete, null, tint = Palette.danger) },
                    onClick = {
                        menu = false
                        scope.launch { model.deleteActivity(a) }
                    },
                )
            }
        }
    }
}
