package network.calimero.crm.ui

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Business
import androidx.compose.material.icons.outlined.Drafts
import androidx.compose.material.icons.outlined.ViewWeek
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
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
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.crm.app.CrmViewModel
import network.calimero.crm.app.PipelineRef
import network.calimero.crm.app.Workspace
import network.calimero.crm.app.WorkspacesModel
import network.calimero.crm.core.Account
import network.calimero.crm.core.CrmInvitation

/** Signed in, no pipeline open: your workspaces and their pipelines, founding one, adding a pipeline, joining. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WorkspacesScreen(
    vm: CrmViewModel,
    model: WorkspacesModel,
) {
    val workspaces by model.workspaces.collectAsState()
    val hasLoaded by model.hasLoaded.collectAsState()
    val error by model.error.collectAsState()
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    var creating by remember { mutableStateOf(false) }
    var joining by remember { mutableStateOf(false) }
    var addingTo by remember { mutableStateOf<Workspace?>(null) }
    var menu by remember { mutableStateOf(false) }
    LaunchedEffect(model) { model.load() }

    Scaffold(
        containerColor = Palette.background,
        topBar = {
            TopAppBar(
                title = { Text("Workspaces", fontWeight = FontWeight.Bold, fontSize = 28.sp) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Palette.background),
                actions = {
                    Box {
                        IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.AccountCircle, contentDescription = "Account") }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            vm.session.account?.let { DropdownMenuItem(text = { Text("Signed in as ${Account.short(it)}") }, onClick = {}, enabled = false) }
                            DropdownMenuItem(
                                text = { Text("Sign out", color = Palette.danger) },
                                leadingIcon = { Icon(Icons.AutoMirrored.Outlined.Logout, contentDescription = null, tint = Palette.danger) },
                                onClick = {
                                    menu = false
                                    vm.signOut()
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
            modifier = Modifier.padding(padding).fillMaxSize(),
        ) {
            LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                error?.let { item { ErrorLine(it) } }
                when {
                    !hasLoaded ->
                        item {
                            Box(Modifier.fillMaxWidth().padding(vertical = 40.dp), contentAlignment = Alignment.Center) {
                                CircularProgressIndicator(color = Palette.ink)
                            }
                        }
                    workspaces.isEmpty() ->
                        item {
                            CrmCard {
                                EmptyState(
                                    Icons.Outlined.Business,
                                    "No workspaces yet",
                                    if (model.hasRelay) {
                                        "Start one for your team, or open an invitation link someone sent you."
                                    } else {
                                        "Your account has no relay yet. Join a workspace with an invitation link first."
                                    },
                                )
                            }
                        }
                    else -> items(workspaces, key = { it.id }) { ws -> WorkspaceCard(ws, onOpen = { vm.open(it) }, onAdd = { addingTo = ws }) }
                }
                item {
                    Column(Modifier.padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        if (model.hasRelay) PrimaryButton("New workspace", onClick = { creating = true }, icon = Icons.Outlined.Add)
                        SecondaryButton("Join with an invitation", onClick = { joining = true }, icon = Icons.Outlined.Drafts, modifier = Modifier.fillMaxWidth())
                    }
                }
            }
        }
    }
    if (creating) NewWorkspaceSheet(model, onDismiss = { creating = false }) { vm.open(it) }
    addingTo?.let { ws -> AddPipelineSheet(model, ws, onDismiss = { addingTo = null }) { vm.open(it) } }
    if (joining) JoinSheet(vm, model, onDismiss = { joining = false })
}

@Composable
private fun WorkspaceCard(
    workspace: Workspace,
    onOpen: (PipelineRef) -> Unit,
    onAdd: () -> Unit,
) {
    Surface(shape = RoundedCornerShape(14.dp), color = Palette.surface, border = BorderStroke(1.dp, Palette.hairline)) {
        Column {
            Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(40.dp).clip(RoundedCornerShape(10.dp)).background(Palette.limeSoft), contentAlignment = Alignment.Center) {
                    Text(workspace.title.take(1).uppercase(), fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
                }
                Spacer(Modifier.width(12.dp))
                Column {
                    Text(workspace.title, fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
                    Text(subtitle(workspace), fontSize = 13.sp, color = Palette.ink2)
                }
            }
            Divider()
            if (workspace.pipelines.isEmpty()) {
                Text(
                    "No pipelines here yet. A teammate's pipelines appear once they sync to you.",
                    fontSize = 13.sp,
                    color = Palette.ink2,
                    modifier = Modifier.padding(14.dp),
                )
            }
            for (p in workspace.pipelines) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable { onOpen(p) }
                        .heightIn(min = 48.dp)
                        .padding(horizontal = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Outlined.ViewWeek, contentDescription = null, tint = Palette.ink2, modifier = Modifier.size(22.dp))
                    Spacer(Modifier.width(12.dp))
                    Text(p.name, fontSize = 16.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
                    Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, contentDescription = null, tint = Palette.ink3)
                }
                Divider()
            }
            Row(
                Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onAdd)
                    .heightIn(min = 46.dp)
                    .padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.Add, contentDescription = null, tint = Palette.ink2, modifier = Modifier.size(22.dp))
                Spacer(Modifier.width(12.dp))
                Text("Add pipeline", fontSize = 15.sp, fontWeight = FontWeight.Medium, color = Palette.ink2)
            }
        }
    }
}

private fun subtitle(ws: Workspace): String {
    val p = ws.pipelines.size
    val pipelines = "$p pipeline${if (p == 1) "" else "s"}"
    return if (ws.memberCount > 0) "$pipelines · ${ws.memberCount} member${if (ws.memberCount == 1) "" else "s"}" else pipelines
}

@Composable
private fun NewWorkspaceSheet(
    model: WorkspacesModel,
    onDismiss: () -> Unit,
    onCreated: (PipelineRef) -> Unit,
) {
    var name by remember { mutableStateOf("") }
    var pipeline by remember { mutableStateOf("Sales") }
    var currency by remember { mutableStateOf("USD") }
    val busy by model.isWorking.collectAsState()
    val error by model.error.collectAsState()
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { model.error.value = null }
    CrmSheet(
        "New workspace",
        onDismiss,
        action = "Create workspace",
        busy = busy,
        enabled = name.isNotBlank(),
        error = error,
        onAction = {
            scope.launch {
                model.createWorkspace(name, pipeline, currency)?.let {
                    onDismiss()
                    onCreated(it)
                }
            }
        },
    ) {
        Text("A workspace is your team. Its pipelines live on its members' nodes and nowhere else.", color = Palette.ink2, fontSize = 15.sp)
        Field("Workspace name", name, { name = it }, "e.g. Acme sales")
        Field("First pipeline", pipeline, { pipeline = it }, "e.g. Sales")
        Field("Currency", currency, { currency = it.uppercase() }, "USD", capitalization = KeyboardCapitalization.Characters)
    }
}

@Composable
private fun AddPipelineSheet(
    model: WorkspacesModel,
    workspace: Workspace,
    onDismiss: () -> Unit,
    onCreated: (PipelineRef) -> Unit,
) {
    var name by remember { mutableStateOf("") }
    var currency by remember { mutableStateOf("USD") }
    val busy by model.isWorking.collectAsState()
    val error by model.error.collectAsState()
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { model.error.value = null }
    CrmSheet(
        "Add pipeline",
        onDismiss,
        action = "Add pipeline",
        busy = busy,
        enabled = name.isNotBlank(),
        error = error,
        onAction = {
            scope.launch {
                model.addPipeline(workspace, name, currency)?.let {
                    onDismiss()
                    onCreated(it)
                }
            }
        },
    ) {
        Text("A separate board in ${workspace.title}, with its own stages, deals and settings.", color = Palette.ink2, fontSize = 15.sp)
        Field("Pipeline name", name, { name = it }, "e.g. Partnerships")
        Field("Currency", currency, { currency = it.uppercase() }, "USD", capitalization = KeyboardCapitalization.Characters)
    }
}

/** Paste an invitation link. */
@Composable
private fun JoinSheet(
    vm: CrmViewModel,
    model: WorkspacesModel,
    onDismiss: () -> Unit,
) {
    var link by remember { mutableStateOf("") }
    var invalid by remember { mutableStateOf(false) }
    val busy by model.isWorking.collectAsState()
    val error by model.error.collectAsState()
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { model.error.value = null }
    CrmSheet(
        "Join a workspace",
        onDismiss,
        action = if (busy) "Joining…" else "Join",
        busy = busy,
        enabled = link.isNotBlank(),
        error = if (invalid) "That is not a Mero CRM invitation link." else error,
        onAction = {
            val invitation = CrmInvitation.parse(link)
            invalid = invitation == null
            if (invitation != null) {
                scope.launch {
                    val id = model.join(invitation) ?: return@launch
                    vm.didJoin()
                    onDismiss()
                    model
                        .workspace(id)
                        ?.pipelines
                        ?.singleOrNull()
                        ?.let { vm.open(it) }
                }
            }
        },
    ) {
        Text("Paste the invitation link a teammate sent you.", color = Palette.ink2, fontSize = 15.sp)
        TextBox(link, { link = it }, "Invitation link", singleLine = false, capitalization = KeyboardCapitalization.None)
    }
}

