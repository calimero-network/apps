package network.calimero.design.ui

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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.FilterNone
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.calimero.mero.app.MeroAppBackend
import com.calimero.mero.compose.MeroAppSession
import kotlinx.coroutines.launch
import network.calimero.design.app.BoardSummary
import network.calimero.design.app.BoardsModel
import network.calimero.design.app.LoadState
import network.calimero.design.app.Team
import network.calimero.design.app.TeamsModel
import network.calimero.design.core.DesignFormat

/** The teams this account is in. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TeamsScreen(
    backend: MeroAppBackend,
    session: MeroAppSession,
    onSignOut: () -> Unit,
    onOpen: (Team) -> Unit,
) {
    val model = remember(backend) { TeamsModel(backend) }
    val teams by model.teams.collectAsState()
    val state by model.state.collectAsState()
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    var showAccount by remember { mutableStateOf(false) }
    val scroll = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    LaunchedEffect(model) { model.load() }

    Scaffold(
        containerColor = DesignTheme.ground,
        modifier = Modifier.nestedScroll(scroll.nestedScrollConnection),
        topBar = {
            LargeTopAppBar(
                title = { Text("Mero Design", fontWeight = FontWeight.SemiBold) },
                actions = {
                    IconButton(onClick = { showAccount = true }) { Icon(Icons.Outlined.AccountCircle, contentDescription = "Account") }
                },
                colors = TopAppBarDefaults.largeTopAppBarColors(containerColor = DesignTheme.ground, scrolledContainerColor = DesignTheme.ground),
                scrollBehavior = scroll,
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
            modifier = Modifier.padding(padding).fillMaxSize(),
        ) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp)) {
                val s = state
                when {
                    s is LoadState.Idle || (s is LoadState.Loading && teams.isEmpty()) -> item { LoadingRows() }
                    s is LoadState.Failed && teams.isEmpty() -> item { ErrorState(s.message) { scope.launch { model.load() } } }
                    teams.isEmpty() ->
                        item {
                            EmptyState(
                                Icons.Outlined.Groups,
                                "No teams yet",
                                "Create a team in Mero Design on the web or desktop, or accept an invitation there. It shows up here.",
                            )
                        }
                    else -> {
                        item { SectionLabel("Teams") }
                        items(teams, key = { it.id }) { team -> TeamRow(team) { onOpen(team) } }
                    }
                }
            }
        }
    }

    if (showAccount) AccountSheet(session = session, onDismiss = { showAccount = false }, onSignOut = onSignOut)
}

@Composable
private fun TeamRow(
    team: Team,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .padding(vertical = 6.dp)
            .fillMaxWidth()
            .clip14()
            .clickable(onClick = onClick)
            .card(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val color = DesignTheme.memberColor(team.id)
        Box(Modifier.size(44.dp).background(color.copy(alpha = 0.14f), RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
            Text(DesignFormat.initials(team.name), style = DesignTheme.body(16, FontWeight.SemiBold, color))
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(team.name, style = DesignTheme.heading(17), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(if (team.memberCount == 1) "1 member" else "${team.memberCount} members", style = DesignTheme.body(14, color = DesignTheme.muted))
        }
    }
}

/** Who is signed in, and signing out. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AccountSheet(
    session: MeroAppSession,
    onDismiss: () -> Unit,
    onSignOut: () -> Unit,
) {
    var confirm by remember { mutableStateOf(false) }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = DesignTheme.ground) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            Text("Account", style = DesignTheme.heading(17), modifier = Modifier.align(Alignment.CenterHorizontally))
            Row(Modifier.fillMaxWidth().card(), verticalAlignment = Alignment.CenterVertically) {
                Avatar(session.account.orEmpty(), "Me", 44.dp)
                Spacer(Modifier.width(12.dp))
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("Signed in", style = DesignTheme.heading(17))
                    Text(
                        if (session.hasRelay) "Connected through your relay" else "No relay serves this account yet",
                        style = DesignTheme.body(14, color = DesignTheme.muted),
                    )
                }
            }
            DetailsDisclosure(
                listOf("Account" to (session.account ?: "—"), "Application" to (session.applicationId ?: "—")),
                Modifier.fillMaxWidth().card(),
            )
            SecondaryButton(onClick = { confirm = true }) {
                Icon(Icons.AutoMirrored.Outlined.Logout, contentDescription = null, tint = DesignTheme.danger, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("Sign out", color = DesignTheme.danger)
            }
            Spacer(Modifier.size(8.dp))
        }
    }
    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("Sign out of Mero Design?") },
            confirmButton = {
                TextButton(onClick = {
                    confirm = false
                    onDismiss()
                    onSignOut()
                }) { Text("Sign out", color = DesignTheme.danger) }
            },
            dismissButton = { TextButton(onClick = { confirm = false }) { Text("Cancel") } },
        )
    }
}

/** A team's boards. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BoardsScreen(
    backend: MeroAppBackend,
    teamId: String,
    teamName: String,
    onBack: () -> Unit,
    onOpen: (BoardSummary) -> Unit,
) {
    val model = remember(backend, teamId) { BoardsModel(backend, teamId) }
    val boards by model.boards.collectAsState()
    val state by model.state.collectAsState()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var refreshing by remember { mutableStateOf(false) }
    val scroll = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    LaunchedEffect(model) { model.load() }

    Scaffold(
        containerColor = DesignTheme.ground,
        modifier = Modifier.nestedScroll(scroll.nestedScrollConnection),
        topBar = {
            LargeTopAppBar(
                title = { Text(teamName.ifEmpty { "Boards" }, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back") } },
                colors = TopAppBarDefaults.largeTopAppBarColors(containerColor = DesignTheme.ground, scrolledContainerColor = DesignTheme.ground),
                scrollBehavior = scroll,
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
            modifier = Modifier.padding(padding).fillMaxSize(),
        ) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp)) {
                val s = state
                when {
                    s is LoadState.Idle || (s is LoadState.Loading && boards.isEmpty()) -> item { LoadingRows() }
                    s is LoadState.Failed && boards.isEmpty() -> item { ErrorState(s.message) { scope.launch { model.load() } } }
                    boards.isEmpty() ->
                        item {
                            EmptyState(
                                Icons.Outlined.FilterNone,
                                "No boards in this team",
                                "Boards are created in Mero Design on the web or desktop. Pull to refresh once one exists.",
                            )
                        }
                    else -> {
                        item { SectionLabel(if (boards.size == 1) "1 board" else "${boards.size} boards") }
                        items(boards, key = { it.contextId }) { board ->
                            SwipeToShare(onShare = { shareLink(context, DesignFormat.boardLink(teamId, board.contextId), board.name) }) {
                                BoardRow(board) { onOpen(board) }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Swipe a row left to share it; the row springs back. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SwipeToShare(
    onShare: () -> Unit,
    content: @Composable () -> Unit,
) {
    val state =
        rememberSwipeToDismissBoxState(confirmValueChange = { value ->
            if (value == SwipeToDismissBoxValue.EndToStart) onShare()
            false
        })
    SwipeToDismissBox(
        state = state,
        enableDismissFromStartToEnd = false,
        modifier = Modifier.padding(vertical = 6.dp),
        backgroundContent = {
            Box(
                Modifier.fillMaxSize().background(DesignTheme.ink, DesignTheme.cardShape).padding(horizontal = 20.dp),
                contentAlignment = Alignment.CenterEnd,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Share, contentDescription = null, tint = DesignTheme.lime, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Share", style = DesignTheme.body(15, FontWeight.SemiBold, DesignTheme.lime))
                }
            }
        },
    ) { content() }
}

@Composable
private fun BoardRow(
    board: BoardSummary,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip14()
            .background(DesignTheme.surface)
            .clickable(onClick = onClick)
            .card(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(44.dp).background(DesignTheme.lime.copy(alpha = 0.35f), RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
            Icon(Icons.Outlined.Dashboard, contentDescription = null, tint = DesignTheme.ink, modifier = Modifier.size(20.dp))
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(board.name, style = DesignTheme.heading(17), maxLines = 1, overflow = TextOverflow.Ellipsis)
            val count = board.elementCount?.let { if (it == 1) "1 layer" else "$it layers" }
            val subtitle = listOfNotNull(board.description.ifEmpty { null }, count).joinToString(" · ").ifEmpty { "Board" }
            Text(subtitle, style = DesignTheme.body(14, color = DesignTheme.muted), maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

private fun Modifier.clip14(): Modifier = this.clip(DesignTheme.cardShape)
