package network.calimero.crm.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ListAlt
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import network.calimero.crm.core.Days
import network.calimero.crm.core.Insights
import network.calimero.crm.core.Money
import network.calimero.crm.generated.DealView

enum class DealStatusFilter(
    val raw: String,
    val title: String,
) {
    OPEN("open", "Open"),
    WON("won", "Won"),
    LOST("lost", "Lost"),
    ALL("all", "All"),
}

enum class DealSort(
    val title: String,
) {
    CREATED("Newest"),
    VALUE("Value"),
    CLOSE("Expected close"),
    HEALTH("Health"),
}

/** Every deal as a list: for when the board is too visual. */
@Composable
fun DealsScreen() {
    val model = LocalModel.current
    val state by model.state.collectAsState()
    var status by rememberSaveable { mutableStateOf(DealStatusFilter.OPEN) }
    var sort by rememberSaveable { mutableStateOf(DealSort.CREATED) }
    var mine by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    var creating by remember { mutableStateOf(false) }
    var acting by remember { mutableStateOf<DealView?>(null) }
    var menu by remember { mutableStateOf(false) }

    Screen(
        "Deals",
        large = true,
        navigationIcon = {
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.FilterList, contentDescription = "Sort and filter") }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    for (s in DealSort.entries) {
                        DropdownMenuItem(
                            text = { Text(s.title) },
                            trailingIcon = { if (s == sort) Icon(Icons.Outlined.Check, contentDescription = null) },
                            onClick = {
                                sort = s
                                menu = false
                            },
                        )
                    }
                    Divider()
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
        actions = {
            IconButton(onClick = { creating = true }, enabled = state.stages.isNotEmpty()) { Icon(Icons.Outlined.Add, contentDescription = "New deal") }
        },
    ) {
        LoadGate {
            val list =
                state.deals
                    .filter { status == DealStatusFilter.ALL || it.status == status.raw }
                    .filter { !mine || model.isMe(it.owner) }
                    .filter { Insights.dealMatches(it, query, model::ownerLabel) }
            val rows =
                when (sort) {
                    DealSort.CREATED -> list.sortedByDescending { it.createdAt }
                    DealSort.VALUE -> list.sortedByDescending { it.value }
                    DealSort.CLOSE -> list.sortedBy { it.expectedClose ?: ULong.MAX_VALUE }
                    DealSort.HEALTH -> list.sortedBy { model.health(it).score }
                }
            Refreshable {
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    item { SearchBox(query, { query = it }, "Search deals") }
                    item {
                        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            for (f in DealStatusFilter.entries) {
                                val count = if (f == DealStatusFilter.ALL) state.deals.size else state.deals.count { it.status == f.raw }
                                Chip(f.title, selected = status == f, count = count) { status = f }
                            }
                        }
                    }
                    item {
                        Text(
                            "${rows.size} deals · ${Money.format(rows.sumOf { it.value }, model.currency)}",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Palette.ink2,
                        )
                    }
                    if (rows.isEmpty()) {
                        item {
                            EmptyState(
                                Icons.AutoMirrored.Outlined.ListAlt,
                                if (query.isEmpty()) "No ${if (status == DealStatusFilter.ALL) "" else status.raw + " "}deals" else "No deals match “$query”",
                                if (status == DealStatusFilter.OPEN) "Add one with the + button." else null,
                            )
                        }
                    } else {
                        items(rows, key = { it.id }) { deal ->
                            CrmCard(padding = 14.dp) { DealRow(deal, onLongPress = if (deal.status == "open") ({ acting = deal }) else null) }
                        }
                    }
                }
            }
        }
    }
    if (creating) DealEditorSheet(onDismiss = { creating = false })
    acting?.let { DealActionsSheet(it, onDismiss = { acting = null }) }
}

/** A search field. */
@Composable
fun SearchBox(
    value: String,
    onChange: (String) -> Unit,
    placeholder: String,
) {
    Box {
        TextBox(value, onChange, placeholder, capitalization = KeyboardCapitalization.None)
        Icon(
            Icons.Outlined.Search,
            contentDescription = null,
            tint = Palette.ink3,
            modifier = Modifier.align(Alignment.CenterEnd).padding(end = 14.dp),
        )
    }
}

/** A deal in a list. Tap opens it; long-press offers "Move to stage…". */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun DealRow(
    deal: DealView,
    onLongPress: (() -> Unit)? = null,
) {
    val model = LocalModel.current
    val nav = LocalNav.current
    val health = model.health(deal)
    Column(
        Modifier.fillMaxWidth().combinedClickable(onClick = { nav.push(Route.Deal(deal.id)) }, onLongClick = onLongPress),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (deal.status == "open") {
                HealthDot(health)
                Spacer(Modifier.width(8.dp))
            }
            Text(deal.title, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 2, modifier = Modifier.weight(1f))
            Text(Money.format(deal.value, model.currency), fontWeight = FontWeight.Bold, fontSize = 15.sp)
        }
        val who = listOf(deal.organization, deal.contactName.orEmpty()).filter { it.isNotEmpty() }.joinToString(" · ")
        if (who.isNotEmpty()) Text(who, fontSize = 13.sp, color = Palette.ink2, maxLines = 1)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            if (deal.status == "open") {
                Pill(model.stage(deal.stageId)?.name ?: "—")
                val next = deal.nextActivity
                if (next != null) DueChip(next.kind, next.dueAt) else Pill("No next step", fg = Palette.warn, bg = Palette.warnSoft)
            } else {
                StatusPill(deal.status)
                if (deal.lostReason.isNotEmpty()) Text(deal.lostReason, fontSize = 12.sp, color = Palette.ink2, maxLines = 1)
            }
            Spacer(Modifier.weight(1f))
            deal.expectedClose?.let { close ->
                val late = deal.status == "open" && close < Days.startOfDay(model.now(), model.zone)
                Text(Days.short(close, model.zone, model.now()), fontSize = 12.sp, color = if (late) Palette.danger else Palette.ink3)
            }
        }
    }
}
