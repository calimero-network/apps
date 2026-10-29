package network.calimero.updates.ui

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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Drafts
import androidx.compose.material.icons.outlined.Layers
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.launch
import network.calimero.updates.app.CompaniesModel
import network.calimero.updates.app.CompanyRoute
import network.calimero.updates.app.CompanySummary
import network.calimero.updates.app.InvitationLanding
import network.calimero.updates.app.UpdatesViewModel
import network.calimero.updates.core.Limits
import network.calimero.updates.core.UpdatesException
import network.calimero.updates.core.UpdatesInvitation

/** Signed in, no audience open: your companies, founding one, joining one. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CompaniesScreen(
    vm: UpdatesViewModel,
    model: CompaniesModel,
) {
    val companies by model.companies.collectAsState()
    val loading by model.isLoading.collectAsState()
    val loaded by model.hasLoaded.collectAsState()
    val error by model.error.collectAsState()
    val hostingNote by model.hostingNote.collectAsState()
    val scope = rememberCoroutineScope()
    var creating by remember { mutableStateOf(false) }
    var joining by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }

    LaunchedEffect(model) { model.load() }

    Scaffold(
        containerColor = Palette.background,
        topBar = {
            TopAppBar(
                title = { Text("Companies", fontWeight = FontWeight.SemiBold, fontSize = 17.sp) },
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
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Palette.background),
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
                item {
                    PageHeader(
                        "Your companies",
                        "A company is a private space for investor relations. Invite someone once and they can read every audience inside it.",
                    )
                }
                if (error != null) item { UpdatesCard { ErrorLine(error) } }
                hostingNote?.let { note ->
                    item {
                        UpdatesCard {
                            Row(verticalAlignment = Alignment.Top) {
                                Icon(Icons.Outlined.WarningAmber, contentDescription = null, tint = Palette.warn, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.width(6.dp))
                                Text(note, color = Palette.warn, fontSize = 13.sp)
                            }
                        }
                    }
                }
                if (!loaded) {
                    item { SkeletonCard(72.dp) }
                    item { SkeletonCard(72.dp) }
                } else if (companies.isEmpty()) {
                    item {
                        UpdatesCard {
                            EmptyState(
                                Icons.Outlined.Layers,
                                "No companies yet",
                                if (model.hasRelay) {
                                    "Founders: create yours below. Investors: open the invitation link a founder sent you."
                                } else {
                                    "Your account has no relay yet. Join a company with an invitation link first."
                                },
                            )
                        }
                    }
                }
                items(companies, key = { it.id }) { company -> CompanyRow(company) { vm.openCompany(CompanyRoute(company)) } }
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(top = 8.dp)) {
                        if (model.hasRelay) {
                            PrimaryButton("New company", onClick = { creating = true }, icon = Icons.Outlined.Add, modifier = Modifier.fillMaxWidth())
                        }
                        SecondaryButton("Join with an invitation", onClick = { joining = true }, icon = Icons.Outlined.Drafts, modifier = Modifier.fillMaxWidth())
                    }
                }
            }
        }
    }

    if (creating) {
        NewCompanySheet(model, onDismiss = { creating = false }) { company ->
            creating = false
            vm.openCompany(CompanyRoute(company))
        }
    }
    if (joining) {
        JoinSheet(vm, model.backend, onDismiss = { joining = false }) { landing ->
            joining = false
            vm.land(landing)
        }
    }
}

@Composable
private fun CompanyRow(
    company: CompanySummary,
    onOpen: () -> Unit,
) {
    UpdatesCard(padding = 14.dp, onClick = onOpen) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconTile(Icons.Outlined.Layers, accent = true, size = 42.dp)
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(company.title, fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
                if (company.memberCount > 0) {
                    Text("${company.memberCount} member${if (company.memberCount == 1) "" else "s"}", color = Palette.ink2, fontSize = 13.sp)
                }
            }
            Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, contentDescription = null, tint = Palette.ink3)
        }
    }
}

@Composable
private fun NewCompanySheet(
    model: CompaniesModel,
    onDismiss: () -> Unit,
    onCreated: (CompanySummary) -> Unit,
) {
    val working by model.isWorking.collectAsState()
    val error by model.error.collectAsState()
    var name by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { model.error.value = null }
    UpdatesSheet("New company", onDismiss) {
        Text("Your updates and your investors' replies live on your and their nodes, nowhere else.", color = Palette.ink2, fontSize = 15.sp)
        InputField(name, { name = it }, "Your company's name — e.g. Acme Inc.", maxLength = Limits.COMPANY_NAME)
        ErrorLine(error)
        PrimaryButton(
            if (working) "Creating…" else "Create company",
            onClick = { scope.launch { model.create(name)?.let(onCreated) } },
            enabled = name.isNotBlank(),
            busy = working,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/** Paste an invitation link a founder sent you. */
