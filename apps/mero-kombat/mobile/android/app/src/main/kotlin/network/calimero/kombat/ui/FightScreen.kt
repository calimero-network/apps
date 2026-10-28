package network.calimero.kombat.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.VolumeOff
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.FormatListNumbered
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.SportsMartialArts
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.calimero.mero.app.MeroAppBackend
import com.calimero.mero.presence.RelayPresenceClient
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import network.calimero.kombat.app.ArenaModel
import network.calimero.kombat.app.ArenaRef
import network.calimero.kombat.app.ArenaState
import network.calimero.kombat.app.FighterInfo
import network.calimero.kombat.app.GameHost
import network.calimero.kombat.app.GameMode
import network.calimero.kombat.app.KombatConstants
import network.calimero.kombat.app.KombatText
import network.calimero.kombat.app.PlayerStore
import network.calimero.kombat.app.PracticeModel
import network.calimero.kombat.app.PresenceChannel
import network.calimero.kombat.app.RelayPresenceChannel
import network.calimero.kombat.generated.ArenaView
import network.calimero.kombat.generated.FighterView

/**
 * The fight, full screen and sideways: the game page edge to edge, the pad under the thumbs, a slim
 * bar of round buttons on top. Shared by an arena and practice. (iOS `FightStage`.)
 *
 * Held on screen: the display never sleeps mid-round. Sent to the background: the page stops, every
 * pad button is let go, and it picks up where it was on return.
 */
@Composable
fun FightStage(
    host: GameHost,
    showPad: Boolean,
    pad: FightPad,
    onPause: () -> Unit,
    onResume: () -> Unit,
    bar: @Composable RowScope.() -> Unit,
    bottom: @Composable ColumnScope.() -> Unit,
) {
    val view = LocalView.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(view, host) {
        view.keepScreenOn = true
        pad.view = view
        pad.send = { host.deliver?.invoke(it) }
        val observer =
            LifecycleEventObserver { _, event ->
                when (event) {
                    Lifecycle.Event.ON_PAUSE -> {
                        pad.releaseAll()
                        onPause()
                    }
                    Lifecycle.Event.ON_RESUME -> onResume()
                    else -> Unit
                }
            }
        lifecycle.addObserver(observer)
        onDispose {
            lifecycle.removeObserver(observer)
            pad.releaseAll()
            pad.send = null
            view.keepScreenOn = false
        }
    }

    Box(Modifier.fillMaxSize().background(KombatColors.Stage)) {
        GameWebView(host, Modifier.fillMaxSize())
        Column(Modifier.fillMaxSize().safeDrawingPadding()) {
            Row(
                Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
                content = bar,
            )
            Spacer(Modifier.weight(1f))
            Box(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, bottom = 12.dp), contentAlignment = Alignment.BottomCenter) {
                if (showPad) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
                        DPadView(pad)
                        Spacer(Modifier.weight(1f))
                        ActionPadView(pad)
                    }
                }
                Column(
                    Modifier.padding(bottom = 6.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    content = bottom,
                )
            }
        }
    }
}

/** A round, translucent button for the bar over the arena. (iOS `StageButton`.) */
@Composable
fun StageButton(
    icon: ImageVector,
    label: String,
    on: Boolean = false,
    onClick: () -> Unit,
) {
    Box(
        Modifier
            .size(38.dp)
            .clip(CircleShape)
            .background(if (on) KombatColors.Lime else KombatColors.PadFill)
            .border(1.dp, KombatColors.PadLine, CircleShape)
            .clickable(onClickLabel = label, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = label, tint = if (on) KombatColors.Ink else KombatColors.OnStage, modifier = Modifier.size(18.dp))
    }
}

