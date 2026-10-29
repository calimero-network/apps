package network.calimero.battleships.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.Flag
import androidx.compose.material.icons.filled.GpsFixed
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Replay
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material.icons.filled.SwapVert
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.HourglassEmpty
import androidx.compose.material.icons.outlined.MobileOff
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import network.calimero.battleships.core.ErrorText
import network.calimero.battleships.core.Fleet
import network.calimero.battleships.core.MatchMaker
import network.calimero.battleships.core.MatchModel
import network.calimero.battleships.core.MatchModel.Stage
import network.calimero.battleships.core.Names

private enum class Waters(
    val label: String,
) {
    THEIRS("Their waters"),
    YOURS("Your fleet"),
}

/** One match: place your fleet, take turns, see the audited result, rematch. */
@Suppress("LongMethod", "CyclomaticComplexMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MatchScreen(
    model: MatchModel,
    route: MatchRoute,
    back: () -> Unit,
    rematched: (MatchRoute) -> Unit,
) {
    val stage by model.stage.collectAsState()
    val notice by model.notice.collectAsState()
    val syncing by model.syncing.collectAsState()
    val layout by model.layout.collectAsState()
    val selected by model.selectedShip.collectAsState()
    val horizontal by model.horizontal.collectAsState()
    val shots by model.shots.collectAsState()
    val ownBoard by model.ownBoard.collectAsState()
    val aim by model.aim.collectAsState()
    val busy by model.busy.collectAsState()
    // Read so a turn change recomposes the turn banner and isMyTurn.
    val turn by model.turn.collectAsState()
    val state by model.state.collectAsState()
    val scope = rememberCoroutineScope()
    var waters by remember { mutableStateOf(Waters.THEIRS) }
    var rematching by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    val opponentName = Names.player(route.ref.opponent, route.me)
    val enemySunk = model.enemySunk(shots)
    val ownSunk = model.ownSunk(ownBoard)
    val myTurn = turn != null && state != null && model.isMyTurn

    LaunchedEffect(model) {
        model.refresh()
        model.live()
    }

    fun rematch() {
        if (rematching) return
        rematching = true
        scope.launch {
            try {
                val ref = MatchMaker.create(model.backend, route.lobby, route.ref.lobbyContextId, route.ref.opponent)
                rematched(MatchRoute(ref, route.me, route.lobby))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                model.notice.value = ErrorText.describe(e, "Couldn't start a rematch. Try again.")
            }
            rematching = false
        }
    }

    Column(Modifier.fillMaxSize().background(Palette.Ground)) {
        TopBar("vs $opponentName", back)
        NoticeBanner(notice) { model.notice.value = null }
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                scope.launch {
                    refreshing = true
                    model.refresh()
                    refreshing = false
                }
            },
            modifier = Modifier.weight(1f),
        ) {
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                when (val current = stage) {
                    Stage.Loading ->
                        Column(Modifier.fillMaxWidth().padding(vertical = 80.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            CircularProgressIndicator(color = Palette.Ink)
                            Spacer(Modifier.height(12.dp))
                            Text(
                                if (syncing) "Waiting for the match to reach your relay…" else "Opening the match…",
                                fontSize = 15.sp,
                                color = Palette.Muted,
                                textAlign = TextAlign.Center,
                            )
                        }
                    is Stage.Failed -> ErrorState(current.message) { scope.launch { model.refresh() } }
                    Stage.Placing -> {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text("Place your fleet", fontFamily = Display, fontWeight = FontWeight.SemiBold, fontSize = 22.sp, color = Palette.Ink)
                            Text(
                                "Tap a square to place the selected ship. Tap a placed ship to turn it. Ships can't touch.",
                                fontSize = 15.sp,
                                color = Palette.Muted,
                            )
                        }
                        Card(padding = 12.dp) { BoardGrid(BoardLooks.placement(layout, selected)) { model.tapPlacement(it) } }
                        ShipTray(model, layout.ships.map { it != null }, selected)
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            SecondaryButton(
                                if (horizontal) "Across" else "Down",
                                model::toggleOrientation,
                                compact = true,
                                icon = if (horizontal) Icons.Filled.SwapHoriz else Icons.Filled.SwapVert,
                            )
                            SecondaryButton("Shuffle", model::shuffle, compact = true, icon = Icons.Filled.Shuffle)
                            SecondaryButton("Clear", model::clearLayout, compact = true, enabled = layout.placedCount > 0, icon = Icons.Outlined.Delete)
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Filled.Lock, contentDescription = null, tint = Palette.Muted, modifier = Modifier.size(14.dp))
                            Spacer(Modifier.width(8.dp))
                            Text(
                                "Your board stays on this phone. Only a sealed fingerprint of it is shared until the match ends.",
                                fontSize = 13.sp,
                                color = Palette.Muted,
                            )
                        }
                    }
                    Stage.Waiting -> {
                        Card {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                CircularProgressIndicator(Modifier.size(22.dp), color = Palette.Ink, strokeWidth = 2.dp)
                                Spacer(Modifier.width(12.dp))
                                Column {
                                    Text("Fleet deployed", fontFamily = Display, fontWeight = FontWeight.SemiBold, fontSize = 18.sp, color = Palette.Ink)
                                    Text("Waiting for $opponentName to place theirs.", fontSize = 15.sp, color = Palette.Muted)
                                }
                            }
                        }
                        SectionLabel("Your fleet")
                        Card(padding = 12.dp) { BoardGrid(BoardLooks.own(ownBoard, ownSunk)) }
                    }
                    Stage.Battle -> {
                        TurnBanner(model.turnText, myTurn)
                        Segmented(Waters.entries, waters, { it.label }) { waters = it }
                        Card(padding = 12.dp) {
                            if (waters == Waters.THEIRS) {
                                BoardGrid(BoardLooks.enemy(shots, enemySunk, aim)) { cell -> scope.launch { model.tapTarget(cell) } }
                            } else {
                                BoardGrid(BoardLooks.own(ownBoard, ownSunk))
                            }
                        }
                        FleetStatus(enemySunk.size, ownSunk.size, legend = true)
                    }
                    Stage.Finished -> {
                        ResultCard(model.outcome ?: MatchModel.Outcome.AUDITING, model.endedText, opponentName)
                        Segmented(Waters.entries, waters, { it.label }) { waters = it }
                        Card(padding = 12.dp) {
                            if (waters == Waters.THEIRS) {
                                BoardGrid(BoardLooks.enemy(shots, enemySunk, null))
                            } else {
                                BoardGrid(BoardLooks.own(ownBoard, ownSunk))
                            }
                        }
                        FleetStatus(enemySunk.size, ownSunk.size, legend = false)
                    }
                    Stage.BoardMissing ->
                        Card {
                            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                SymbolTile(Icons.Outlined.MobileOff, tone = Palette.DangerSoft, tint = Palette.Danger)
                                Text("Your fleet is on another device", fontFamily = Display, fontWeight = FontWeight.SemiBold, fontSize = 19.sp, color = Palette.Ink)
                                Text(
                                    "You deployed this match's fleet somewhere else. Only that device holds the board, so only it can answer shots and reveal it at the end. Open the match there.",
                                    fontSize = 15.sp,
                                    color = Palette.Muted,
                                )
                            }
                        }
                }
                DetailsDisclosure(
                    listOf(
                        "Match" to route.ref.matchId,
                        "Match context" to route.ref.contextId,
                        "Lobby context" to route.ref.lobbyContextId,
                        "You play as" to route.me,
                        "Opponent" to route.ref.opponent,
                        "Your commitment" to (model.stored?.commitment ?: ""),
                    ),
                )
            }
        }
        BottomBar(
            stage = stage,
            aimLabel = aim?.label,
            placed = layout.placedCount,
            complete = layout.isComplete,
            busy = busy,
            rematching = rematching,
            deploy = { scope.launch { model.deploy() } },
            clearAim = model::clearAim,
            fire = { scope.launch { model.fire() } },
            lobby = back,
            rematch = ::rematch,
        )
    }
}

