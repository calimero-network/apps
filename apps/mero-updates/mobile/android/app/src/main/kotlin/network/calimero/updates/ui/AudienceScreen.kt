package network.calimero.updates.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.PanTool
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.QuestionAnswer
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.SwapHoriz
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.updates.app.AudienceModel
import network.calimero.updates.app.UpdatesViewModel
import network.calimero.updates.core.ComposerStart
import network.calimero.updates.core.ErrorText
import network.calimero.updates.core.Limits
import network.calimero.updates.core.People

/** The tabs, in order. */
enum class AudienceTab(
    val label: String,
    val icon: ImageVector,
) {
    UPDATES("Updates", Icons.Outlined.Inbox),
    ASKS("Asks", Icons.Outlined.PanTool),
    QUESTIONS("Q&A", Icons.Outlined.QuestionAnswer),
    KPIS("KPIs", Icons.Outlined.BarChart),
    PEOPLE("People", Icons.Outlined.Group),
}

/** What every tab can ask of the audience screen. */
class AudienceNav(
    val openPost: (String) -> Unit,
    val compose: (ComposerStart) -> Unit,
    val openAccount: () -> Unit,
    val openSettings: () -> Unit,
    val invite: (InviteShare) -> Unit,
)

/** An open audience: bottom tabs, each with its own stack of posts, the live follow, the account menu. */
@Composable
fun AudienceScreen(
    vm: UpdatesViewModel,
    audience: AudienceModel,
    platform: Platform,
) {
    var tab by rememberSaveable { mutableStateOf(AudienceTab.UPDATES) }
    val stacks = remember { mutableStateMapOf<AudienceTab, List<String>>() }
    var composer by remember { mutableStateOf<ComposerStart?>(null) }
    var settings by remember { mutableStateOf(false) }
    var account by remember { mutableStateOf(false) }
    var invite by remember { mutableStateOf<InviteShare?>(null) }
    val overview by audience.overview.collectAsState()
    val me by audience.me.collectAsState()

    LaunchedEffect(audience) { audience.load() }
    LaunchedEffect(audience) { audience.follow() }

    val nav =
        AudienceNav(
            openPost = { id -> stacks[tab] = stacks[tab].orEmpty() + id },
            compose = { composer = it },
            openAccount = { account = true },
            openSettings = { settings = true },
            invite = { invite = it },
        )

    val start = composer
    if (start != null) {
        BackHandler { composer = null }
        ComposerScreen(audience, start) { id ->
            composer = null
            if (id != null && start !is ComposerStart.Edit) {
                tab = AudienceTab.UPDATES
                stacks[AudienceTab.UPDATES] = listOf(id)
            }
        }
        return
    }
    if (settings) {
        BackHandler { settings = false }
        SettingsScreen(audience, onClose = { settings = false })
        return
    }

    val stack = stacks[tab].orEmpty()
    Scaffold(
        containerColor = Palette.background,
        contentWindowInsets = WindowInsets(0),
        bottomBar = {
            NavigationBar(containerColor = Palette.surface) {
                AudienceTab.entries.forEach { item ->
                    val badge =
                        when (item) {
                            AudienceTab.UPDATES -> overview?.unreadUpdates ?: 0uL
                            AudienceTab.ASKS -> overview?.openAsks ?: 0uL
                            AudienceTab.QUESTIONS -> if (me?.isTeam == true) overview?.openQuestions ?: 0uL else 0uL
                            else -> 0uL
                        }
                    NavigationBarItem(
                        selected = tab == item,
                        onClick = { if (tab == item) stacks[item] = emptyList() else tab = item },
                        icon = {
                            BadgedBox(badge = { if (badge > 0uL) Badge(containerColor = Palette.ink, contentColor = Palette.surface) { Text("$badge") } }) {
                                Icon(item.icon, contentDescription = null)
                            }
                        },
                        label = { Text(item.label, fontSize = 12.sp) },
                        colors =
                            NavigationBarItemDefaults.colors(
                                selectedIconColor = Palette.ink,
                                selectedTextColor = Palette.ink,
                                indicatorColor = Palette.lime,
                                unselectedIconColor = Palette.ink2,
                                unselectedTextColor = Palette.ink2,
                            ),
                    )
                }
            }
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            if (stack.isNotEmpty()) {
                BackHandler { stacks[tab] = stack.dropLast(1) }
                androidx.compose.runtime.key(stack.last()) {
                    PostScreen(audience, stack.last(), nav, onBack = { stacks[tab] = stack.dropLast(1) })
                }
            } else {
                when (tab) {
                    AudienceTab.UPDATES -> UpdatesTab(audience, nav)
                    AudienceTab.ASKS -> AsksTab(audience, nav)
                    AudienceTab.QUESTIONS -> QuestionsTab(audience, nav)
                    AudienceTab.KPIS -> KpisTab(audience, nav)
                    AudienceTab.PEOPLE -> PeopleTab(audience, nav)
                }
            }
        }
    }

    if (account) {
        AccountSheet(
            audience,
            platform,
            onDismiss = { account = false },
            onSettings = {
                account = false
                settings = true
            },
            onInvite = {
                account = false
                invite = it
            },
            onSwitch = {
                account = false
                vm.switchAudience()
            },
            onSignOut = {
                account = false
                vm.signOut()
            },
        )
    }
    invite?.let { InviteSheet(it, platform, onDismiss = { invite = null }) }
}

