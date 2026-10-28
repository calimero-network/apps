package network.calimero.crm.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.ListAlt
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.People
import androidx.compose.material.icons.outlined.ViewWeek
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.crm.app.CrmViewModel
import network.calimero.crm.app.PipelineModel
import network.calimero.crm.app.PipelineState
import network.calimero.crm.core.Days

/** Where a row leads. */
sealed interface Route {
    data class Deal(
        val id: String,
    ) : Route

    data class Contact(
        val id: String,
    ) : Route

    data class Company(
        val key: String,
    ) : Route

    data object Insights : Route

    data object Stages : Route

    data object Automations : Route

    data object Settings : Route
}

enum class Tab(
    val label: String,
    val icon: ImageVector,
) {
    PIPELINE("Pipeline", Icons.Outlined.ViewWeek),
    DEALS("Deals", Icons.AutoMirrored.Outlined.ListAlt),
    PEOPLE("People", Icons.Outlined.People),
    TODOS("To-dos", Icons.Outlined.Checklist),
    MORE("More", Icons.Outlined.MoreHoriz),
}

/** Pushing and popping screens within the current tab. */
class Nav(
    val push: (Route) -> Unit,
    val pop: () -> Unit,
    val switchPipeline: () -> Unit,
    val signOut: () -> Unit,
)

val LocalModel = staticCompositionLocalOf<PipelineModel> { error("No pipeline") }
val LocalNav = staticCompositionLocalOf<Nav> { error("No nav") }
val LocalPlatform = staticCompositionLocalOf<Platform> { error("No platform") }

/** One open pipeline: the five tabs over one live snapshot. */
@Composable
fun PipelineShell(
    vm: CrmViewModel,
    model: PipelineModel,
    platform: Platform,
) {
    var tab by rememberSaveable { mutableStateOf(Tab.PIPELINE) }
    val stacks = remember(model) { mutableStateMapOf<Tab, List<Route>>() }
    val stack = stacks[tab].orEmpty()
    val state by model.state.collectAsState()
    val notice by model.notice.collectAsState()
    LaunchedEffect(model) { model.run() }
    BackHandler(enabled = stack.isNotEmpty()) { stacks[tab] = stack.dropLast(1) }
    val nav =
        remember(model, tab) {
            Nav(
                push = { r -> stacks[tab] = stacks[tab].orEmpty() + r },
                pop = { stacks[tab] = stacks[tab].orEmpty().dropLast(1) },
                switchPipeline = { vm.open(null) },
                signOut = { vm.signOut() },
            )
        }
    CompositionLocalProvider(LocalModel provides model, LocalNav provides nav, LocalPlatform provides platform) {
        Box(Modifier.fillMaxSize()) {
            Scaffold(
                containerColor = Palette.background,
                bottomBar = {
                    NavigationBar(containerColor = Palette.surface) {
                        for (t in Tab.entries) {
                            NavigationBarItem(
                                selected = t == tab,
                                onClick = {
                                    if (t == tab) stacks[t] = emptyList() else tab = t
                                },
                                icon = {
                                    val overdue = if (t == Tab.TODOS) overdueMine(model, state) else 0
                                    BadgedBox(badge = { if (overdue > 0) Badge(containerColor = Palette.danger) { Text("$overdue") } }) {
                                        Icon(t.icon, contentDescription = null)
                                    }
                                },
                                label = { Text(t.label, fontSize = 12.sp) },
                                colors =
                                    NavigationBarItemDefaults.colors(
                                        selectedIconColor = Palette.ink,
                                        selectedTextColor = Palette.ink,
                                        indicatorColor = Palette.lime,
                                        unselectedIconColor = Palette.ink3,
                                        unselectedTextColor = Palette.ink3,
                                    ),
                            )
                        }
                    }
                },
            ) { padding ->
                Box(Modifier.padding(padding).fillMaxSize()) {
                    when (val route = stack.lastOrNull()) {
                        null ->
                            when (tab) {
                                Tab.PIPELINE -> BoardScreen()
                                Tab.DEALS -> DealsScreen()
                                Tab.PEOPLE -> PeopleScreen()
                                Tab.TODOS -> TodosScreen()
                                Tab.MORE -> MoreScreen()
                            }
                        is Route.Deal -> DealDetailScreen(route.id)
                        is Route.Contact -> ContactDetailScreen(route.id)
                        is Route.Company -> CompanyDetailScreen(route.key)
                        Route.Insights -> InsightsScreen()
                        Route.Stages -> StagesScreen()
                        Route.Automations -> AutomationsScreen()
                        Route.Settings -> PipelineSettingsScreen()
                    }
                }
            }
            NoticeToast(notice) { model.notice.value = null }
        }
    }
}

private fun overdueMine(
    model: PipelineModel,
    state: PipelineState,
): Int {
    val today = Days.startOfDay(model.now(), model.zone)
    return state.activities.count { !it.done && it.dueAt < today && model.isMe(it.owner) }
}

/** A screen: its top bar (with Back when pushed) over its content. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Screen(
    title: String,
    large: Boolean = false,
    back: Boolean = false,
    navigationIcon: (@Composable () -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
    content: @Composable () -> Unit,
) {
    val nav = LocalNav.current
    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = {
                Text(
                    title,
                    fontWeight = if (large) FontWeight.Bold else FontWeight.SemiBold,
                    fontSize = if (large) 28.sp else 17.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            },
            navigationIcon = {
                when {
                    back -> IconButton(onClick = nav.pop) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back") }
                    navigationIcon != null -> navigationIcon()
                }
            },
            actions = actions,
            colors = TopAppBarDefaults.topAppBarColors(containerColor = Palette.background),
        )
        Box(Modifier.weight(1f).fillMaxWidth()) { content() }
    }
}

/** Pull to refresh over the pipeline. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Refreshable(content: @Composable () -> Unit) {
    val model = LocalModel.current
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = {
            scope.launch {
                refreshing = true
                model.load()
                refreshing = false
            }
        },
        modifier = Modifier.fillMaxSize(),
    ) { content() }
}

/** The loading / syncing / error states every list shares before the first read lands. */
@Composable
fun LoadGate(content: @Composable () -> Unit) {
    val model = LocalModel.current
    val state by model.state.collectAsState()
    val scope = rememberCoroutineScope()
    when {
        state.hasLoaded -> content()
        state.warmingUp ->
            Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                CircularProgressIndicator(color = Palette.ink)
                Spacer(Modifier.height(14.dp))
                Text("Syncing this pipeline from your teammates…", color = Palette.ink2, fontSize = 15.sp, textAlign = TextAlign.Center)
            }
        state.error != null ->
            Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                EmptyState(Icons.Outlined.WarningAmber, "Can't load this pipeline", state.error)
                SecondaryButton("Try again", onClick = { scope.launch { model.load() } })
            }
        else ->
            Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                CircularProgressIndicator(color = Palette.ink)
                Spacer(Modifier.height(10.dp))
                Text("Loading pipeline…", color = Palette.ink2)
            }
    }
}

/** When the next step is due, with its kind. */
@Composable
fun DueChip(
    kind: String,
    dueAt: ULong,
    subject: String? = null,
) {
    val model = LocalModel.current
    val label = Days.dueLabel(dueAt, model.now(), model.zone)
    val (fg, bg) = Palette.tone(label.tone)
    Pill(subject?.let { "${label.text} · $it" } ?: label.text, kindIcon(kind), fg, bg)
}

@Composable
fun BoxIcon(
    icon: ImageVector,
    size: Int = 20,
) {
    Icon(icon, contentDescription = null, tint = Palette.ink2, modifier = Modifier.size(size.dp))
}