/** A pill of text on the stage. (iOS `StagePill`.) */
@Composable
fun StagePill(
    text: String,
    dot: Color? = null,
) {
    Row(
        Modifier
            .height(28.dp)
            .clip(CircleShape)
            .background(KombatColors.PadFill)
            .border(1.dp, KombatColors.PadLine, CircleShape)
            .padding(horizontal = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (dot != null) Box(Modifier.size(7.dp).clip(CircleShape).background(dot))
        Text(text, style = Type.body(12, FontWeight.SemiBold, KombatColors.OnStage), maxLines = 1)
    }
}

@Composable
private fun StageTitle(
    title: String,
    subtitle: String,
) {
    Column {
        Text(title, style = Type.heading(15, KombatColors.OnStage), maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(subtitle, style = Type.body(11, FontWeight.Medium, KombatColors.OnStageMuted))
    }
}

// ---- an arena ----------------------------------------------------------------------------------

private enum class ArenaSheet { FIGHTERS, RECORD, DETAILS }

/** One arena: the fight, the corners, the record. (iOS `ArenaScreen`.) */
@Composable
fun ArenaScreen(
    backend: MeroAppBackend,
    ref: ArenaRef,
    store: PlayerStore,
    relayPresence: RelayPresenceClient?,
    onBack: () -> Unit,
    onShare: (String) -> Unit,
) {
    val model =
        remember(backend, ref) {
            val presence: PresenceChannel? = relayPresence?.let { RelayPresenceChannel(it, ref.contextId) }
            ArenaModel(backend, ref, store, presence)
        }
    val state by model.state.collectAsState()
    val pad = remember { FightPad() }
    val scope = rememberCoroutineScope()
    var sheet by remember { mutableStateOf<ArenaSheet?>(null) }
    var more by remember { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(model) { model.run() }
    DisposableEffect(model) {
        onDispose { scope.launch { withContext(NonCancellable) { model.leaveScreen() } } }
    }
    LaunchedEffect(sheet) { if (sheet != null) pad.releaseAll() }

    fun invite() {
        pad.releaseAll()
        scope.launch {
            runCatching { model.inviteLink() }
                .onSuccess(onShare)
                .onFailure { actionError = KombatText.error(it) }
        }
    }

    FightStage(
        host = model,
        showPad = state.mode == GameMode.NET,
        pad = pad,
        onPause = model::pause,
        onResume = model::resume,
        bar = {
            StageButton(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Arenas", onClick = onBack)
            StageTitle(state.view?.title?.ifEmpty { null } ?: KombatConstants.DEFAULT_TITLE, "Match ${(state.view?.matchIndex ?: 0u) + 1u}")
            StagePill(state.statusText, if (state.view?.status == "fighting") KombatColors.Lime else null)
            Spacer(Modifier.weight(1f))
            if (state.meter.sent > 0) StagePill("${state.meter.ok} tx · ${state.meter.lastMs} ms")
            StageButton(
                if (state.muted) Icons.AutoMirrored.Filled.VolumeOff else Icons.AutoMirrored.Filled.VolumeUp,
                if (state.muted) "Sound on" else "Sound off",
            ) { model.setMuted(!state.muted) }
            StageButton(Icons.Filled.People, "Fighters") { sheet = ArenaSheet.FIGHTERS }
            Box {
                StageButton(Icons.Filled.MoreHoriz, "More") { more = true }
                DropdownMenu(expanded = more, onDismissRequest = { more = false }) {
                    DropdownMenuItem(text = { Text("Invite an opponent") }, leadingIcon = { Icon(Icons.Filled.Share, null) }, onClick = {
                        more = false
                        invite()
                    })
                    DropdownMenuItem(text = { Text("Record") }, leadingIcon = { Icon(Icons.Filled.FormatListNumbered, null) }, onClick = {
                        more = false
                        sheet = ArenaSheet.RECORD
                    })
                    DropdownMenuItem(text = { Text("Refresh") }, leadingIcon = { Icon(Icons.Filled.Refresh, null) }, onClick = {
                        more = false
                        scope.launch { model.refresh() }
                    })
                    DropdownMenuItem(text = { Text("Details") }, leadingIcon = { Icon(Icons.Outlined.Info, null) }, onClick = {
                        more = false
                        sheet = ArenaSheet.DETAILS
                    })
                }
            }
        },
        bottom = {
            (state.error ?: actionError)?.let { message ->
                ErrorBanner(message, Modifier.widthIn(max = 360.dp)) {
                    model.dismissError()
                    actionError = null
                }
            }
            when {
                state.view == null -> StagePill("Reading the arena…")
                !state.isSeated -> {
                    PrimaryButton(onClick = { sheet = ArenaSheet.FIGHTERS }, fullWidth = false) {
                        Icon(Icons.Filled.SportsMartialArts, contentDescription = null, modifier = Modifier.size(18.dp))
                        ButtonLabel("Take a corner")
                    }
                    Text("You are watching. Take a free corner to fight.", style = Type.body(12, FontWeight.Medium, KombatColors.OnStageMuted))
                }
                state.isFinished ->
                    PrimaryButton(onClick = { scope.launch { model.rematch() } }, fullWidth = false, enabled = !state.busy) {
                        Icon(Icons.Filled.Refresh, contentDescription = null, modifier = Modifier.size(18.dp))
                        ButtonLabel("Rematch")
                    }
                state.view?.status == "waiting" -> {
                    StagePill("Waiting for an opponent")
                    PrimaryButton(onClick = ::invite, fullWidth = false) {
                        Icon(Icons.Filled.Share, contentDescription = null, modifier = Modifier.size(18.dp))
                        ButtonLabel("Invite an opponent")
                    }
                }
            }
        },
    )

    when (sheet) {
        ArenaSheet.FIGHTERS -> CornersSheet(model, state) { sheet = null }
        ArenaSheet.RECORD -> RecordSheet(state) { sheet = null }
        ArenaSheet.DETAILS -> DetailsSheet(model, state) { sheet = null }
        null -> Unit
    }
}

// ---- practice ----------------------------------------------------------------------------------

/** Practice against the CPU. (iOS `PracticeScreen`.) */
@Composable
fun PracticeScreen(
    store: PlayerStore,
    onBack: () -> Unit,
) {
    val model = remember { PracticeModel(store) }
    val state by model.state.collectAsState()
    val pad = remember { FightPad() }
    var choosing by remember { mutableStateOf(false) }
    LaunchedEffect(choosing) { if (choosing) pad.releaseAll() }

    FightStage(
        host = model,
        showPad = true,
        pad = pad,
        onPause = model::pause,
        onResume = model::resume,
        bar = {
            StageButton(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Back", onClick = onBack)
            StageTitle("You versus the CPU", "Practice · offline")
            Spacer(Modifier.weight(1f))
            StageButton(
                if (state.muted) Icons.AutoMirrored.Filled.VolumeOff else Icons.AutoMirrored.Filled.VolumeUp,
                if (state.muted) "Sound on" else "Sound off",
            ) { model.setMuted(!state.muted) }
            StageButton(Icons.Filled.Person, "Choose your fighter") { choosing = true }
        },
        bottom = {
            if (state.over) {
                PrimaryButton(onClick = model::rematch, fullWidth = false) {
                    Icon(Icons.Filled.Refresh, contentDescription = null, modifier = Modifier.size(18.dp))
                    ButtonLabel("Rematch")
                }
            }
        },
    )

    if (choosing) {
        KombatSheet("Choose your fighter", onDismiss = { choosing = false }) {
            FighterGrid(selected = state.fighter, enabled = true) {
                model.choose(it)
                choosing = false
            }
            HowToFight()
        }
    }
}

// ---- sheets ------------------------------------------------------------------------------------

/** The two corners, your name and your fighter: the web app's "Fighters" card. (iOS `CornersSheet`.) */
@Composable
private fun CornersSheet(
    model: ArenaModel,
    state: ArenaState,
    onDismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    KombatSheet("Fighters", onDismiss = onDismiss) {
        state.view?.let { view ->
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Corner(model, state, view, view.p1, Modifier.weight(1f))
                Text("VS", style = Type.heading(15, KombatColors.Muted), modifier = Modifier.padding(top = 30.dp))
                Corner(model, state, view, view.p2, Modifier.weight(1f))
            }
        }
        if (state.isFinished && state.isSeated) {
            PrimaryButton(onClick = { scope.launch { model.rematch() } }, enabled = !state.busy) {
                Icon(Icons.Filled.Refresh, contentDescription = null, modifier = Modifier.size(18.dp))
                ButtonLabel("Rematch")
            }
        }
        OutlinedTextField(
            value = state.name,
            onValueChange = model::setName,
            label = { Text("Your name") },
            placeholder = { Text(KombatConstants.DEFAULT_NAME) },
            singleLine = true,
            enabled = !state.isSeated,
            colors = fieldColors(),
            modifier = Modifier.fillMaxWidth(),
        )
        FighterGrid(selected = state.fighter, enabled = !state.busy) { id -> scope.launch { model.choose(id) } }
        HowToFight()
    }
}

@Composable
private fun Corner(
    model: ArenaModel,
    state: ArenaState,
    view: ArenaView,
    fighter: FighterView,
    modifier: Modifier,
) {
    val scope = rememberCoroutineScope()
    val empty = fighter.member.isEmpty()
    val mine = !empty && fighter.member == view.me
    val live = fighter.seat in state.live
    Card(
        modifier = modifier.border(2.dp, if (mine) KombatColors.Lime else Color.Transparent, CardShape),
        padding = 14.dp,
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            FighterBadge(if (empty) null else fighter.fighter, size = 52.dp, mirrored = fighter.seat == "p2")
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(
                    if (empty) "Open corner" else KombatText.name(fighter) + if (mine) " · you" else "",
                    style = Type.heading(16),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (empty) {
                    Text(if (fighter.seat == "p1") "Left side" else "Right side", style = Type.body(13, color = KombatColors.Muted))
                } else {
                    Row(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(7.dp).clip(CircleShape).background(if (live) KombatColors.Online else KombatColors.Line))
                        Text(
                            "${FighterInfo.of(fighter.fighter).name.lowercase().replaceFirstChar { it.uppercase() }} · ${if (live) "in the arena" else "away"}",
                            style = Type.body(13, color = KombatColors.Muted),
                            maxLines = 1,
                        )
                    }
                }
            }
            Text("${fighter.matchesWon}", style = Type.heading(20))
        }
        if (empty && !state.isSeated) {
            PrimaryButton(onClick = { scope.launch { model.sit(fighter.seat) } }, enabled = !state.busy) { ButtonLabel("Fight here") }
        }
        if (state.canLeave(fighter)) {
            SecondaryButton(onClick = { scope.launch { model.stand() } }, enabled = !state.busy) { ButtonLabel("Leave") }
        }
    }
}

/** The four fighters, as tiles. (iOS `FighterGrid`.) */
@Composable
private fun FighterGrid(
    selected: String,
    enabled: Boolean,
    onChoose: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Choose your fighter", style = Type.body(13, FontWeight.SemiBold, KombatColors.Muted))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            FighterInfo.roster.forEach { info ->
                val on = info.id == selected
                val shape = RoundedCornerShape(14.dp)
                Column(
                    Modifier
                        .weight(1f)
                        .clip(shape)
                        .background(if (on) KombatColors.LimeSoft else KombatColors.Surface)
                        .border(if (on) 2.dp else 1.dp, if (on) KombatColors.Lime else KombatColors.Line, shape)
                        .clickable(enabled = enabled, onClickLabel = "${info.name}, ${info.title}") { onChoose(info.id) }
                        .padding(10.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    FighterBadge(info.id, size = 56.dp)
                    Text(info.name, style = Type.body(13, FontWeight.Bold))
                    Text(info.special, style = Type.body(11, color = KombatColors.Muted), maxLines = 1)
                }
            }
        }
        Text(FighterInfo.of(selected).title, style = Type.body(13, color = KombatColors.Muted))
    }
}