/** An invitation link the system handed the app: ask before joining. */
@Composable
fun InvitationSheet(
    vm: CrmViewModel,
    model: WorkspacesModel,
    raw: String,
) {
    val invitation = remember(raw) { CrmInvitation.parse(raw) }
    val busy by model.isWorking.collectAsState()
    val error by model.error.collectAsState()
    val scope = rememberCoroutineScope()
    CrmSheet(
        invitation?.workspaceName?.let { "Join $it?" } ?: "Join this workspace?",
        onDismiss = { vm.session.dismissPendingInvitation() },
        action = if (busy) "Joining…" else "Join workspace",
        busy = busy,
        enabled = invitation != null,
        error = if (invitation == null) "That is not a Mero CRM invitation link." else error,
        cancelLabel = "Not now",
        onAction = {
            val inv = invitation ?: return@CrmSheet
            scope.launch {
                val id = model.join(inv) ?: return@launch
                vm.session.dismissPendingInvitation()
                vm.didJoin()
                vm.open(model.workspace(id)?.pipelines?.singleOrNull())
            }
        },
    ) {
        Box(Modifier.size(56.dp).clip(RoundedCornerShape(14.dp)).background(Palette.limeSoft), contentAlignment = Alignment.Center) {
            Icon(Icons.Outlined.Drafts, contentDescription = null, modifier = Modifier.size(28.dp))
        }
        Text(
            "Joining makes your account a member of the workspace, and its pipelines sync to you from your teammates.",
            color = Palette.ink2,
            fontSize = 15.sp,
        )
    }
}