@Suppress("LongParameterList")
@Composable
private fun BottomBar(
    stage: Stage,
    aimLabel: String?,
    placed: Int,
    complete: Boolean,
    busy: Boolean,
    rematching: Boolean,
    deploy: () -> Unit,
    clearAim: () -> Unit,
    fire: () -> Unit,
    lobby: () -> Unit,
    rematch: () -> Unit,
) {
    val content: (@Composable () -> Unit)? =
        when {
            stage == Stage.Placing -> {
                {
                    PrimaryButton(
                        if (complete) "Deploy fleet" else "Place ${Fleet.classes.size - placed} more",
                        deploy,
                        enabled = complete,
                        busy = busy,
                        icon = Icons.Outlined.VerifiedUser,
                    )
                }
            }
            stage == Stage.Battle && aimLabel != null -> {
                {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            Modifier
                                .size(50.dp)
                                .clip(CircleShape)
                                .background(Palette.Surface)
                                .border(1.dp, Palette.Hairline, CircleShape),
                            contentAlignment = Alignment.Center,
                        ) {
                            IconButton(onClick = clearAim) { Icon(Icons.Filled.Close, contentDescription = "Cancel aim", tint = Palette.Ink) }
                        }
                        Spacer(Modifier.width(10.dp))
                        PrimaryButton("Fire at $aimLabel", fire, busy = busy, icon = Icons.Filled.GpsFixed, modifier = Modifier.weight(1f))
                    }
                }
            }
            stage == Stage.Finished -> {
                {
                    Row {
                        SecondaryButton("Lobby", lobby, modifier = Modifier.weight(1f))
                        Spacer(Modifier.width(10.dp))
                        PrimaryButton("Rematch", rematch, busy = rematching, icon = Icons.Filled.Replay, modifier = Modifier.weight(1f))
                    }
                }
            }
            else -> null
        }
    if (content != null) {
        Box(Modifier.background(Palette.Ground).navigationBarsPadding().padding(horizontal = 16.dp, vertical = 10.dp)) { content() }
    }
}

