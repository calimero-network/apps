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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AddCircle
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material3.CircularProgressIndicator
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
import network.calimero.pass.core.TeamModel
import network.calimero.pass.core.TeamRow
import network.calimero.pass.core.VaultRef
import network.calimero.pass.core.VaultRow

/** One team: its vaults, a new vault, and invitations. */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun TeamScreen(
    model: TeamModel,
    team: TeamRow,
    back: () -> Unit,
    open: (VaultRef) -> Unit,
) {
    val vaults by model.vaults.collectAsState()
    val phase by model.phase.collectAsState()
    val entering by model.entering.collectAsState()
    val scope = rememberCoroutineScope()
    var creating by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var rowMenu by remember { mutableStateOf<String?>(null) }
    var invite by remember { mutableStateOf<InviteShown?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }

    LaunchedEffect(model) { model.load() }

    fun enter(vault: VaultRow) {
        scope.launch {
            runCatching { model.enter(vault) }.onSuccess(open).onFailure { error = PassErrorText.describe(it) }
        }
    }

    fun inviteToTeam() {
        scope.launch {
            runCatching { model.teamInvite() }
                .onSuccess { invite = InviteShown("Invite to ${team.name}", it, TEAM_INVITE_HINT) }
                .onFailure { error = PassErrorText.describe(it) }
        }
    }

    fun inviteToVault(vault: VaultRow) {
        scope.launch {
            runCatching { model.vaultInvite(vault) }
                .onSuccess { invite = InviteShown("Invite to ${vault.name}", it, vaultInviteHint(vault.name, team.name)) }
                .onFailure { error = PassErrorText.describe(it) }
        }
    }

    Scaffold(
        containerColor = Palette.Ground,
        topBar = {
            PassTopBar(team.name, back = back, actions = {
                Box {
                    IconButton(onClick = { menu = true }) {
                        Icon(Icons.Filled.AddCircle, contentDescription = "New vault or invite", tint = Palette.Ink)
                    }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, containerColor = Palette.Surface) {
                        DropdownMenuItem(
                            text = { Text("New vault") },
                            leadingIcon = { Icon(Icons.Filled.Add, null) },
                            onClick = {
                                menu = false
                                creating = true
                            },
                        )
                        DropdownMenuItem(
                            text = { Text("Invite to team") },
                            leadingIcon = { Icon(Icons.Outlined.PersonAdd, null) },
                            onClick = {
                                menu = false
                                inviteToTeam()
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
                    Row(Modifier.padding(horizontal = 20.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Tile(team.name, 52.dp)
                        Spacer(Modifier.width(14.dp))
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(team.name, fontSize = 24.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
                            Text("Open vaults are shared with everyone in this team.", fontSize = 14.sp, color = Palette.Muted)
                        }
                    }
                }
                error?.let { item { ErrorBanner(it, Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) { error = null } } }
                when {
                    phase == LoadPhase.Loading && vaults.isEmpty() -> item { LoadingBox() }
                    phase is LoadPhase.Failed -> item { ErrorState((phase as LoadPhase.Failed).message) { scope.launch { model.load() } } }
                    vaults.isEmpty() ->
                        item {
                            EmptyState(
                                Icons.Outlined.Lock,
                                "No vaults in this team yet",
                                "Create one: everyone already in the team gets it.",
                                action = "New vault",
                            ) { creating = true }
                        }
                    else -> {
                        item { SectionLabel("Vaults", Modifier.padding(start = 20.dp, top = 12.dp, bottom = 6.dp)) }
                        items(vaults, key = { it.id }) { vault ->
                            Box(Modifier.padding(horizontal = 16.dp, vertical = 4.dp).clip(RoundedCornerShape(14.dp))) {
                                SwipeRow(end = SwipeAction("Invite", Icons.Outlined.PersonAdd, Palette.Ink) { inviteToVault(vault) }) {
                                    VaultRowView(
                                        vault,
                                        entering == vault.id,
                                        Modifier.combinedClickable(onClick = { enter(vault) }, onLongClick = { rowMenu = vault.id }),
                                    )
                                }
                                DropdownMenu(expanded = rowMenu == vault.id, onDismissRequest = { rowMenu = null }, containerColor = Palette.Surface) {
                                    DropdownMenuItem(
                                        text = { Text("Invite someone to ${vault.name}") },
                                        leadingIcon = { Icon(Icons.Outlined.PersonAdd, null) },
                                        onClick = {
                                            rowMenu = null
                                            inviteToVault(vault)
                                        },
                                    )
                                }
                            }
                        }
                    }
                }
                item { PassSection { DetailsDisclosure(listOf("Team id" to team.id)) } }
            }
        }
    }

    if (creating) {
        NameSheet(
            title = "New vault",
            label = "Vault name",
            placeholder = "Bank logins, Production keys…",
            hint = "Everyone already in ${team.name} gets it. Its key is made on this phone the first time it opens.",
            action = "Create",
            dismiss = { creating = false },
        ) { name -> open(model.create(name)) }
    }
    invite?.let { InviteLinkSheet(it.title, it.link, it.hint) { invite = null } }
}

fun vaultInviteHint(
    vaultName: String,
    teamName: String,
): String =
    "This link lands them in “$vaultName”, but the access it grants is the whole of $teamName: every open vault in the team, including ones added later."

@Composable
private fun VaultRowView(
    vault: VaultRow,
    entering: Boolean,
    modifier: Modifier,
) {
    Row(
        modifier
            .fillMaxWidth()
            .background(Palette.Surface)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Tile(vault.name, 40.dp, icon = Icons.Filled.Lock)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(vault.name, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
            when {
                vault.contextId == null -> Text("Still syncing", fontSize = 13.sp, color = Palette.Muted)
                vault.joined -> PassBadge("You are in", strong = true)
                else -> PassBadge("Not joined, tap to join")
            }
        }
        if (entering) {
            CircularProgressIndicator(color = Palette.Ink, modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
        } else {
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = Palette.Muted)
        }
    }
}
