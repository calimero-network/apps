package network.calimero.chess.ui

import android.view.HapticFeedbackConstants
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Autorenew
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.outlined.Contrast
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Verified
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.launch
import network.calimero.chess.app.Board
import network.calimero.chess.app.ChessText
import network.calimero.chess.app.NameStore
import network.calimero.chess.app.PendingPromotion
import network.calimero.chess.app.Piece
import network.calimero.chess.app.PieceColor
import network.calimero.chess.app.TableModel
import network.calimero.chess.app.TableRef
import network.calimero.chess.app.TableState
import network.calimero.chess.generated.GameSummary
import network.calimero.chess.generated.TableView

/** One table: the board between the two players, then the game, the moves and the record. (iOS `TableScreen`.) */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TableScreen(
    backend: MeroAppBackend,
    ref: TableRef,
    names: NameStore,
    onBack: () -> Unit,
    onShare: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val model = remember(backend, ref) { TableModel(backend, ref.contextId, ref.namespaceId, names, scope) }
    val state by model.state.collectAsState()
    val view = LocalView.current
    var menu by remember { mutableStateOf(false) }
    var showingDetails by remember { mutableStateOf(false) }
    var confirmingResign by remember { mutableStateOf(false) }
    var inviting by remember { mutableStateOf(false) }
    var inviteError by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }

    LaunchedEffect(model) { model.start() }
    LaunchedEffect(state.movesPlayed) {
        if (state.movesPlayed > 0) view.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
    }

    fun act(action: suspend TableModel.() -> Unit) {
        scope.launch { model.action() }
    }

    Scaffold(
        containerColor = ChessColors.Ground,
        topBar = {
            TopAppBar(
                title = { Text(state.view?.title ?: "Table", style = Type.heading(17), maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = ChessColors.Ink) }
                },
                actions = {
                    IconButton(
                        enabled = !inviting && model.namespaceId != null,
                        onClick = {
                            inviting = true
                            scope.launch {
                                runCatching { model.inviteLink() }.onSuccess(onShare).onFailure { inviteError = ChessText.error(it) }
                                inviting = false
                            }
                        },
                    ) {
                        if (inviting) {
                            CircularProgressIndicator(Modifier.size(18.dp), color = ChessColors.Ink, strokeWidth = 2.dp)
                        } else {
                            Icon(Icons.Filled.Share, contentDescription = "Invite", tint = ChessColors.Ink)
                        }
                    }
                    Box {
                        IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, contentDescription = "More", tint = ChessColors.Ink) }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(
                                text = { Text("Refresh") },
                                leadingIcon = { Icon(Icons.Filled.Refresh, contentDescription = null) },
                                onClick = {
                                    menu = false
                                    act { refresh() }
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Details") },
                                leadingIcon = { Icon(Icons.Outlined.Info, contentDescription = null) },
                                onClick = {
                                    menu = false
                                    showingDetails = true
                                },
                            )
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = ChessColors.Ground),
            )
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                scope.launch {
                    refreshing = true
                    model.refresh()
                    refreshing = false
                }
            },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            Column(
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .imePadding()
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                state.error?.let { ErrorBanner(it) { model.dismissError() } }
                inviteError?.let { ErrorBanner(it) { inviteError = null } }
                val table = state.view
                if (table == null) {
                    Column(
                        Modifier.fillMaxWidth().padding(vertical = 80.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        CircularProgressIndicator(color = ChessColors.Ink, strokeWidth = 2.dp)
                        Text("Reading the table…", style = Type.body(14, color = ChessColors.Muted))
                    }
                } else {
                    val material = Board.material(state.squares)
                    val top = if (state.flipped) PieceColor.WHITE else PieceColor.BLACK
                    PlayerBar(state, top, material.captured[top].orEmpty(), material.lead[top] ?: 0, { act { sit(it) } }, { act { stand() } })
                    BoardView(state) { square -> act { tap(square) } }
                    PlayerBar(
                        state,
                        top.opposite,
                        material.captured[top.opposite].orEmpty(),
                        material.lead[top.opposite] ?: 0,
                        { act { sit(it) } },
                        { act { stand() } },
                    )
                    if (state.offerFromOpponent && state.isSeated) {
                        DrawOfferCard(state.busy, onAccept = { act { acceptDraw() } }, onDecline = { act { declineDraw() } })
                    }
                    GameCard(
                        state = state,
                        view = table,
                        onOfferDraw = { act { offerDraw() } },
                        onClaimDraw = { act { claimDraw() } },
                        onResign = { confirmingResign = true },
                        onRematch = { act { rematch() } },
                    )
                    if (!state.isSeated) SeatPrompt(state, table, model::setName)
                    MovesCard(table)
                    RecordCard(table, state.past)
                }
            }
        }
    }

    state.promotion?.let { pending ->
        PromotionSheet(pending, onChoose = { kind -> act { promote(kind) } }, onCancel = model::cancelPromotion)
    }
    if (confirmingResign) {
        AlertDialog(
            onDismissRequest = { confirmingResign = false },
            title = { Text("Resign this game?") },
            text = { Text("The game goes to your opponent.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmingResign = false
                    view.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
                    act { resign() }
                }) { Text("Resign", color = ChessColors.Danger) }
            },
            dismissButton = { TextButton(onClick = { confirmingResign = false }) { Text("Cancel", color = ChessColors.Ink) } },
            containerColor = ChessColors.Surface,
        )
    }
    if (showingDetails) {
        ChessSheet("Details", onDismiss = { showingDetails = false }) {
            DetailRow("Table (context)", model.contextId)
            DetailRow("Club (namespace)", model.namespaceId ?: "Unknown")
            DetailRow("You, as the contract sees you", state.view?.me ?: "—")
            state.view?.let {
                DetailRow("Position (FEN)", it.fen)
                DetailRow("Status", "${it.status} · ${it.result} ${it.reason}")
            }
            Text(
                "The rules run in the contract. This app draws the board from its answers and has no chess engine of its own.",
                style = Type.body(13, color = ChessColors.Muted),
            )
        }
    }
}