@Composable
private fun JoinSheet(
    vm: UpdatesViewModel,
    backend: MeroAppBackend,
    onDismiss: () -> Unit,
    onJoined: (InvitationLanding) -> Unit,
) {
    val model = remember(backend) { CompaniesModel(backend) }
    val working by model.isWorking.collectAsState()
    val error by model.error.collectAsState()
    var link by remember { mutableStateOf("") }
    var invalid by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    UpdatesSheet("Join a company", onDismiss) {
        Text("Paste the invitation link a founder sent you.", color = Palette.ink2, fontSize = 15.sp)
        InputField(link, { link = it }, "Invitation link", singleLine = false, maxLines = 4)
        if (invalid) ErrorLine(UpdatesException.NotAnInvitation().message)
        ErrorLine(error)
        PrimaryButton(
            if (working) "Joining…" else "Join",
            onClick = {
                val invitation = UpdatesInvitation.parse(link)
                invalid = invitation == null
                if (invitation != null) {
                    scope.launch {
                        val landing = model.join(invitation)
                        if (landing != null) {
                            vm.didJoin()
                            onJoined(landing)
                        }
                    }
                }
            },
            enabled = link.isNotBlank(),
            busy = working,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/** An invitation link the system handed the app: ask before joining. */
@Composable
fun InvitationPrompt(
    vm: UpdatesViewModel,
    backend: MeroAppBackend,
) {
    val pending by vm.session.pendingInvitation.collectAsState()
    val link = pending ?: return
    val model = remember(backend, link) { CompaniesModel(backend) }
    val invitation = remember(link) { UpdatesInvitation.parse(link) }
    val working by model.isWorking.collectAsState()
    val error by model.error.collectAsState()
    val scope = rememberCoroutineScope()
    AlertDialog(
        onDismissRequest = { vm.session.dismissPendingInvitation() },
        icon = { IconTile(Icons.Outlined.Drafts, accent = true, size = 48.dp) },
        title = {
            Text(
                when {
                    invitation?.audienceName != null -> "Join ${invitation.audienceName}?"
                    invitation?.companyName != null -> "Join ${invitation.companyName}?"
                    else -> "Join this company?"
                },
                style = displayStyle(22.sp),
            )
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    "Joining makes your account a member of the company, and its updates sync to you from the team. You can read every audience in it.",
                    color = Palette.ink2,
                )
                if (invitation == null) ErrorLine(UpdatesException.NotAnInvitation().message)
                ErrorLine(error)
            }
        },
        confirmButton = {
            if (invitation != null) {
                PrimaryButton(
                    if (working) "Joining…" else "Join",
                    busy = working,
                    compact = true,
                    onClick = {
                        scope.launch {
                            val landing = model.join(invitation)
                            if (landing != null) {
                                vm.session.dismissPendingInvitation()
                                vm.didJoin()
                                vm.land(landing)
                            }
                        }
                    },
                )
            }
        },
        dismissButton = { LinkButton("Not now", onClick = { vm.session.dismissPendingInvitation() }) },
        containerColor = Palette.surface,
    )
}