/** The five ships: tap one to select it (to place or move it); long-press a placed one to take it back. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ShipTray(
    model: MatchModel,
    placed: List<Boolean>,
    selected: Int?,
) {
    var menuFor by remember { mutableStateOf<Int?>(null) }
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Fleet.classes.forEachIndexed { index, ship ->
            val isPlaced = placed.getOrElse(index) { false }
            val isSelected = selected == index
            val shape = RoundedCornerShape(12.dp)
            Box {
                Column(
                    Modifier
                        .clip(shape)
                        .background(if (isSelected) Palette.Lime else Palette.Surface)
                        .border(if (isSelected) 1.dp else 0.5.dp, if (isSelected) Palette.Lime else Palette.Hairline, shape)
                        .combinedClickable(onClick = { model.select(index) }, onLongClick = { if (isPlaced) menuFor = index })
                        .padding(horizontal = 12.dp, vertical = 10.dp)
                        .semantics { contentDescription = "${ship.name}, ${ship.length} squares${if (isPlaced) ", placed" else ""}" },
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(ship.name, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
                        if (isPlaced) {
                            Spacer(Modifier.width(4.dp))
                            Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(12.dp))
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                        repeat(ship.length) {
                            Box(
                                Modifier
                                    .size(10.dp)
                                    .clip(RoundedCornerShape(2.dp))
                                    .background(if (isSelected) Palette.Ink else Palette.Ship.copy(alpha = if (isPlaced) 0.35f else 0.85f)),
                            )
                        }
                    }
                }
                DropdownMenu(expanded = menuFor == index, onDismissRequest = { menuFor = null }) {
                    DropdownMenuItem(
                        text = { Text("Take back", color = Palette.Danger) },
                        leadingIcon = { Icon(Icons.AutoMirrored.Filled.Undo, contentDescription = null, tint = Palette.Danger) },
                        onClick = {
                            model.remove(index)
                            menuFor = null
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun TurnBanner(
    text: String,
    mine: Boolean,
) {
    val shape = RoundedCornerShape(14.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (mine) Palette.Lime else Palette.Surface)
            .border(if (mine) 0.dp else 0.5.dp, if (mine) Palette.Lime else Palette.Hairline, shape)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(if (mine) Icons.Filled.GpsFixed else Icons.Outlined.HourglassEmpty, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(10.dp))
        Text(text, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
    }
}

@Composable
private fun FleetStatus(
    theirsSunk: Int,
    yoursSunk: Int,
    legend: Boolean,
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StatusTile("Their fleet", theirsSunk, Modifier.weight(1f))
            StatusTile("Your fleet", yoursSunk, Modifier.weight(1f))
        }
        if (legend) {
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                LegendKey(SquareLook.Hit, "Hit")
                LegendKey(SquareLook.Sunk, "Sunk")
                LegendKey(SquareLook.Miss, "Miss")
                LegendKey(SquareLook.Pending, "Waiting")
            }
        }
    }
}

@Composable
private fun StatusTile(
    title: String,
    sunk: Int,
    modifier: Modifier,
) {
    val shape = RoundedCornerShape(12.dp)
    Column(
        modifier
            .clip(shape)
            .background(Palette.Surface)
            .border(0.5.dp, Palette.Hairline, shape)
            .padding(12.dp),
    ) {
        Text(title, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = Palette.Muted)
        Text("$sunk of ${Fleet.classes.size} sunk", fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
    }
}

@Composable
private fun LegendKey(
    look: SquareLook,
    label: String,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Swatch(look)
        Spacer(Modifier.width(6.dp))
        Text(label, fontSize = 13.sp, color = Palette.Muted)
    }
}

@Composable
private fun ResultCard(
    outcome: MatchModel.Outcome,
    detail: String?,
    opponent: String,
) {
    val (title, subtitle) =
        when (outcome) {
            MatchModel.Outcome.WON -> "Victory" to "You sank $opponent's fleet, and your board checked out."
            MatchModel.Outcome.LOST -> "Defeat" to "$opponent sank your fleet."
            MatchModel.Outcome.AUDITING -> "Checking the boards" to "Both boards are revealed and checked against every answer. This takes a moment."
            MatchModel.Outcome.VOID -> "No winner" to "Neither board matched its answers."
        }
    val icon: ImageVector
    val tone: Color
    val tint: Color
    when (outcome) {
        MatchModel.Outcome.WON -> {
            icon = Icons.Filled.EmojiEvents
            tone = Palette.Lime
            tint = Palette.Ink
        }
        MatchModel.Outcome.LOST -> {
            icon = Icons.Filled.Flag
            tone = Palette.Sunken
            tint = Palette.Ink
        }
        MatchModel.Outcome.AUDITING -> {
            icon = Icons.Outlined.VerifiedUser
            tone = Palette.PendingSoft
            tint = Palette.Pending
        }
        MatchModel.Outcome.VOID -> {
            icon = Icons.Outlined.WarningAmber
            tone = Palette.DangerSoft
            tint = Palette.Danger
        }
    }
    val shape = RoundedCornerShape(16.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(Palette.Surface)
            .border(0.5.dp, Palette.Hairline, shape)
            .padding(vertical = 24.dp, horizontal = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(68.dp).clip(CircleShape).background(tone), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(30.dp))
        }
        Text(title, fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 28.sp, color = Palette.Ink)
        Text(detail ?: subtitle, fontSize = 15.sp, color = Palette.Muted, textAlign = TextAlign.Center)
    }
}