/** One chair: who sits there, whether they are around, what they have taken, whose move it is. */
@Composable
private fun PlayerBar(
    state: TableState,
    color: PieceColor,
    captured: List<Char>,
    lead: Int,
    onSit: (PieceColor) -> Unit,
    onStand: () -> Unit,
) {
    val view = state.view ?: return
    val seat = state.seat(color) ?: return
    val occupied = seat.member.isNotEmpty()
    val mine = occupied && seat.member == view.me
    val toMove = view.status == "inProgress" && view.sideToMove == color.wire
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(contentAlignment = Alignment.BottomEnd) {
            Box(
                Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(if (color == PieceColor.WHITE) ChessColors.Surface else ChessColors.Ink)
                    .border(1.dp, ChessColors.Line, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                if (occupied) {
                    Text(
                        seat.name.take(1).uppercase(),
                        style = Type.heading(16).copy(color = if (color == PieceColor.WHITE) ChessColors.Ink else ChessColors.Surface),
                    )
                } else {
                    PieceImage(if (color == PieceColor.WHITE) "wK" else "bK", Modifier.padding(7.dp))
                }
            }
            if (occupied) {
                Box(
                    Modifier
                        .size(11.dp)
                        .clip(CircleShape)
                        .background(if (seat.online) ChessColors.Online else ChessColors.Muted.copy(alpha = 0.5f))
                        .border(2.dp, ChessColors.Surface, CircleShape),
                )
            }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    if (occupied) seat.name else "Seat empty",
                    style = Type.heading(15).copy(color = if (occupied) ChessColors.Ink else ChessColors.Muted),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (mine) Text(" · you", style = Type.body(14, color = ChessColors.Muted))
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    color.label + if (occupied) (if (seat.online) " · online" else " · away") else "",
                    style = Type.body(12, color = ChessColors.Muted),
                )
                if (captured.isNotEmpty()) {
                    Row(horizontalArrangement = Arrangement.spacedBy((-4).dp)) {
                        captured.forEach { kind -> PieceImage(Piece(color.opposite, kind).assetName, Modifier.size(15.dp)) }
                    }
                    if (lead > 0) Text("+$lead", style = Type.body(12, FontWeight.SemiBold, ChessColors.Ink2))
                }
            }
        }
        if (toMove) {
            Text(
                "To move",
                style = Type.body(12, FontWeight.SemiBold),
                modifier = Modifier.clip(CircleShape).background(ChessColors.Lime).padding(horizontal = 10.dp, vertical = 5.dp),
            )
        }
        if (!occupied) {
            PrimaryButton(onClick = { onSit(color) }, enabled = !state.busy, fullWidth = false) {
                ButtonLabel(if (state.isSeated) "Play this side too" else "Sit here")
            }
        } else if (state.canStand(color)) {
            SecondaryButton(onClick = onStand, enabled = !state.busy, fullWidth = false) { ButtonLabel("Stand") }
        }
    }
}

