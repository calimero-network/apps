package network.calimero.pass.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AddCircle
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.pass.core.LoadPhase
import network.calimero.pass.core.PassErrorText
import network.calimero.pass.core.TeamRow
import network.calimero.pass.core.TeamsModel

/** An invitation link on screen: its sheet's title, the link, and what it grants. */
data class InviteShown(
    val title: String,
    val link: String,
    val hint: String,
)

const val TEAM_INVITE_HINT =
    "Anyone who opens this link can join the team and open every vault that is not invite-only. Their devices get each vault's key the next time a member who holds it opens the vault."

/** Your teams: each one the people, and the vaults they share. */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun TeamsScreen(
    model: TeamsModel,
    open: (TeamRow) -> Unit,
    openInvitation: (String) -> Unit,
) {
    val teams by model.teams.collectAsState()
    val phase by model.phase.collectAsState()
    val scope = rememberCoroutineScope()
    var creating by remember { mutableStateOf(false) }
    var joining by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var rowMenu by remember { mutableStateOf<String?>(null) }
    var invite by remember { mutableStateOf<InviteShown?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }

    LaunchedEffect(model) { model.load() }

    fun inviteTo(team: TeamRow) {
        scope.launch {
            runCatching { model.invite(team) }
                .onSuccess { invite = InviteShown("Invite to ${team.name}", it, TEAM_INVITE_HINT) }
                .onFailure { error = PassErrorText.describe(it) }
        }
    }

    Scaffold(
        containerColor = Palette.Ground,
        topBar = {
            PassTopBar("Vaults", actions = {
                Box {
                    IconButton(onClick = { menu = true }) {
                        Icon(Icons.Filled.AddCircle, contentDescription = "New team or join", tint = Palette.Ink)
                    }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, containerColor = Palette.Surface) {
                        DropdownMenuItem(
                            text = { Text("New team") },
                            leadingIcon = { Icon(Icons.Filled.Add, null) },
                            enabled = model.hasRelay,
                            onClick = {
                                menu = false
                                creating = true
                            },
                        )
                        DropdownMenuItem(
                            text = { Text("Join with a link") },
                            leadingIcon = { Icon(Icons.Filled.Link, null) },
                            onClick = {
                                menu = false
                                joining = true
                            },
                        )
                    }
                }
            })
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
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(vertical = 8.dp)) {
                item {
                    Column(Modifier.padding(horizontal = 20.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        SectionLabel("End-to-end encrypted")
                        Text("Your vaults", fontSize = 28.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
                        Text("A team is the people. Every vault inside it is readable by everyone you invite.", fontSize = 15.sp, color = Palette.Muted)
                    }
                }
                error?.let { item { ErrorBanner(it, Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) { error = null } } }
                when {
                    phase == LoadPhase.Loading && teams.isEmpty() -> item { LoadingBox() }
                    phase is LoadPhase.Failed -> item { ErrorState((phase as LoadPhase.Failed).message) { scope.launch { model.load() } } }
                    teams.isEmpty() ->
                        item {
                            EmptyState(
                                Icons.Outlined.Groups,
                                "No teams yet",
                                if (model.hasRelay) {
                                    "Start one, or open an invitation link someone sent you."
                                } else {
                                    "Open an invitation link someone sent you to join their team."
                                },
                                action = if (model.hasRelay) "New team" else "Join with a link",
                            ) { if (model.hasRelay) creating = true else joining = true }
                        }
                    else -> {
                        item { SectionLabel("Teams", Modifier.padding(start = 20.dp, top = 12.dp, bottom = 6.dp)) }
                        items(teams, key = { it.id }) { team ->
                            Box(Modifier.padding(horizontal = 16.dp, vertical = 4.dp).clip(RoundedCornerShape(14.dp))) {
                                SwipeRow(end = SwipeAction("Invite", Icons.Outlined.PersonAdd, Palette.Ink) { inviteTo(team) }) {
                                    TeamRowView(team, Modifier.combinedClickable(onClick = { open(team) }, onLongClick = { rowMenu = team.id }))
                                }
                                DropdownMenu(expanded = rowMenu == team.id, onDismissRequest = { rowMenu = null }, containerColor = Palette.Surface) {
                                    DropdownMenuItem(
                                        text = { Text("Invite someone") },
                                        leadingIcon = { Icon(Icons.Outlined.PersonAdd, null) },
                                        onClick = {
                                            rowMenu = null
                                            inviteTo(team)
                                        },
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (creating) {
        NameSheet(
            title = "New team",
            label = "Team name",
            placeholder = "Acme, the family, the lab…",
            hint = "You become its Admin and can invite people.",
            action = "Create",
            dismiss = { creating = false },
        ) { name -> model.create(name) }
    }
    if (joining) JoinSheet(open = openInvitation, dismiss = { joining = false })
    invite?.let { InviteLinkSheet(it.title, it.link, it.hint) { invite = null } }
}

@Composable
fun TeamRowView(
    team: TeamRow,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier
            .fillMaxWidth()
            .background(Palette.Surface)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Tile(team.name, 44.dp)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(team.name, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                PassBadge("${team.vaultCount} vault${if (team.vaultCount == 1) "" else "s"}")
                if (team.memberCount > 0) PassBadge("${team.memberCount} member${if (team.memberCount == 1) "" else "s"}")
            }
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = Palette.Muted)
    }
}

/** A one-field create sheet: a name, then the action. */
@Composable
fun NameSheet(
    title: String,
    label: String,
    placeholder: String,
    hint: String,
    action: String,
    dismiss: () -> Unit,
    submit: suspend (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun save() {
        if (busy || name.isBlank()) return
        busy = true
        error = null
        scope.launch {
            runCatching { submit(name) }
                .onSuccess { dismiss() }
                .onFailure { error = PassErrorText.describe(it) }
            busy = false
        }
    }

    PassSheet(dismiss, locked = busy) {
        SheetBar(title, action, cancel = dismiss, canAct = name.isNotBlank(), busy = busy, act = { save() })
        Column(
            Modifier
                .fillMaxWidth()
                .padding(20.dp)
                .navigationBarsPadding()
                .imePadding(),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            error?.let { ErrorBanner(it) }
            InputField(label, name, { name = it }, placeholder = placeholder)
            Text(hint, fontSize = 14.sp, color = Palette.Muted)
        }
    }
}
