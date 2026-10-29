package network.calimero.kombat.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.TrackChanges
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
import network.calimero.kombat.app.ArenaEntry
import network.calimero.kombat.app.ArenaRef
import network.calimero.kombat.app.KombatConstants
import network.calimero.kombat.app.KombatInvitation
import network.calimero.kombat.app.KombatText
import network.calimero.kombat.app.LobbyModel

/** The arenas: practice first, then every arena in every namespace this account is in. (iOS `LobbyScreen`.) */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LobbyScreen(
    backend: MeroAppBackend,
    applicationId: String?,
    account: String,
    onOpen: (ArenaRef) -> Unit,
    onPractice: () -> Unit,
    onJoin: (KombatInvitation) -> Unit,
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

    fun invite(ref: ArenaRef) {
        scope.launch {
            runCatching { model.inviteLink(ref) }
                .onSuccess(onShare)
                .onFailure { actionError = KombatText.error(it) }
        }
    }

    Scaffold(
        containerColor = KombatColors.Ground,
        topBar = {
            TopAppBar(
                title = { Text("Arenas", style = Type.heading(20)) },
                navigationIcon = {
                    IconButton(onClick = { showingAccount = true }) {
                        Icon(Icons.Outlined.AccountCircle, contentDescription = "Account", tint = KombatColors.Ink)
                    }
                },
                actions = {
                    Box {
                        IconButton(onClick = { menu = true }) {
                            Icon(Icons.Filled.Add, contentDescription = "New arena", tint = KombatColors.Ink)
                        }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(
                                text = { Text("New arena") },
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
                colors = TopAppBarDefaults.topAppBarColors(containerColor = KombatColors.Ground),
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
            // Landscape: a centred column, not rows stretched across the whole phone.
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
                LazyColumn(
                    modifier = Modifier.widthIn(max = 720.dp).fillMaxSize(),
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
                    item { PracticeRow(onPractice) }
                    when {
                        !state.loaded ->
                            item {
                                Box(Modifier.fillMaxWidth().padding(vertical = 40.dp), contentAlignment = Alignment.Center) {
                                    CircularProgressIndicator(color = KombatColors.Ink, strokeWidth = 2.dp)
                                }
                            }
                        !model.hasRelay ->
                            item {
                                EmptyState(
                                    title = "Join your first arena",
                                    text = "Your account has no relay yet. Open an invitation link someone sent you, or paste it here.",
                                    action = "Join with a link",
                                ) { pasting = true }
                            }
                        state.arenas.isEmpty() ->
                            item {
                                EmptyState(
                                    title = "No arenas yet",
                                    text = "Start one with New arena, or open an invitation link someone sent you.",
                                    action = "New arena",
                                ) { creating = true }
                            }
                        else -> {
                            item {
                                Text("Arenas", style = Type.body(13, FontWeight.SemiBold, KombatColors.Muted), modifier = Modifier.padding(top = 6.dp))
                            }
                            items(state.arenas, key = { it.id }) { entry ->
                                SwipeToInvite(onInvite = { invite(entry.ref) }) {
                                    ArenaRow(entry) { onOpen(entry.ref) }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (creating) {
        NewArenaSheet(
            namespaces = state.namespaces,
            onCreate = { title, namespaceId -> onOpen(model.create(title, namespaceId)) },
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
                    .background(KombatColors.Ink)
                    .padding(horizontal = 20.dp),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.Share, contentDescription = null, tint = KombatColors.Surface)
                Spacer(Modifier.width(8.dp))
                Text("Invite", style = Type.body(15, FontWeight.SemiBold, KombatColors.Surface))
            }
        },
    ) { content() }
}

@Composable
private fun RowCard(
    onClick: () -> Unit,
    content: @Composable RowScope.() -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(CardShape)
                .background(KombatColors.Surface)
                .border(Hairline, KombatColors.Line, CardShape)
                .clickable(onClick = onClick)
                .padding(14.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) { content() }
}

/** Practice against the CPU, offline: always the first row. */
@Composable
private fun PracticeRow(onClick: () -> Unit) {
    RowCard(onClick) {
        Box(Modifier.size(48.dp).clip(RoundedCornerShape(12.dp)).background(KombatColors.Lime), contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.TrackChanges, contentDescription = null, tint = KombatColors.Ink, modifier = Modifier.size(22.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text("Practice vs CPU", style = Type.heading(16))
            Text("Off the chain: nothing here is a transaction.", style = Type.body(13, color = KombatColors.Muted))
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = KombatColors.Muted)
    }
}

/** One arena in the list: both corners, the title, and where the fight is. */
@Composable
private fun ArenaRow(
    entry: ArenaEntry,
    onClick: () -> Unit,
) {
    val summary = entry.summary
    RowCard(onClick) {
        Row(horizontalArrangement = Arrangement.spacedBy((-10).dp)) {
            FighterBadge(summary?.fighters?.firstOrNull(), size = 40.dp)
            FighterBadge(
                summary?.fighters?.lastOrNull(),
                size = 40.dp,
                mirrored = true,
                modifier = Modifier.border(2.dp, KombatColors.Surface, RoundedCornerShape(40.dp * 0.27f)),
            )
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(summary?.title ?: KombatConstants.DEFAULT_TITLE, style = Type.heading(16), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                summary?.players ?: entry.namespaceName ?: "Syncing…",
                style = Type.body(13, color = KombatColors.Muted),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (summary != null) {
            Text("${summary.totalActions} tx", style = Type.mono.copy(color = KombatColors.Muted))
            Text(
                summary.state,
                style = Type.body(12, FontWeight.SemiBold),
                modifier =
                    Modifier
                        .clip(CircleShape)
                        .background(if (summary.live && summary.mine) KombatColors.Lime else KombatColors.Sunken)
                        .padding(horizontal = 10.dp, vertical = 5.dp),
            )
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = KombatColors.Muted)
    }
}

@Composable
fun EmptyState(
    title: String,
    text: String,
    action: String,
    onAction: () -> Unit,
) {
    Column(
        Modifier.fillMaxWidth().padding(vertical = 28.dp, horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        FighterBadge("kinetic", size = 64.dp)
        Text(title, style = Type.heading(20))
        Text(text, style = Type.body(15, color = KombatColors.Muted), textAlign = TextAlign.Center)
        PrimaryButton(onClick = onAction, fullWidth = false, modifier = Modifier.padding(top = 4.dp)) { ButtonLabel(action) }
    }
}
