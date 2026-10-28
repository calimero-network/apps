package network.calimero.chess.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberSwipeToDismissBoxState
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.launch
import network.calimero.chess.app.ChessInvitation
import network.calimero.chess.app.ChessText
import network.calimero.chess.app.LobbyModel
import network.calimero.chess.app.TableEntry
import network.calimero.chess.app.TableRef

/** The tables: every table in every club this account is in. (iOS `LobbyScreen`.) */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LobbyScreen(
    backend: MeroAppBackend,
    applicationId: String?,
    account: String,
    onOpen: (TableRef) -> Unit,
    onJoin: (ChessInvitation) -> Unit,
    onShare: (String) -> Unit,
    onSignOut: () -> Unit,
) {
    val model = remember(backend) { LobbyModel(backend, applicationId) }
    val state by model.state.collectAsState()
    val scope = rememberCoroutineScope()
    var creating by remember { mutableStateOf(false) }
    var pasting by remember { mutableStateOf(false) }
    var showingAccount by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }

    LaunchedEffect(model) { model.load() }

    fun invite(ref: TableRef) {
        scope.launch {
            runCatching { model.inviteLink(ref) }
                .onSuccess(onShare)
                .onFailure { actionError = ChessText.error(it) }
        }
    }

    Scaffold(
        containerColor = ChessColors.Ground,
        topBar = {
            TopAppBar(
                title = { Text("Tables", style = Type.heading(20)) },
                navigationIcon = {
                    IconButton(onClick = { showingAccount = true }) {
                        Icon(Icons.Outlined.AccountCircle, contentDescription = "Account", tint = ChessColors.Ink)
                    }
                },
                actions = {
                    Box {
                        IconButton(onClick = { menu = true }) {
                            Icon(Icons.Filled.Add, contentDescription = "New table", tint = ChessColors.Ink)
                        }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(
                                text = { Text("New table") },
                                leadingIcon = { Icon(Icons.Filled.Add, contentDescription = null) },
                                enabled = model.hasRelay,
                                onClick = {
                                    menu = false
                                    creating = true
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Join with a link") },
                                leadingIcon = { Icon(Icons.Filled.Link, contentDescription = null) },
                                onClick = {
                                    menu = false
                                    pasting = true
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
                    model.load()
                    refreshing = false
                }
            },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 6.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                (state.error ?: actionError)?.let { message ->
                    item {
                        ErrorBanner(message) {
                            model.dismissError()
                            actionError = null
                        }
                    }
                }
                when {
                    !state.loaded ->
                        item {
                            Box(Modifier.fillMaxWidth().padding(vertical = 48.dp), contentAlignment = Alignment.Center) {
                                CircularProgressIndicator(color = ChessColors.Ink, strokeWidth = 2.dp)
                            }
                        }
                    !model.hasRelay ->
                        item {
                            EmptyState(
                                piece = "wN",
                                title = "Join your first table",
                                text = "Your account has no relay yet. Open an invitation link someone sent you, or paste it here.",
                                action = "Join with a link",
                            ) { pasting = true }
                        }
                    state.tables.isEmpty() ->
                        item {
                            EmptyState(
                                piece = "wN",
                                title = "No tables yet",
                                text = "Start one with New table, or join one with an invitation link.",
                                action = "New table",
                            ) { creating = true }
                        }
                    else ->
                        items(state.tables, key = { it.id }) { entry ->
                            SwipeToInvite(onInvite = { invite(entry.ref) }) {
                                TableRow(entry) { onOpen(entry.ref) }
                            }
                        }
                }
            }
        }
    }

    if (creating) {
        NewTableSheet(
            clubs = state.clubs,
            onCreate = { title, clubId -> onOpen(model.create(title, clubId)) },
            onDismiss = { creating = false },
        )
    }
    if (pasting) {
        PasteLinkSheet(
            onInvitation = {
                pasting = false
                onJoin(it)
            },
            onDismiss = { pasting = false },
        )
    }
    if (showingAccount) {
        AccountSheet(account = account, onSignOut = onSignOut, onDismiss = { showingAccount = false })
    }
}

/** Swipe a row left to invite someone to it; the row springs back. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SwipeToInvite(
    onInvite: () -> Unit,
    content: @Composable () -> Unit,
) {
    val state =
        rememberSwipeToDismissBoxState(
            confirmValueChange = { value ->
                if (value == SwipeToDismissBoxValue.EndToStart) onInvite()
                false
            },
        )
    SwipeToDismissBox(
        state = state,
        enableDismissFromStartToEnd = false,
        backgroundContent = {
            Row(
                Modifier
                    .fillMaxSize()
                    .clip(CardShape)
                    .background(ChessColors.Ink)
                    .padding(horizontal = 20.dp),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.Share, contentDescription = null, tint = ChessColors.Surface)
                Spacer(Modifier.width(8.dp))
                Text("Invite", style = Type.body(15, FontWeight.SemiBold, ChessColors.Surface))
            }
        },
    ) { content() }
}

/** One table in the list. */
@Composable
private fun TableRow(
    entry: TableEntry,
    onClick: () -> Unit,
) {
    val summary = entry.summary
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(CardShape)
                .background(ChessColors.Surface)
                .border(Hairline, ChessColors.Line, CardShape)
                .clickable(onClick = onClick)
                .padding(14.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(48.dp).clip(RoundedCornerShape(12.dp)).background(if (summary?.myTurn == true) ChessColors.Lime else ChessColors.Sunken),
            contentAlignment = Alignment.Center,
        ) {
            PieceImage(if (summary?.finished == true) "wK" else "bN", Modifier.padding(8.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(summary?.title ?: "Table", style = Type.heading(16), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                summary?.players ?: entry.clubName ?: "Syncing…",
                style = Type.body(13, color = ChessColors.Muted),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        summary?.state?.let { text ->
            Text(
                text,
                style = Type.body(12, FontWeight.SemiBold),
                modifier = Modifier.clip(CircleShape).background(if (summary.myTurn) ChessColors.Lime else ChessColors.Sunken).padding(horizontal = 10.dp, vertical = 5.dp),
            )
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = ChessColors.Muted)
    }
}

@Composable
fun EmptyState(
    piece: String,
    title: String,
    text: String,
    action: String,
    onAction: () -> Unit,
) {
    Column(
        Modifier.fillMaxWidth().padding(vertical = 40.dp, horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        PieceImage(piece, Modifier.size(72.dp))
        Text(title, style = Type.heading(20))
        Text(text, style = Type.body(15, color = ChessColors.Muted), textAlign = TextAlign.Center)
        PrimaryButton(onClick = onAction, fullWidth = false, modifier = Modifier.padding(top = 4.dp)) { ButtonLabel(action) }
    }
}
