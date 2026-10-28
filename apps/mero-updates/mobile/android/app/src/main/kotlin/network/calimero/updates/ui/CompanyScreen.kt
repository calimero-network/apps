package network.calimero.updates.ui

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
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.Tag
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.updates.app.AudienceSummary
import network.calimero.updates.app.CompanyModel
import network.calimero.updates.app.UpdatesViewModel
import network.calimero.updates.core.Limits
import network.calimero.updates.core.UpdatesInvitation

/** An invitation ready to send. */
class InviteShare(
    val invitation: UpdatesInvitation,
    val hint: String,
) {
    val link: String by lazy { runCatching { invitation.link() }.getOrDefault("") }
}

/** One company's audiences: open one, make one, invite people. */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun CompanyScreen(
    vm: UpdatesViewModel,
    model: CompanyModel,
    platform: Platform,
) {
    val audiences by model.audiences.collectAsState()
    val loading by model.isLoading.collectAsState()
    val loaded by model.hasLoaded.collectAsState()
    val pending by model.pending.collectAsState()
    val error by model.error.collectAsState()
    val scope = rememberCoroutineScope()
    var creating by remember { mutableStateOf(false) }
    var invite by remember { mutableStateOf<InviteShare?>(null) }
    var menuFor by remember { mutableStateOf<String?>(null) }
    val company = model.company

    LaunchedEffect(model) {
        model.load()
        model.syncWhileEmpty()
    }

    fun enter(audience: AudienceSummary) {
        scope.launch { model.enter(audience)?.let { vm.open(it) } }
    }

    fun inviteTo(audience: AudienceSummary) {
        scope.launch {
            model.audienceInvitation(audience)?.let {
                invite =
                    InviteShare(
                        it,
                        "Opening the link puts them straight into ${audience.title}. It joins ${company.title}, which makes every audience in it reachable — access is inherited from the company, so this is not narrower than the company link.",
                    )
            }
        }
    }

    Scaffold(
        containerColor = Palette.background,
        topBar = {
            TopAppBar(
                title = { Text(company.title, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = {
                    IconButton(onClick = { vm.openCompany(null) }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Companies") }
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
            LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxSize()) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(company.title, style = displayStyle(28.sp))
                        Text(
                            "An audience is a feed of updates. Everyone invited to this company can open every audience in it — for something confidential, like a board, create a separate company and invite only the board.",
                            color = Palette.ink2,
                            fontSize = 15.sp,
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(top = 6.dp)) {
                            PrimaryButton("New audience", onClick = { creating = true }, icon = Icons.Outlined.Add, compact = true)
                            SecondaryButton(
                                if (pending == "invite") "Inviting…" else "Invite people",
                                onClick = {
                                    scope.launch {
                                        model.companyInvitation()?.let {
                                            invite =
                                                InviteShare(
                                                    it,
                                                    "This link joins ${company.title} and every audience in it, including audiences made later. It lands them on the audience list — to drop someone straight into one audience, use Invite on that audience.",
                                                )
                                        }
                                    }
                                },
                                enabled = pending == null,
                                icon = Icons.Outlined.PersonAdd,
                                compact = true,
                            )
                        }
                    }
                }
                if (error != null) item { UpdatesCard { ErrorLine(error) } }
                item { SectionLabel("Audiences") }
                when {
                    !loaded -> item { SkeletonCard(64.dp) }
                    model.justJoined && audiences.isEmpty() ->
                        item {
                            UpdatesCard {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    CircularProgressIndicator(Modifier.size(18.dp), color = Palette.ink, strokeWidth = 2.dp)
                                    Spacer(Modifier.width(10.dp))
                                    Text("Syncing this company's audiences. They appear as your relay catches up.", color = Palette.ink2, fontSize = 15.sp)
                                }
                            }
                        }
                    audiences.isEmpty() ->
                        item { UpdatesCard { EmptyState(Icons.Outlined.Tag, "No audiences yet", "Most companies start with one called “All investors”.") } }
                    else ->
                        items(audiences, key = { it.audienceId }) { audience ->
                            UpdatesCard(padding = 4.dp) {
                                Row(
                                    Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(12.dp))
                                        .combinedClickable(onClick = { enter(audience) }, onLongClick = { menuFor = audience.audienceId })
                                        .padding(10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    IconTile(Icons.Outlined.Tag, size = 36.dp)
                                    Spacer(Modifier.width(12.dp))
                                    Column(Modifier.weight(1f)) {
                                        Text(audience.title, fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
                                        if (audience.contextId == null) Text("Syncing…", color = Palette.ink2, fontSize = 13.sp)
                                    }
                                    if (pending == "enter:${audience.audienceId}") {
                                        CircularProgressIndicator(Modifier.size(18.dp), color = Palette.ink, strokeWidth = 2.dp)
                                    } else {
                                        Box {
                                            IconButton(onClick = { menuFor = audience.audienceId }) {
                                                Icon(Icons.Outlined.MoreHoriz, contentDescription = "More options", tint = Palette.ink2)
                                            }
                                            DropdownMenu(expanded = menuFor == audience.audienceId, onDismissRequest = { menuFor = null }) {
                                                DropdownMenuItem(
                                                    text = { Text("Invite to this audience") },
                                                    leadingIcon = { Icon(Icons.Outlined.PersonAdd, contentDescription = null) },
                                                    onClick = {
                                                        menuFor = null
                                                        inviteTo(audience)
                                                    },
                                                )
                                            }
                                        }
                                        Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, contentDescription = null, tint = Palette.ink3)
                                    }
                                }
                            }
                        }
                }
                item { DetailsDisclosure(listOf("Company (namespace) ID" to company.id), platform.copy) }
            }
        }
    }

    if (creating) {
        NewAudienceSheet(model, isFirst = audiences.isEmpty(), onDismiss = { creating = false }) { audience ->
            creating = false
            vm.open(audience)
        }
    }
    invite?.let { share -> InviteSheet(share, platform, onDismiss = { invite = null }) }
}

