package network.calimero.standup.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Drafts
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material3.AlertDialog
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.standup.app.StandupViewModel
import network.calimero.standup.app.TeamSummary
import network.calimero.standup.app.TeamsModel
import network.calimero.standup.core.Limits
import network.calimero.standup.core.StandupInvitation

/** Signed in, no team open: the teams, start one, join one. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TeamsScreen(
    vm: StandupViewModel,
    model: TeamsModel,
) {
    val teams by model.teams.collectAsState()
    val loading by model.isLoading.collectAsState()
    val loaded by model.hasLoaded.collectAsState()
    val error by model.error.collectAsState()
    val pending by vm.session.pendingInvitation.collectAsState()
    val scope = rememberCoroutineScope()
    var starting by remember { mutableStateOf(false) }
    var joining by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }

    LaunchedEffect(model) { model.load() }

    fun joined(team: TeamSummary) {
        scope.launch {
            vm.didJoin()
            vm.open(team)
        }
    }

    Scaffold(
        containerColor = Palette.background,
        topBar = {
            LargeTopAppBar(
                title = { Text("Teams", fontWeight = FontWeight.SemiBold) },
                actions = {
                    Box {
                        IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.AccountCircle, contentDescription = "Account") }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(
                                text = { Text("Sign out") },
                                leadingIcon = { Icon(Icons.AutoMirrored.Outlined.Logout, contentDescription = null) },
                                onClick = {
                                    menu = false
                                    vm.signOut()
                                },
                            )
                        }
                    }
                },
                colors = TopAppBarDefaults.largeTopAppBarColors(containerColor = Palette.background, scrolledContainerColor = Palette.background),
            )
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = loading && loaded,
            onRefresh = { scope.launch { model.load() } },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            LazyColumn(
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                if (error != null) item { ErrorLine(error) }
                if (!loaded) {
                    item { Muted("Loading teams…", Modifier.padding(8.dp)) }
                } else if (teams.isEmpty()) {
                    item {
                        EmptyState(
                            Icons.Outlined.Groups,
                            "No teams yet",
                            if (model.hasRelay) {
                                "Start one, or open an invitation link someone sent you."
                            } else {
                                "Your account has no relay yet. Join a team with an invitation link first."
                            },
                        )
                    }
                }
                items(teams, key = { it.contextId }) { team -> TeamRow(team) { vm.open(team) } }
                item {
                    Spacer(Modifier.size(4.dp))
                    if (model.hasRelay) {
                        PrimaryButton("Start a team", onClick = { starting = true }, icon = Icons.Filled.Add, modifier = Modifier.fillMaxWidth())
                        Spacer(Modifier.size(10.dp))
                    }
                    SecondaryButton("Join with an invitation", onClick = { joining = true }, icon = Icons.Outlined.Drafts, modifier = Modifier.fillMaxWidth())
                }
            }
        }
    }

    if (starting) {
        StartTeamSheet(model, onDismiss = { starting = false }) { team ->
            starting = false
            vm.open(team)
        }
    }
    if (joining) {
        JoinTeamSheet(model, onDismiss = { joining = false }) { team ->
            joining = false
            joined(team)
        }
    }
    val link = pending
    if (link != null) {
        val invitation = remember(link) { StandupInvitation.parse(link) }
        var busy by remember(link) { mutableStateOf(false) }
        AlertDialog(
            onDismissRequest = { vm.session.dismissPendingInvitation() },
            title = { Text("Join this team?") },
            text = {
                Text(
                    if (invitation == null) {
                        "That is not a Mero Standup invitation link."
                    } else {
                        "Joining makes your account a member of the namespace this team lives in, and the team's updates and decisions sync to you from the other members."
                    },
                )
            },
            confirmButton = {
                if (invitation != null) {
                    PrimaryButton("Join team", busy = busy, onClick = {
                        busy = true
                        scope.launch {
                            val team = model.join(invitation)
                            busy = false
                            vm.session.dismissPendingInvitation()
                            if (team != null) joined(team)
                        }
                    })
                }
            },
            dismissButton = { LinkButton("Not now", onClick = { vm.session.dismissPendingInvitation() }) },
            containerColor = Palette.surface,
        )
    }
}

@Composable
private fun TeamRow(
    team: TeamSummary,
    onOpen: () -> Unit,
) {
    StandupCard(Modifier.clip(RoundedCornerShape(14.dp)).clickable(onClick = onOpen), padding = 14.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(40.dp).clip(RoundedCornerShape(10.dp)).background(Palette.lime.copy(alpha = 0.35f)),
                contentAlignment = Alignment.Center,
            ) {
                Text(team.title.take(1).uppercase(), fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
            }
            Spacer(Modifier.width(12.dp))
            Text(
                team.title,
                fontSize = 17.sp,
                fontWeight = FontWeight.SemiBold,
                color = if (team.name.isEmpty()) Palette.ink2 else Palette.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = Palette.ink3)
        }
    }
}

@Composable
private fun StartTeamSheet(
    model: TeamsModel,
    onDismiss: () -> Unit,
    onStarted: (TeamSummary) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val busy by model.isWorking.collectAsState()
    val error by model.error.collectAsState()
    var name by remember { mutableStateOf("") }
    StandupSheet("Start a team", onDismiss) {
        LabeledField(null, name, { name = it }, "Team name, e.g. Platform", Limits.TEAM_NAME, singleLine = true)
        ErrorLine(error)
        PrimaryButton(if (busy) "Creating…" else "Start team", busy = busy, modifier = Modifier.fillMaxWidth(), onClick = {
            scope.launch { model.create(name)?.let(onStarted) }
        })
    }
}

@Composable
private fun JoinTeamSheet(
    model: TeamsModel,
    onDismiss: () -> Unit,
    onJoined: (TeamSummary) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val busy by model.isWorking.collectAsState()
    val error by model.error.collectAsState()
    var link by remember { mutableStateOf("") }
    var invalid by remember { mutableStateOf(false) }
    StandupSheet("Join a team", onDismiss) {
        Muted("Paste the invitation link a teammate sent you.")
        LabeledField(null, link, {
            link = it
            invalid = false
        }, "Invitation link", 8_192, singleLine = true)
        ErrorLine(if (invalid) "That is not a Mero Standup invitation link." else error)
        PrimaryButton(if (busy) "Joining…" else "Join", busy = busy, enabled = link.isNotBlank(), modifier = Modifier.fillMaxWidth(), onClick = {
            val invitation = StandupInvitation.parse(link)
            if (invitation == null) {
                invalid = true
            } else {
                scope.launch { model.join(invitation)?.let(onJoined) }
            }
        })
    }
}
