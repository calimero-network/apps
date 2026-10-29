package network.calimero.calendar.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
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
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import network.calimero.calendar.app.Team
import network.calimero.calendar.app.TeamsModel
import network.calimero.calendar.data.ErrorText

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TeamsScreen(
    model: TeamsModel,
    account: String?,
    onOpen: (Team) -> Unit,
    onCreated: (Team) -> Unit,
    onJoined: suspend (String) -> Unit,
    onSignOut: () -> Unit,
    onShare: (String, String) -> Unit,
) {
    val state by model.state.collectAsState()
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    var addMenu by remember { mutableStateOf(false) }
    var accountMenu by remember { mutableStateOf(false) }
    var creating by remember { mutableStateOf(false) }
    var joining by remember { mutableStateOf(false) }
    var inviting by remember { mutableStateOf<Team?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    val scroll = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()

    LaunchedEffect(model) { model.load() }

    Scaffold(
        modifier = Modifier.nestedScroll(scroll.nestedScrollConnection),
        containerColor = Tokens.ground,
        topBar = {
            LargeTopAppBar(
                title = { Text("Your Teams") },
                scrollBehavior = scroll,
                colors = TopAppBarDefaults.largeTopAppBarColors(containerColor = Tokens.ground, scrolledContainerColor = Tokens.ground),
                actions = {
                    Box {
                        IconButton(onClick = { addMenu = true }) { Icon(Icons.Filled.Add, contentDescription = "Add") }
                        DropdownMenu(expanded = addMenu, onDismissRequest = { addMenu = false }) {
                            if (!state.noRelay) {
                                DropdownMenuItem(
                                    text = { Text("Create team") },
                                    leadingIcon = { Icon(Icons.Filled.Add, null) },
                                    onClick = {
                                        addMenu = false
                                        creating = true
                                    },
                                )
                            }
                            DropdownMenuItem(
                                text = { Text("Join with a link") },
                                leadingIcon = { Icon(Icons.Filled.Link, null) },
                                onClick = {
                                    addMenu = false
                                    joining = true
                                },
                            )
                        }
                    }
                    Box {
                        IconButton(onClick = { accountMenu = true }) { Icon(Icons.Filled.AccountCircle, contentDescription = "Account") }
                        DropdownMenu(expanded = accountMenu, onDismissRequest = { accountMenu = false }) {
                            DropdownMenuItem(
                                text = { Text(account?.let { "Signed in as ${it.take(10)}…" } ?: "Signed in", color = Tokens.muted) },
                                onClick = {},
                                enabled = false,
                            )
                            DropdownMenuItem(
                                text = { Text("Sign out") },
                                leadingIcon = { Icon(Icons.AutoMirrored.Filled.Logout, null) },
                                onClick = {
                                    accountMenu = false
                                    onSignOut()
                                },
                            )
                        }
                    }
                },
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
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(padding),
        ) {
            LazyColumn(
                contentPadding = PaddingValues(horizontal = Tokens.gutter, vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                item { Text("Teams are shared calendars.", style = Tokens.caption, modifier = Modifier.padding(bottom = 6.dp)) }
                notice?.let { item { ErrorBanner(it) } }
                state.error?.let { item { ErrorBanner(it) { scope.launch { model.load() } } } }
                when {
                    state.noRelay ->
                        item {
                            EmptyState(Icons.Filled.Link, "Join your first team", "Your account isn't on a relay yet. Open an invitation link to join a team.") {
                                PrimaryButton("Join with a link", onClick = { joining = true })
                            }
                        }
                    state.loading -> item { Loading() }
                    state.teams.isEmpty() && state.error == null ->
                        item {
                            EmptyState(Icons.Filled.CalendarMonth, "No teams yet", "Create one, or open an invitation link someone sent you.") {
                                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                    PrimaryButton("Create team", onClick = { creating = true })
                                    SecondaryButton("Join with a link", onClick = { joining = true }, icon = Icons.Filled.Link)
                                }
                            }
                        }
                    else ->
                        items(state.teams, key = { it.id }) { team ->
                            TeamRow(team, onOpen = { onOpen(team) }, onInvite = { inviting = team })
                        }
                }
            }
        }
    }

    if (creating) {
        FormSheet(
            title = "New team",
            label = "Team name",
            placeholder = "e.g. Design team",
            action = "Create team",
            busyAction = "Creating…",
            onDismiss = { creating = false },
        ) { name ->
            try {
                val created = model.create(name)
                notice = created.warning
                creating = false
                onCreated(created.team)
                null
            } catch (e: Exception) {
                ErrorText.of(e, "create the team")
            }
        }
    }
    if (joining) {
        JoinSheet(
            onDismiss = { joining = false },
            onJoin = { link ->
                val id = model.join(link)
                joining = false
                onJoined(id)
            },
        )
    }
    inviting?.let { team ->
        InviteSheet(team.name, makeLink = { model.inviteLink(team) }, onShare = onShare, onDismiss = { inviting = null })
    }
}

/** "Join a team": paste the link. */
@Composable
fun JoinSheet(
    onDismiss: () -> Unit,
    onJoin: suspend (String) -> Unit,
) {
    FormSheet(
        title = "Join a team",
        body = "Paste the invitation link someone sent you.",
        label = null,
        placeholder = "https://links.calimero.network/…",
        action = "Join team",
        busyAction = "Joining…",
        paste = true,
        onDismiss = onDismiss,
    ) { link ->
        try {
            onJoin(link)
            null
        } catch (e: IllegalArgumentException) {
            e.message ?: TeamsModel.NOT_AN_INVITATION
        } catch (e: Exception) {
            ErrorText.of(e, "join the team")
        }
    }
}

@Composable
private fun TeamRow(
    team: Team,
    onOpen: () -> Unit,
    onInvite: () -> Unit,
) {
    Card(onClick = onOpen) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            IconTile()
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(team.name, style = Tokens.heading)
                Text("Shared calendars", style = Tokens.caption)
            }
            IconButton(onClick = onInvite) { Icon(Icons.Filled.PersonAdd, contentDescription = "Invite", tint = Tokens.ink) }
        }
    }
}