@Composable
private fun NewAudienceSheet(
    model: CompanyModel,
    isFirst: Boolean,
    onDismiss: () -> Unit,
    onCreated: (AudienceSummary) -> Unit,
) {
    val pending by model.pending.collectAsState()
    val error by model.error.collectAsState()
    var name by remember { mutableStateOf(if (isFirst) "All investors" else "") }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { model.error.value = null }
    UpdatesSheet("New audience", onDismiss) {
        Text("Everyone invited to the company can open it. You become its admin.", color = Palette.ink2, fontSize = 15.sp)
        InputField(name, { name = it }, "e.g. All investors, Angels, Advisors", maxLength = Limits.NAME)
        ErrorLine(error)
        PrimaryButton(
            if (pending == "create") "Creating…" else "Create audience",
            onClick = { scope.launch { model.create(name)?.let(onCreated) } },
            enabled = name.isNotBlank(),
            busy = pending == "create",
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/** The link, what it grants, and Share / Copy. */
@Composable
fun InviteSheet(
    share: InviteShare,
    platform: Platform,
    onDismiss: () -> Unit,
) {
    var copied by remember { mutableStateOf(false) }
    UpdatesSheet("Invitation ready", onDismiss) {
        Badge(share.invitation.scope, BadgeTone.MUTED, Icons.Outlined.PersonAdd)
        Text(share.hint, color = Palette.ink2, fontSize = 15.sp)
        Text(
            share.link,
            fontFamily = FontFamily.Monospace,
            fontSize = 12.sp,
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
            modifier =
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(Palette.sunken)
                    .padding(12.dp),
        )
        Text("Links expire after 24 hours. Anyone with the link joins as a reader.", color = Palette.ink3, fontSize = 13.sp)
        PrimaryButton("Share link", onClick = { platform.share("Mero Updates invitation", share.link) }, icon = Icons.Outlined.Share, modifier = Modifier.fillMaxWidth())
        SecondaryButton(
            if (copied) "Copied" else "Copy link",
            onClick = {
                platform.copy("Invitation link", share.link)
                copied = true
            },
            icon = if (copied) Icons.Outlined.Check else Icons.Outlined.ContentCopy,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