/** A tab's top bar: who you are (opens the account menu), the company and audience, and its actions. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AudienceTopBar(
    audience: AudienceModel,
    nav: AudienceNav,
    actions: @Composable () -> Unit = {},
) {
    val me by audience.me.collectAsState()
    val overview by audience.overview.collectAsState()
    TopAppBar(
        navigationIcon = {
            IconButton(onClick = nav.openAccount) {
                val current = me
                if (current != null) {
                    Avatar(current.account, current.name, team = current.isTeam, size = 30.dp)
                } else {
                    Icon(Icons.Outlined.AccountCircle, contentDescription = "Account and audience")
                }
            }
        },
        title = {
            Column {
                Text(
                    overview?.companyName?.ifEmpty { null } ?: audience.companyTitle,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 15.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(audience.audience.title, color = Palette.ink2, fontSize = 12.sp, maxLines = 1)
            }
        },
        actions = { actions() },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = Palette.background),
    )
}

/** You, this audience, and the ways out of it. */
@Composable
private fun AccountSheet(
    audience: AudienceModel,
    platform: Platform,
    onDismiss: () -> Unit,
    onSettings: () -> Unit,
    onInvite: (InviteShare) -> Unit,
    onSwitch: () -> Unit,
    onSignOut: () -> Unit,
) {
    val me by audience.me.collectAsState()
    var editing by remember { mutableStateOf(false) }
    var inviting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val isTeam = me?.isTeam == true
    UpdatesSheet("Account", onDismiss) {
        UpdatesCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Avatar(me?.account.orEmpty(), me?.name.orEmpty(), team = isTeam, size = 44.dp)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(People.label(me?.name.orEmpty(), me?.account.orEmpty()), fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
                    val firm = me?.firm.orEmpty()
                    Text(
                        when {
                            firm.isNotEmpty() -> firm
                            audience.isAdmin -> "Company admin"
                            isTeam -> "Company team"
                            else -> "Reader"
                        },
                        color = Palette.ink2,
                        fontSize = 13.sp,
                    )
                }
                audience.roleLabel?.let { Badge(it, if (isTeam) BadgeTone.LIME else BadgeTone.MUTED) }
            }
            SheetAction(Icons.Outlined.Edit, "Edit your profile") { editing = true }
        }
        SectionLabel("This audience")
        UpdatesCard {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("Company", color = Palette.ink2, fontSize = 13.sp)
                Text(audience.companyTitle, fontSize = 16.sp)
            }
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("Audience", color = Palette.ink2, fontSize = 13.sp)
                Text(audience.audience.title, fontSize = 16.sp)
            }
            HorizontalDivider(color = Palette.hairline)
            if (isTeam) {
                SheetAction(Icons.Outlined.Settings, "Settings", onSettings)
                SheetAction(Icons.Outlined.PersonAdd, if (inviting) "Inviting…" else "Invite to this audience") {
                    if (inviting) return@SheetAction
                    inviting = true
                    scope.launch {
                        try {
                            onInvite(
                                InviteShare(
                                    audience.invitation(),
                                    "Opening the link puts them straight into ${audience.audience.title}. It joins the company, which makes every audience in it reachable.",
                                ),
                            )
                        } catch (e: Exception) {
                            error = ErrorText.describe(e)
                        } finally {
                            inviting = false
                        }
                    }
                }
            }
            SheetAction(Icons.Outlined.SwapHoriz, "Switch audience", onSwitch)
            ErrorLine(error)
        }
        DetailsDisclosure(
            listOf(
                "Your account" to (me?.account ?: "—"),
                "Audience context ID" to audience.contextId,
                "Audience (subgroup) ID" to audience.audience.audienceId,
                "Company (namespace) ID" to audience.audience.companyId,
            ),
            platform.copy,
        )
        SecondaryButton("Sign out", onClick = onSignOut, icon = Icons.AutoMirrored.Outlined.Logout, color = Palette.danger, modifier = Modifier.fillMaxWidth())
    }
    if (editing) ProfileSheet(audience, onDismiss = { editing = false })
}

@Composable
private fun SheetAction(
    icon: ImageVector,
    text: String,
    onClick: () -> Unit,
) {
    androidx.compose.material3.TextButton(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Icon(icon, contentDescription = null, tint = Palette.ink, modifier = Modifier.padding(end = 10.dp))
        Text(text, color = Palette.ink, fontSize = 16.sp, modifier = Modifier.weight(1f))
    }
}

/** "Tell your investors who you are": name and firm (or role). */
@Composable
fun ProfileSheet(
    audience: AudienceModel,
    onDismiss: () -> Unit,
) {
    val me by audience.me.collectAsState()
    val isTeam = me?.isTeam == true
    var name by remember { mutableStateOf(me?.name.orEmpty()) }
    var firm by remember { mutableStateOf(me?.firm.orEmpty()) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    UpdatesSheet(if (isTeam) "Tell your investors who you are" else "Tell the team who you are", onDismiss) {
        Text(
            if (isTeam) "Your name goes on every update you publish." else "The team sees who read, reacted and offered to help — as a name, not an account id.",
            color = Palette.ink2,
            fontSize = 15.sp,
        )
        InputField(name, { name = it }, "Your name", maxLength = Limits.NAME)
        InputField(firm, { firm = it }, if (isTeam) "Role (e.g. CEO)" else "Fund or firm (optional)", maxLength = Limits.NAME)
        ErrorLine(error)
        PrimaryButton(
            if (saving) "Saving…" else "Save",
            onClick = {
                saving = true
                scope.launch {
                    try {
                        audience.setProfile(name, firm)
                        onDismiss()
                    } catch (e: Exception) {
                        error = ErrorText.describe(e)
                    } finally {
                        saving = false
                    }
                }
            },
            enabled = name.isNotBlank(),
            busy = saving,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
