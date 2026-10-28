package network.calimero.standup.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Verified
import androidx.compose.material.icons.outlined.WbSunny
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.standup.app.BoardModel
import network.calimero.standup.app.DecisionsModel
import network.calimero.standup.app.StandupViewModel
import network.calimero.standup.app.TeamModel
import network.calimero.standup.app.WeekModel
import network.calimero.standup.core.DecisionDraft
import network.calimero.standup.core.Limits

/** The four tabs, in order. */
enum class Tab(
    val label: String,
    val icon: ImageVector,
) {
    STANDUP("Standup", Icons.Outlined.WbSunny),
    WEEK("Week", Icons.Outlined.CalendarMonth),
    DECISIONS("Decisions", Icons.Outlined.Verified),
    TEAM("Team", Icons.Outlined.Group),
}

/** An open team: bottom tabs, the live follow, the first-run name prompt. */
@Composable
fun TeamScreen(
    vm: StandupViewModel,
    team: TeamModel,
    platform: Platform,
) {
    val board = remember(team) { BoardModel(team) }
    val week = remember(team) { WeekModel(team) }
    val decisions = remember(team) { DecisionsModel(team) }
    var tab by rememberSaveable { mutableStateOf(Tab.STANDUP) }
    var decisionDraft by remember { mutableStateOf<DecisionDraft?>(null) }
    val version by team.version.collectAsState()
    val hasLoaded by team.hasLoaded.collectAsState()
    val me by team.me.collectAsState()
    val myName by team.myName.collectAsState()
    var welcomed by remember(team) { mutableStateOf(vm.welcomed(team.contextId)) }

    LaunchedEffect(team) { team.follow() }
    LaunchedEffect(team, version) { team.load() }

    Scaffold(
        containerColor = Palette.background,
        contentWindowInsets = WindowInsets(0),
        bottomBar = {
            NavigationBar(containerColor = Palette.surface) {
                for (t in Tab.entries) TabItem(t, tab == t) { tab = t }
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when (tab) {
                Tab.STANDUP -> StandupTab(team, board, onLogDecision = { decisionDraft = DecisionDraft.start(fromDay = it) })
                Tab.WEEK -> WeekTab(team, week, platform)
                Tab.DECISIONS -> DecisionsTab(team, decisions, onNew = { decisionDraft = it })
                Tab.TEAM -> TeamTab(vm, team, platform)
            }
        }
    }

    decisionDraft?.let { draft ->
        DecisionSheet(team, decisions, draft, onDismiss = { decisionDraft = null }) {
            decisionDraft = null
            tab = Tab.DECISIONS
        }
    }

    if (hasLoaded && me != null && myName.isEmpty() && !welcomed) {
        WelcomeSheet(team, onDone = {
            vm.markWelcomed(team.contextId)
            welcomed = true
        })
    }
}

@Composable
private fun RowScope.TabItem(
    tab: Tab,
    selected: Boolean,
    onClick: () -> Unit,
) {
    NavigationBarItem(
        selected = selected,
        onClick = onClick,
        icon = { Icon(tab.icon, contentDescription = null) },
        label = { Text(tab.label) },
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

/** Each tab's top bar: the team's name, and the tab's actions. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TabBar(
    title: String,
    actions: @Composable RowScope.() -> Unit = {},
) {
    TopAppBar(
        title = { Text(title, fontWeight = FontWeight.SemiBold, fontSize = 22.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        actions = actions,
        colors = TopAppBarDefaults.topAppBarColors(containerColor = Palette.background),
    )
}

@Composable
private fun WelcomeSheet(
    team: TeamModel,
    onDone: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    StandupSheet("Welcome to the team", onDismiss = onDone) {
        Muted("What should your teammates call you? It shows on everything you post.")
        LabeledField(null, name, { name = it }, "Your name", Limits.NAME, singleLine = true)
        ErrorLine(error)
        PrimaryButton(if (busy) "Saving…" else "Continue", busy = busy, enabled = name.isNotBlank(), modifier = Modifier.fillMaxWidth(), onClick = {
            busy = true
            scope.launch {
                try {
                    team.setMyName(name)
                    onDone()
                } catch (e: Exception) {
                    error =
                        network.calimero.standup.core.ErrorText
                            .describe(e)
                } finally {
                    busy = false
                }
            }
        })
        LinkButton("Later", onClick = onDone, modifier = Modifier.fillMaxWidth())
    }
}