@Composable
private fun DrawOfferCard(
    busy: Boolean,
    onAccept: () -> Unit,
    onDecline: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(CardShape)
            .background(ChessColors.LimeSoft)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.Contrast, contentDescription = null, tint = ChessColors.Ink)
            Text("Your opponent offers a draw.", style = Type.heading(15))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            PrimaryButton(onClick = onAccept, enabled = !busy, modifier = Modifier.weight(1f)) {
                Icon(Icons.Filled.Check, contentDescription = null, modifier = Modifier.size(18.dp))
                ButtonLabel("Accept")
            }
            SecondaryButton(onClick = onDecline, enabled = !busy, modifier = Modifier.weight(1f)) {
                Icon(Icons.Filled.Close, contentDescription = null, modifier = Modifier.size(18.dp))
                ButtonLabel("Decline")
            }
        }
    }
}

/** Where the game stands, and the buttons that go with it. */
@Composable
private fun GameCard(
    state: TableState,
    view: TableView,
    onOfferDraw: () -> Unit,
    onClaimDraw: () -> Unit,
    onResign: () -> Unit,
    onRematch: () -> Unit,
) {
    Card {
        if (state.isFinished) {
            Text(ChessText.score(view.result), style = Type.heading(34).copy(fontWeight = FontWeight.Bold))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            val dot =
                when {
                    state.isFinished -> ChessColors.Muted
                    view.check -> ChessColors.Danger
                    view.myTurn -> ChessColors.Lime
                    else -> ChessColors.Muted.copy(alpha = 0.5f)
                }
            Box(Modifier.size(9.dp).clip(CircleShape).background(dot))
            Text(ChessText.status(view), style = Type.heading(16))
        }
        Text(ChessText.meta(view), style = Type.body(13, color = ChessColors.Muted))
        if (state.isPlaying) {
            if (state.myOfferStands) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(14.dp), color = ChessColors.Muted, strokeWidth = 2.dp)
                    Text("Draw offered — waiting for a reply.", style = Type.body(14, color = ChessColors.Muted))
                }
            } else if (!state.offerFromOpponent) {
                SecondaryButton(onClick = onOfferDraw, enabled = !state.busy) {
                    Icon(Icons.Outlined.Contrast, contentDescription = null, modifier = Modifier.size(18.dp))
                    ButtonLabel("Offer draw")
                }
            }
            ChessText.claimLabel(view.claimableDraw)?.let { claim ->
                SecondaryButton(onClick = onClaimDraw, enabled = !state.busy) {
                    Icon(Icons.Outlined.Verified, contentDescription = null, modifier = Modifier.size(18.dp))
                    ButtonLabel(claim)
                }
            }
            SecondaryButton(onClick = onResign, enabled = !state.busy, destructive = true) {
                Icon(Icons.Outlined.Flag, contentDescription = null, modifier = Modifier.size(18.dp))
                ButtonLabel("Resign")
            }
        }
        if (state.isFinished && state.isSeated) {
            PrimaryButton(onClick = onRematch, enabled = !state.busy) {
                Icon(Icons.Filled.Autorenew, contentDescription = null, modifier = Modifier.size(18.dp))
                ButtonLabel("Rematch")
            }
        }
        if (state.isSeated) Text("Colours swap on every rematch.", style = Type.body(12, color = ChessColors.Muted))
    }
}

