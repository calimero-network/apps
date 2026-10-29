package network.calimero.crm.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.AddCircleOutline
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.ViewWeek
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.crm.core.DealDraft
import network.calimero.crm.core.Insights
import network.calimero.crm.core.Money
import network.calimero.crm.generated.DealView
import network.calimero.crm.generated.StageView

/**
 * The board: one swipeable column per stage, with its count, total and win probability, and one
 * card per open deal. A card's menu moves it or closes it.
 */
@Composable
fun BoardScreen() {
    val model = LocalModel.current
    val nav = LocalNav.current
    val state by model.state.collectAsState()
    var newDealStage by remember { mutableStateOf<String?>(null) }
    var acting by remember { mutableStateOf<DealView?>(null) }
    val pager = rememberPagerState { state.stages.size }
    val scope = rememberCoroutineScope()
    val current =
        state.stages.getOrNull(pager.currentPage)?.id ?: state.stages
            .firstOrNull()
            ?.id
            .orEmpty()

    Screen(
        model.pipeline.name,
        navigationIcon = { IconButton(onClick = nav.switchPipeline) { Icon(Icons.Outlined.GridView, contentDescription = "Workspaces") } },
        actions = {
            IconButton(onClick = { newDealStage = current }, enabled = state.stages.isNotEmpty()) {
                Icon(Icons.Outlined.Add, contentDescription = "New deal")
            }
        },
    ) {
        LoadGate {
            if (state.stages.isEmpty()) {
                Column(Modifier.padding(16.dp)) {
                    CrmCard { EmptyState(Icons.Outlined.ViewWeek, "No stages yet", "Add the columns of your pipeline in More → Stages.") }
                }
            } else {
                Column(Modifier.fillMaxSize()) {
                    val open = model.openDeals
                    Row(
                        Modifier.horizontalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 10.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        StatPill("${open.size}", "open deals")
                        StatPill(Money.format(open.sumOf { it.value }, model.currency), "in pipeline")
                        StatPill(Money.format(open.sumOf { Insights.weighted(it) }, model.currency), "weighted")
                    }
                    val tabs = rememberLazyListState()
                    LaunchedEffect(pager.currentPage) { tabs.animateScrollToItem(maxOf(0, pager.currentPage - 1)) }
                    LazyRow(
                        state = tabs,
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 10.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        items(state.stages.size) { i ->
                            val stage = state.stages[i]
                            Chip(stage.name, selected = i == pager.currentPage, count = model.openDeals(stage.id).size) {
                                scope.launch { pager.animateScrollToPage(i) }
                            }
                        }
                    }
                    HorizontalPager(state = pager, modifier = Modifier.weight(1f), key = { state.stages.getOrNull(it)?.id ?: it }) { page ->
                        val stage = state.stages.getOrNull(page) ?: return@HorizontalPager
                        StageColumn(stage, onAdd = { newDealStage = stage.id }, onAct = { acting = it })
                    }
                }
            }
        }
    }
    newDealStage?.let { stage -> DealEditorSheet(initial = DealDraft(stageId = stage), onDismiss = { newDealStage = null }) }
    acting?.let { deal -> DealActionsSheet(deal, onDismiss = { acting = null }) }
}

@Composable
private fun StageColumn(
    stage: StageView,
    onAdd: () -> Unit,
    onAct: (DealView) -> Unit,
) {
    val model = LocalModel.current
    val cards = model.openDeals(stage.id)
    Refreshable {
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                CrmCard(spacing = 8.dp) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(stage.name, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, maxLines = 1)
                        Spacer(Modifier.width(8.dp))
                        Pill("${cards.size}")
                        Spacer(Modifier.weight(1f))
                        Box(
                            Modifier
                                .size(30.dp)
                                .clip(CircleShape)
                                .background(Palette.lime)
                                .clickable(onClick = onAdd),
                            contentAlignment = Alignment.Center,
                        ) { Icon(Icons.Outlined.Add, contentDescription = "Add deal to ${stage.name}", modifier = Modifier.size(18.dp)) }
                    }
                    Row(verticalAlignment = Alignment.Bottom) {
                        Text(Money.format(cards.sumOf { it.value }, model.currency, compact = true), fontWeight = FontWeight.Bold, fontSize = 20.sp)
                        Spacer(Modifier.weight(1f))
                        Text("${stage.probability}% win", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink3)
                    }
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .height(4.dp)
                            .clip(CircleShape)
                            .background(Palette.sunken),
                    ) {
                        Box(
                            Modifier
                                .fillMaxWidth(stage.probability.toFloat() / 100f)
                                .height(4.dp)
                                .clip(CircleShape)
                                .background(Palette.lime),
                        )
                    }
                }
            }
            items(cards, key = { it.id }) { deal -> DealCard(deal, onAct = { onAct(deal) }) }
            if (cards.isEmpty()) {
                item {
                    Surface(
                        onClick = onAdd,
                        shape = RoundedCornerShape(14.dp),
                        color = Palette.background,
                        border = BorderStroke(1.5.dp, Palette.hairline),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(Modifier.padding(vertical = 26.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(Icons.Outlined.AddCircleOutline, contentDescription = null, tint = Palette.ink2)
                            Spacer(Modifier.height(6.dp))
                            Text("No deals in this stage. Add one.", color = Palette.ink2, fontSize = 15.sp)
                        }
                    }
                }
            }
        }
    }
}

/** A deal on the board: value, who, the next step and whether it is late, health. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun DealCard(
    deal: DealView,
    onAct: () -> Unit,
) {
    val model = LocalModel.current
    val nav = LocalNav.current
    val health = model.health(deal)
    val who = listOf(deal.organization, deal.contactName.orEmpty()).filter { it.isNotEmpty() }.joinToString(" · ")
    Box(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Palette.surface)
            .border(
                if (health.rotting) 1.dp else 1.dp,
                if (health.rotting) Palette.danger.copy(alpha = 0.4f) else Palette.hairline,
                RoundedCornerShape(14.dp),
            ).combinedClickable(onClick = { nav.push(Route.Deal(deal.id)) }, onLongClick = onAct),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Box(Modifier.padding(top = 6.dp)) { HealthDot(health) }
                Spacer(Modifier.width(8.dp))
                Text(deal.title, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, modifier = Modifier.weight(1f).padding(end = 32.dp))
            }
            if (who.isNotEmpty()) Text(who, fontSize = 13.sp, color = Palette.ink2, maxLines = 1)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(Money.format(deal.value, model.currency), fontWeight = FontWeight.Bold, fontSize = 15.sp, modifier = Modifier.weight(1f))
                Avatar(model.ownerLabel(deal.owner), size = 24.dp)
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                val next = deal.nextActivity
                if (next != null) DueChip(next.kind, next.dueAt, next.subject) else Pill("No next step", fg = Palette.warn, bg = Palette.warnSoft)
                if (health.rotting) Text("Idle ${health.idleDays}d", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Palette.danger)
            }
        }
        IconButton(onClick = onAct, modifier = Modifier.align(Alignment.TopEnd)) {
            Icon(Icons.Outlined.MoreHoriz, contentDescription = "Move or close ${deal.title}", tint = Palette.ink2)
        }
    }
}