/** The web app's pad hint. (iOS `HowToFight`.) */
@Composable
private fun HowToFight() {
    Card(padding = 14.dp) {
        Text("How to fight", style = Type.body(13, FontWeight.SemiBold, KombatColors.Muted))
        Text(
            "Down + Punch is an uppercut, Down + Kick a sweep, Kick in the air a flying kick. Hold Block to guard.",
            style = Type.body(14, color = KombatColors.Ink2),
        )
    }
}

/** Finished matches, newest first: the web app's "Record" card. (iOS `RecordSheet`.) */
@Composable
private fun RecordSheet(
    state: ArenaState,
    onDismiss: () -> Unit,
) {
    KombatSheet("Record", onDismiss = onDismiss) {
        val view = state.view
        if (state.record.isEmpty() || view == null) {
            Column(Modifier.fillMaxWidth().padding(vertical = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(Icons.Filled.FormatListNumbered, contentDescription = null, tint = KombatColors.Muted)
                Text("No finished matches yet", style = Type.heading(17))
                Text("Win two rounds to take a match.", style = Type.body(14, color = KombatColors.Muted))
            }
        } else {
            Card(padding = 14.dp) {
                state.record.forEach { match ->
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("Match ${match.index + 1u}", style = Type.body(15, FontWeight.SemiBold))
                        Text(KombatText.winner(match.winner, view), style = Type.body(15, color = KombatColors.Ink2))
                        if (match.flawless) {
                            Text(
                                "Flawless",
                                style = Type.body(11, FontWeight.Bold),
                                modifier = Modifier.clip(CircleShape).background(KombatColors.Lime).padding(horizontal = 8.dp, vertical = 3.dp),
                            )
                        }
                        Spacer(Modifier.weight(1f))
                        Text("${match.actions} tx", style = Type.mono.copy(color = KombatColors.Muted))
                    }
                }
            }
        }
    }
}

/** Ids and the chain counts, for whoever needs them. (iOS `ArenaDetailsSheet`.) */
@Composable
private fun DetailsSheet(
    model: ArenaModel,
    state: ArenaState,
    onDismiss: () -> Unit,
) {
    KombatSheet("Details", onDismiss = onDismiss) {
        Card {
            DetailRow("Arena (context)", model.contextId)
            DetailRow("Namespace", model.ref.namespaceId ?: "Unknown")
            DetailRow("You", state.view?.me.orEmpty())
        }
        Card {
            DetailRow("Every action at this arena", "${state.view?.totalActions ?: 0u} tx")
            DetailRow("This match", "${state.view?.matchActions ?: 0u} tx")
            DetailRow("Sent from this phone", "${state.meter.sent} sent · ${state.meter.ok} confirmed · ${state.meter.failed} failed")
            DetailRow("Presence", if (model.hasPresence) "Through your relay" else "Unavailable on this session")
        }
    }
}