/** Not seated: the name to sit under, and what sitting means. */
@Composable
private fun SeatPrompt(
    state: TableState,
    view: TableView,
    onName: (String) -> Unit,
) {
    Card {
        OutlinedTextField(
            value = state.name,
            onValueChange = onName,
            label = { Text("Your name") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Done),
            colors = fieldColors(),
            modifier = Modifier.fillMaxWidth(),
        )
        Text(
            if (view.white.member.isNotEmpty() && view.black.member.isNotEmpty()) {
                "Both chairs are taken, so you are watching. Nothing is hidden from a spectator — chess is a game of complete information."
            } else {
                "Pick an empty chair beside the board to play. Take both to play the board yourself."
            },
            style = Type.body(13, color = ChessColors.Muted),
        )
    }
}

/** The scoresheet. */
@Composable
private fun MovesCard(view: TableView) {
    val rows = Board.movePairs(view.moves.map { it.san })
    val last = view.moves.size - 1
    Card {
        CardTitle("Moves", if (view.moves.isEmpty()) null else "${view.moves.size} plies")
        if (rows.isEmpty()) {
            Text("No moves yet. White opens.", style = Type.body(14, color = ChessColors.Muted))
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                rows.forEachIndexed { i, row ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("${row.number}.", style = Type.body(13, color = ChessColors.Muted), modifier = Modifier.width(32.dp))
                        San(row.white, i * 2 == last, Modifier.weight(1f))
                        San(row.black, i * 2 + 1 == last, Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

@Composable
private fun San(
    text: String,
    current: Boolean,
    modifier: Modifier,
) {
    Box(modifier) {
        Text(
            text,
            fontSize = 14.sp,
            fontFamily = FontFamily.Monospace,
            fontWeight = if (current) FontWeight.SemiBold else FontWeight.Normal,
            color = ChessColors.Ink,
            modifier =
                if (current) {
                    Modifier.clip(RoundedCornerShape(6.dp)).background(ChessColors.LimeSoft).padding(horizontal = 6.dp, vertical = 2.dp)
                } else {
                    Modifier
                },
        )
    }
}

/** The finished games, most recent first. */
@Composable
private fun RecordCard(
    view: TableView,
    past: List<GameSummary>,
) {
    val finished = past.filter { it.result != "*" }
    if (finished.isEmpty()) return
    val games = if (finished.size == 1) "game" else "games"
    Card {
        CardTitle("Record", "${finished.size} $games")
        finished.reversed().forEach { game ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Game ${game.index + 1u}", style = Type.body(14, FontWeight.SemiBold))
                Text(
                    ChessText.score(game.result),
                    style = Type.body(12, FontWeight.SemiBold),
                    modifier = Modifier.clip(CircleShape).background(ChessColors.Sunken).padding(horizontal = 8.dp, vertical = 3.dp),
                )
                Text(
                    ChessText.recordReason(game.reason),
                    style = Type.body(13, color = ChessColors.Muted),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Text("${game.plies} plies", style = Type.body(12, color = ChessColors.Muted))
            }
        }
        Text(
            "${view.white.name.ifEmpty { "White" }} and ${view.black.name.ifEmpty { "Black" }} have played ${finished.size} $games.",
            style = Type.body(12, color = ChessColors.Muted),
        )
    }
}

/** Promote to: queen first. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PromotionSheet(
    pending: PendingPromotion,
    onChoose: (Char) -> Unit,
    onCancel: () -> Unit,
) {
    val names = mapOf('q' to "Queen", 'r' to "Rook", 'b' to "Bishop", 'n' to "Knight")
    ModalBottomSheet(onDismissRequest = onCancel, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = ChessColors.Ground) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Text("Promote to", style = Type.heading(20))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                pending.kinds.forEach { kind ->
                    Column(
                        Modifier
                            .weight(1f)
                            .clip(ButtonShape)
                            .background(ChessColors.Surface)
                            .border(1.dp, ChessColors.Line, ButtonShape)
                            .clickableWithHaptic { onChoose(kind) }
                            .padding(vertical = 12.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        PieceImage(Piece(pending.color, kind).assetName, Modifier.size(52.dp))
                        Text(names[kind] ?: kind.toString(), style = Type.body(13, FontWeight.SemiBold))
                    }
                }
            }
            SecondaryButton(onClick = onCancel) { ButtonLabel("Cancel") }
            Spacer(Modifier.size(0.dp))
        }
    }
}

@Composable
private fun Modifier.clickableWithHaptic(onClick: () -> Unit): Modifier {
    val view = LocalView.current
    return clickable {
        view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
        onClick()
    }
}
